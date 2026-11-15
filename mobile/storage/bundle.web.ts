import { Asset } from 'expo-asset';
import type { BundleAccess } from '../engine.ts';
import { libraryAsset, libraryShards, packAssets } from '../assets/registry';
import { loadIndex } from './index-loader';
import { io } from './io';

async function readAsset(module: number) {
  const asset = Asset.fromModule(module);
  const key = `bundled/${asset.hash ?? asset.uri}`;
  const saved = await io.read(key);
  if (saved) return JSON.parse(saved);
  const response = await fetch(asset.uri);
  if (!response.ok) throw new Error('Could not open the bundled library.');
  const text = await response.text();
  await io.write(key, text);
  return JSON.parse(text);
}
export const bundle: BundleAccess = {
  index: () => loadIndex(readAsset, libraryAsset, libraryShards),
  async pack(file) { return packAssets[file] ? await readAsset(packAssets[file]) : null; },
};
