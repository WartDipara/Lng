import releaseConfig from '../config/release.json' with { type: 'json' };

export interface InstalledApp {
  version: string;
  versionCode: number;
}
export interface AppUpdate {
  version: string;
  versionCode: number;
  url: string;
  sha256: string;
  size: number;
}
export const updateRepository = releaseConfig.repository;
const maxApkSize = 512 * 1024 * 1024;
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid release information. Try again later.');
  return input as Record<string, unknown>;
}
function requireValue(
  condition: unknown,
  message = 'The release is incomplete or could not be verified. Try again later.',
): asserts condition {
  if (!condition) throw new Error(message);
}
export function releaseAssets(input: unknown) {
  const release = record(input);
  requireValue(release.draft === false && release.prerelease === false);
  requireValue(typeof release.tag_name === 'string' && /^v\d+\.\d+\.\d+$/.test(release.tag_name));
  requireValue(Array.isArray(release.assets));
  const asset = (name: string, limit: number) => {
    const matches = (release.assets as unknown[]).map(record).filter((item) => item.name === name);
    requireValue(matches.length === 1);
    const item = matches[0];
    const url = `https://github.com/${updateRepository}/releases/download/${release.tag_name}/${name}`;
    requireValue(
      item.browser_download_url === url &&
        Number.isSafeInteger(item.size) &&
        Number(item.size) > 0 &&
        Number(item.size) <= limit,
    );
    return { url, size: Number(item.size) };
  };
  return {
    version: release.tag_name.slice(1),
    apk: asset('English-in-Practice.apk', maxApkSize),
    report: asset('android-build-verification.json', 128 * 1024),
  };
}
export function selectAppUpdate(
  assets: ReturnType<typeof releaseAssets>,
  input: unknown,
  installed: InstalledApp,
): AppUpdate | null {
  const report = record(input);
  requireValue(
    report.version === assets.version &&
      Number.isSafeInteger(report.versionCode) &&
      Number(report.versionCode) > 0,
  );
  requireValue(
    report.sizeBytes === assets.apk.size &&
      typeof report.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(report.sha256),
  );
  requireValue(
    report.signatureVerified === true &&
      report.signingCertificateSha256 === releaseConfig.signingCertificateSha256,
  );
  requireValue(
    Number.isSafeInteger(installed.versionCode) && installed.versionCode > 0,
    'Cannot determine the installed Android version.',
  );
  if (Number(report.versionCode) <= installed.versionCode) return null;
  return {
    version: assets.version,
    versionCode: Number(report.versionCode),
    url: assets.apk.url,
    size: assets.apk.size,
    sha256: report.sha256,
  };
}
export async function checkAppUpdate(
  installed: InstalledApp,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  async function json(url: string) {
    const response = await request(url, { signal, headers: { Accept: 'application/json' } });
    if (response.status === 403 || response.status === 429)
      throw new Error('The update service is busy. Please try again later.');
    if (!response.ok)
      throw new Error(`Could not check for updates (HTTP ${response.status}). Please retry.`);
    const text = await response.text();
    requireValue(text.length <= 128 * 1024);
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('The update service returned invalid information. Please retry.');
    }
  }
  const assets = releaseAssets(
    await json(`https://api.github.com/repos/${updateRepository}/releases/latest`),
  );
  return selectAppUpdate(assets, await json(assets.report.url), installed);
}
