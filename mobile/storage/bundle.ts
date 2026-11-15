import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import type { BundleAccess } from '../engine.ts';
import { libraryAsset, libraryShards, packAssets } from '../assets/registry';
import { loadIndex } from './index-loader';

async function readAsset(module: number) {
  const asset = Asset.fromModule(module);
  const label = asset.name || 'offline content';
  const timed = async <T,>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Reading ${label} took too long. Close and reopen the app, then share the startup details if this repeats.`)), 30000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  await timed(asset.downloadAsync());
  const text = await timed(new File(asset.localUri ?? asset.uri).text());
  return JSON.parse(text);
}
export const bundle: BundleAccess = {
  index: progress => loadIndex(readAsset, libraryAsset, libraryShards, progress),
  async pack(file) { return packAssets[file] ? await readAsset(packAssets[file]) : null; },
};
