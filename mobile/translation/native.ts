import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export const translationTargets = [
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'de', label: 'German' },
] as const;
export type TranslationTarget = typeof translationTargets[number]['code'];
export interface TranslationStatus { target: TranslationTarget; available: boolean; supported: boolean }
interface TranslatorModule {
  status(target: TranslationTarget): Promise<TranslationStatus>;
  download(target: TranslationTarget, wifiOnly: boolean): Promise<TranslationStatus>;
  remove(target: TranslationTarget): Promise<TranslationStatus>;
  translateEnglish(text: string, target: TranslationTarget): Promise<string>;
}

function nativeModule(): TranslatorModule | null {
  return Platform.OS === 'android' ? requireOptionalNativeModule<TranslatorModule>('OfflineTranslator') : null;
}
function required(): TranslatorModule {
  const module = nativeModule();
  if (!module) throw Object.assign(new Error('Offline translation requires the Android app with translation support.'), { code: 'E_TRANSLATION_UNAVAILABLE' });
  return module;
}

export async function status(target: TranslationTarget): Promise<TranslationStatus> {
  return nativeModule()?.status(target) ?? { target, available: false, supported: false };
}
/** Call only after the user explicitly chooses to download a model. */
export async function download(target: TranslationTarget, wifiOnly = true): Promise<TranslationStatus> {
  return required().download(target, wifiOnly);
}
export async function remove(target: TranslationTarget): Promise<TranslationStatus> {
  return required().remove(target);
}
/** Never downloads a missing model; translated text stays on the device. */
export async function translateEnglish(text: string, target: TranslationTarget): Promise<string> {
  return required().translateEnglish(text, target);
}
export const offlineTranslator = { status, download, remove, translateEnglish };
