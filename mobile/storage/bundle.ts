import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import type { BundleAccess } from '../engine.ts';
import { libraryAsset, libraryShards, packAssets } from '../assets/registry';
import { loadIndex } from './index-loader';

async function readAsset(module: number) {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  return JSON.parse(await new File(asset.localUri ?? asset.uri).text());
}
export const bundle: BundleAccess = {
  index: () => loadIndex(readAsset, libraryAsset, libraryShards),
  async pack(file) { return packAssets[file] ? await readAsset(packAssets[file]) : null; },
};
