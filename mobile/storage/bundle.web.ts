import { Asset } from 'expo-asset';
import { bootstrapDescriptor, bootstrapAsset, resourceAssets } from '../assets/registry';
import { openBundle } from './open-bundle.ts';
import { io } from './io';

async function readAsset(module: number): Promise<Uint8Array> {
  const asset = Asset.fromModule(module);
  const key = `bundled-gzip/${asset.hash ?? asset.uri}`;
  const saved = await io.readBytes!(key);
  if (saved) return saved;
  const response = await fetch(asset.uri);
  if (!response.ok) throw new Error('Could not open the bundled library.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  await io.writeBytes!(key, bytes);
  return bytes;
}
export const bundle = openBundle(
  bootstrapDescriptor,
  () => readAsset(bootstrapAsset),
  async (key) => {
    if (!resourceAssets[key]) throw new Error(`Missing offline resource: ${key}`);
    return readAsset(resourceAssets[key]);
  },
);
