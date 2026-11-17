import type { BundleAccess } from '../../src/library-index.ts';
import type { CompressedResource, PagedLibrary } from '../../src/paged-library.ts';
import { CompressedResources, decodeResource } from './compressed-resources.ts';
import { createPagedBundle } from './paged-bundle.ts';

/** Retry failed opens without leaving a permanently rejected initialization promise. */
export function openBundle(
  bootstrap: CompressedResource,
  readBootstrap: () => Promise<Uint8Array>,
  read: (key: string) => Promise<Uint8Array>,
): BundleAccess {
  let active: BundleAccess | undefined;
  let opening: Promise<BundleAccess> | undefined;
  function ensure() {
    return (opening ??= (async () => {
      const manifest = decodeResource(await readBootstrap(), bootstrap) as PagedLibrary;
      if (manifest.format !== 2) throw new Error('Unsupported library resource format');
      active = createPagedBundle(manifest, new CompressedResources(read, manifest.resources));
      return active;
    })().catch((error) => {
      opening = undefined;
      throw error;
    }));
  }
  return {
    get lazy() {
      return active?.lazy;
    },
    index: async (progress) => (await ensure()).index(progress),
    pack: async (file) => (await ensure()).pack(file),
  };
}
