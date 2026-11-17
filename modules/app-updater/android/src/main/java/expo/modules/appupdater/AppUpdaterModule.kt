package expo.modules.appupdater

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

class AppUpdaterModule : Module() {
  private val busy = AtomicBoolean(false)
  private val cancelled = AtomicBoolean(false)
  @Volatile private var connection: HttpURLConnection? = null
  private val context: Context get() = requireNotNull(appContext.reactContext)
  private val directory: File get() = File(context.cacheDir, "app-updates").apply { mkdirs() }
  private val apk: File get() = File(directory, "update.apk")
  private var verifiedHash: String? = null
  private var verifiedVersion: Long? = null

  @Suppress("DEPRECATION")
  private fun installed(): PackageInfo = context.packageManager.getPackageInfo(context.packageName, signatureFlags())
  private fun signatureFlags() = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
  @Suppress("DEPRECATION")
  private fun version(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
  private fun canInstall() = Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()
  private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
  @Suppress("DEPRECATION")
  private fun signers(info: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
    return signatures?.map { digest(it.toByteArray()) }?.toSet() ?: emptySet()
  }
  private fun hash(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        check(!cancelled.get()) { "Download cancelled." }
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
  @Suppress("DEPRECATION")
  private fun validate(file: File, sha: String, expectedVersion: Long) {
    check(hash(file) == sha) { "The download failed its integrity check. Please retry." }
    val candidate = context.packageManager.getPackageArchiveInfo(file.path, signatureFlags())
      ?: error("The downloaded file is not a valid Android app.")
    val current = installed()
    check(candidate.packageName == context.packageName) { "The downloaded app has a different package name." }
    check(version(candidate) == expectedVersion && expectedVersion > version(current)) { "This download is not a newer version of this app." }
    check(signers(candidate).isNotEmpty() && signers(candidate) == signers(current)) { "The downloaded app has a different signing identity." }
  }
  private fun connect(address: String): HttpURLConnection {
    var url = URL(address)
    repeat(6) {
      check(!cancelled.get()) { "Download cancelled." }
      check(url.protocol == "https" && url.host in setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com") && url.userInfo == null) { "Unsupported download address." }
      val request = (url.openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = false
        connectTimeout = 15000
        readTimeout = 30000
        setRequestProperty("Accept-Encoding", "identity")
      }
      connection = request
      val status = request.responseCode
      if (status in listOf(301, 302, 303, 307, 308)) {
        val location = request.getHeaderField("Location") ?: error("Missing download redirect.")
        url = URL(url, location)
        request.disconnect()
      } else {
        check(status == 200) { "Download failed (HTTP $status). Please retry." }
        return request
      }
    }
    error("Too many download redirects.")
  }

  override fun definition() = ModuleDefinition {
    Name("AppUpdater")
    Events("progress")
    Function("installed") {
      val info = installed()
      mapOf("version" to info.versionName, "versionCode" to version(info))
    }
    Function("cancel") { cancelled.set(true); connection?.disconnect() }
    Function("canInstall") { canInstall() }
    Function("openInstallSettings") {
      context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AsyncFunction("download") Coroutine { address: String, sha: String, size: Long, version: Long ->
      withContext(Dispatchers.IO) {
        check(busy.compareAndSet(false, true)) { "An update operation is already running." }
        cancelled.set(false)
        verifiedHash = null
        verifiedVersion = null
        val part = File(directory, "update.part")
        try {
          check(sha.matches(Regex("[a-f0-9]{64}")) && size in 1..536870912L) { "Invalid update metadata." }
          if (apk.exists() && apk.length() == size && hash(apk) == sha) {
            validate(apk, sha, version)
          } else {
            apk.delete()
            check(directory.usableSpace > size + 32 * 1024 * 1024) { "Not enough free storage for the update." }
            val request = connect(address)
            val length = request.contentLengthLong
            check(length < 0 || length == size) { "The download size does not match the release." }
            var bytes = 0L
            var lastEvent = 0L
            request.inputStream.use { input -> part.outputStream().use { output ->
              val buffer = ByteArray(64 * 1024)
              while (true) {
                check(!cancelled.get()) { "Download cancelled." }
                val count = input.read(buffer)
                if (count < 0) break
                bytes += count
                check(bytes <= size) { "The download exceeds the expected size." }
                output.write(buffer, 0, count)
                val now = System.nanoTime()
                if (now - lastEvent > 150000000L) {
                  sendEvent("progress", mapOf("received" to bytes, "total" to size))
                  lastEvent = now
                }
              }
            } }
            check(bytes == size) { "The download was interrupted. Please retry." }
            sendEvent("progress", mapOf("received" to bytes, "total" to size))
            validate(part, sha, version)
            check(part.renameTo(apk)) { "Could not save the downloaded update." }
          }
          verifiedHash = sha
          verifiedVersion = version
        } finally {
          part.delete()
          connection?.disconnect()
          connection = null
          busy.set(false)
        }
      }
    }
    AsyncFunction("install") Coroutine { ->
      withContext(Dispatchers.IO) {
        check(busy.compareAndSet(false, true)) { "An update operation is already running." }
        try {
          cancelled.set(false)
          validate(apk, requireNotNull(verifiedHash) { "Check for an update first." }, requireNotNull(verifiedVersion))
          check(canInstall()) { "Allow app updates in Android settings first." }
          val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
          withContext(Dispatchers.Main) {
            check(!cancelled.get()) { "Update cancelled." }
            context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
              .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
          }
        } finally { busy.set(false) }
      }
    }
    OnDestroy { cancelled.set(true); connection?.disconnect() }
  }
}
