import { libraryPolicy } from '../../src/policy.ts';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { bootstrapDescriptor, bootstrapAsset, resourceAssets } from '../assets/registry';
import { openBundle } from './open-bundle.ts';

async function readAsset(module: number) {
  const asset = Asset.fromModule(module);
  const label = asset.name || 'offline content';
  const timed = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Reading ${label} took too long. Close and reopen the app, then share the startup details if this repeats.`,
                ),
              ),
            libraryPolicy.assetTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  await timed(asset.downloadAsync());
  return timed(new File(asset.localUri ?? asset.uri).bytes());
}
export const bundle = openBundle(
  bootstrapDescriptor,
  () => readAsset(bootstrapAsset),
  async (key) => {
    if (!resourceAssets[key]) throw new Error(`Missing offline resource: ${key}`);
    return readAsset(resourceAssets[key]);
  },
);
