import type { JsonIO } from '../engine.ts';
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('engdictionary-offline', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export const io: JsonIO = {
  async read(path) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      const request = tx.objectStore('files').get(path);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  },
  async write(path, text) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(text, path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Storage transaction was cancelled.'));
    });
  },
};
