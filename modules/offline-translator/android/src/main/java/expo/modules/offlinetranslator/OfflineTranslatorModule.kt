package expo.modules.offlinetranslator

import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap

/** Models are downloaded only by download(); input text is translated on this device. */
class OfflineTranslatorModule : Module() {
  private val supported = setOf("zh", "ja", "fr", "es", "de")
  private val busyTargets = ConcurrentHashMap.newKeySet<String>()
  private val clients = ConcurrentHashMap.newKeySet<Translator>()

  override fun definition() = ModuleDefinition {
    Name("OfflineTranslator")

    AsyncFunction("status") { target: String, promise: Promise ->
      withModel(target, promise) { manager, model ->
        manager.isModelDownloaded(model).addOnCompleteListener { task ->
          if (task.isSuccessful) promise.resolve(state(target, task.result))
          else promise.reject("E_MODEL_STATUS_FAILED", "Could not check this language model. Try again.", task.exception)
        }
      }
    }

    AsyncFunction("download") { target: String, wifiOnly: Boolean, promise: Promise ->
      withModel(target, promise) { manager, model ->
        if (!acquire(target, promise)) return@withModel
        try {
          val conditions = DownloadConditions.Builder().apply { if (wifiOnly) requireWifi() }.build()
          manager.download(model, conditions).addOnCompleteListener { task ->
            busyTargets.remove(target)
            if (task.isSuccessful) promise.resolve(state(target, true))
            else promise.reject("E_DOWNLOAD_FAILED", "The language model could not download. Check your connection and free storage, then try again.", task.exception)
          }
        } catch (error: Exception) {
          busyTargets.remove(target)
          promise.reject("E_DOWNLOAD_FAILED", "The language model could not download. Try again when connected.", error)
        }
      }
    }

    AsyncFunction("remove") { target: String, promise: Promise ->
      withModel(target, promise) { manager, model ->
        if (!acquire(target, promise)) return@withModel
        try {
          manager.deleteDownloadedModel(model).addOnCompleteListener { task ->
            busyTargets.remove(target)
            if (task.isSuccessful) promise.resolve(state(target, false))
            else promise.reject("E_MODEL_REMOVE_FAILED", "Could not remove this language model. Try again.", task.exception)
          }
        } catch (error: Exception) {
          busyTargets.remove(target)
          promise.reject("E_MODEL_REMOVE_FAILED", "Could not remove this language model. Try again.", error)
        }
      }
    }

    AsyncFunction("translateEnglish") { text: String, target: String, promise: Promise ->
      if (text.isBlank()) {
        promise.reject("E_EMPTY_TEXT", "Choose some English text to translate.", null)
      } else if (text.length > 20000) {
        promise.reject("E_TEXT_TOO_LONG", "Choose a shorter passage (under 20,000 characters).", null)
      } else {
        withModel(target, promise) { manager, model ->
          if (!acquire(target, promise)) return@withModel
          try {
            manager.isModelDownloaded(model).addOnCompleteListener { check ->
              if (!check.isSuccessful) {
                busyTargets.remove(target)
                promise.reject("E_MODEL_STATUS_FAILED", "Could not check this language model. Try again.", check.exception)
              } else if (!check.result) {
                busyTargets.remove(target)
                promise.reject("E_MODEL_MISSING", "Download this language in Library before translating offline.", null)
              } else {
                translateAvailable(text, target, promise)
              }
            }
          } catch (error: Exception) {
            busyTargets.remove(target)
            promise.reject("E_TRANSLATION_FAILED", "On-device translation could not start. Try again.", error)
          }
        }
      }
    }

    OnDestroy {
      clients.forEach { it.close() }
      clients.clear()
    }
  }

  private fun state(target: String, available: Boolean) = mapOf(
    "target" to target, "available" to available, "supported" to true
  )

  private fun acquire(target: String, promise: Promise): Boolean {
    if (busyTargets.add(target)) return true
    promise.reject("E_MODEL_BUSY", "This language is busy. Wait for the current operation to finish.", null)
    return false
  }

  private fun withModel(
    target: String,
    promise: Promise,
    action: (RemoteModelManager, TranslateRemoteModel) -> Unit
  ) {
    if (target !in supported) {
      promise.reject("E_UNSUPPORTED_LANGUAGE", "Choose Chinese, Japanese, French, Spanish or German.", null)
      return
    }
    try {
      action(RemoteModelManager.getInstance(), TranslateRemoteModel.Builder(target).build())
    } catch (error: Exception) {
      promise.reject("E_TRANSLATION_UNAVAILABLE", "On-device translation is unavailable on this device.", error)
    }
  }

  private fun translateAvailable(text: String, target: String, promise: Promise) {
    var translator: Translator? = null
    try {
      val options = TranslatorOptions.Builder()
        .setSourceLanguage(TranslateLanguage.ENGLISH)
        .setTargetLanguage(target)
        .build()
      val activeClient = Translation.getClient(options)
      translator = activeClient
      clients.add(activeClient)
      // Intentionally no downloadModelIfNeeded: absence must never trigger network work.
      activeClient.translate(text).addOnCompleteListener { task ->
        try {
          if (task.isSuccessful) promise.resolve(task.result)
          else promise.reject("E_TRANSLATION_FAILED", "On-device translation failed. Try a shorter passage or download the model again.", task.exception)
        } finally {
          activeClient.close()
          clients.remove(activeClient)
          busyTargets.remove(target)
        }
      }
    } catch (error: Exception) {
      translator?.close()
      translator?.let { clients.remove(it) }
      busyTargets.remove(target)
      promise.reject("E_TRANSLATION_FAILED", "On-device translation could not start. Try again.", error)
    }
  }
}
