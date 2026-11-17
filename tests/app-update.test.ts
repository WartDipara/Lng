import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseAssets, selectAppUpdate, checkAppUpdate } from '../src/app-update.ts';
import config from '../config/release.json' with { type: 'json' };
const installed = { version: '1.3.0', versionCode: 6 };
const release = () => ({
  draft: false,
  prerelease: false,
  tag_name: 'v1.4.0',
  assets: [
    {
      name: 'English-in-Practice.apk',
      size: 12345,
      browser_download_url: `https://github.com/${config.repository}/releases/download/v1.4.0/English-in-Practice.apk`,
    },
    {
      name: 'android-build-verification.json',
      size: 1000,
      browser_download_url: `https://github.com/${config.repository}/releases/download/v1.4.0/android-build-verification.json`,
    },
  ],
});
const report = () => ({
  version: '1.4.0',
  versionCode: 7,
  sizeBytes: 12345,
  sha256: 'a'.repeat(64),
  signatureVerified: true,
  signingCertificateSha256: config.signingCertificateSha256,
});

test('update eligibility uses Android versionCode and never offers a downgrade', () => {
  const assets = releaseAssets(release());
  assert.equal(selectAppUpdate(assets, report(), installed)?.versionCode, 7);
  assert.equal(selectAppUpdate(assets, report(), { version: '1.4.0', versionCode: 7 }), null);
  assert.equal(selectAppUpdate(assets, report(), { version: '1.10.0', versionCode: 10 }), null);
});
test('rejects unverified, incomplete, oversized, or mismatched release assets', () => {
  for (const change of [
    { prerelease: true },
    { draft: true },
    { tag_name: 'v1.4.0-beta' },
    { assets: [] },
  ])
    assert.throws(() => releaseAssets({ ...release(), ...change }));
  const bad = release();
  bad.assets[0].browser_download_url = 'https://example.com/app.apk';
  assert.throws(() => releaseAssets(bad));
  bad.assets = release().assets;
  bad.assets[0].size = 1024 ** 3;
  assert.throws(() => releaseAssets(bad));
  for (const change of [
    { version: '1.5.0' },
    { versionCode: 7.5 },
    { sizeBytes: 99 },
    { sha256: 'invalid' },
    { signatureVerified: false },
    { signingCertificateSha256: 'b'.repeat(64) },
  ])
    assert.throws(() =>
      selectAppUpdate(releaseAssets(release()), { ...report(), ...change }, installed),
    );
});
test('checking only fetches metadata; finding an update does not download its APK', async () => {
  const urls: string[] = [];
  const signal = new AbortController().signal;
  const request: typeof fetch = async (url, options) => {
    urls.push(String(url));
    assert.equal(options?.signal, signal);
    return new Response(JSON.stringify(urls.length === 1 ? release() : report()));
  };
  const candidate = await checkAppUpdate(installed, signal, request);
  assert.equal(candidate?.version, '1.4.0');
  assert.equal(urls.length, 2);
  assert.ok(!urls.some((url) => url.endsWith('.apk')));
});
test('network, throttling, malformed JSON and cancellation remain errors rather than up-to-date', async () => {
  const controller = new AbortController();
  for (const status of [403, 429, 404, 500]) {
    const request: typeof fetch = async () => new Response('', { status });
    await assert.rejects(checkAppUpdate(installed, controller.signal, request));
  }
  await assert.rejects(
    checkAppUpdate(installed, controller.signal, async () => new Response('bad JSON')),
  );
  controller.abort();
  await assert.rejects(
    checkAppUpdate(installed, controller.signal, async (_, options) => {
      options?.signal?.throwIfAborted();
      return new Response('{}');
    }),
  );
});
