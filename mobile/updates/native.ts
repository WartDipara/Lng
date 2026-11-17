import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { InstalledApp } from '../../src/app-update.ts';
export interface UpdateProgress {
  received: number;
  total: number;
}
interface Updater {
  installed(): InstalledApp;
  download(url: string, sha256: string, size: number, versionCode: number): Promise<void>;
  cancel(): void;
  canInstall(): boolean;
  openInstallSettings(): void;
  install(): Promise<void>;
  addListener(event: 'progress', listener: (progress: UpdateProgress) => void): { remove(): void };
}
export const updater =
  Platform.OS === 'android' ? requireOptionalNativeModule<Updater>('AppUpdater') : null;
