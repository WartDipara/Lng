import { Directory, File, Paths } from 'expo-file-system';
import type { JsonIO } from '../engine.ts';

const root = new Directory(Paths.document, 'engdictionary');
export const io: JsonIO = {
  async read(path) {
    const file = new File(root, path);
    return file.exists ? await file.text() : null;
  },
  async write(path, text) {
    root.create({ idempotent: true, intermediates: true });
    const file = new File(root, path);
    file.parentDirectory.create({ idempotent: true, intermediates: true });
    const temp = new File(root, path + '.tmp');
    if (temp.exists) temp.delete();
    await temp.write(text);
    // Engine commits alternate slots. If killed between delete and move, the other
    // checksummed slot remains valid and initialize() recovers it.
    if (file.exists) file.delete();
    await temp.move(file);
  },
};
