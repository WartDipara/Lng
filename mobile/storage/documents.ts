import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

export async function pickJson(): Promise<{ name: string; text: string }[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', 'application/octet-stream'],
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  const files = [];
  for (const asset of result.assets)
    files.push({ name: asset.name, text: await new File(asset.uri).text() });
  return files;
}
export async function exportJson(name: string, value: unknown) {
  const file = new File(Paths.cache, name);
  await file.write(JSON.stringify(value));
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('File sharing is unavailable on this device.');
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: 'Save your EngDictionary backup',
  });
}
