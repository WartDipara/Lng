import type { JsonIO } from './snapshot-store.ts';
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return (connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('engdictionary-offline', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function readValue(path: string): Promise<string | Uint8Array | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const request = tx.objectStore('files').get(path);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}
async function writeValue(path: string, value: string | Uint8Array): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(value, path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage transaction was cancelled.'));
  });
}
export const io: JsonIO = {
  async read(path) {
    const value = await readValue(path);
    if (value !== null && typeof value !== 'string') throw new Error('Expected text resource');
    return value;
  },
  async readBytes(path) {
    const value = await readValue(path);
    if (value !== null && !(value instanceof Uint8Array))
      throw new Error('Expected binary resource');
    return value;
  },
  write: writeValue,
  writeBytes: writeValue,
};
