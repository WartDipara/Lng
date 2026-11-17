import type { ContentPack, UserState } from './types.ts';
import { invariant, validateUserState } from './validation.ts';

// This identifier is a persisted compatibility contract, not a display name.
export const backupFormat = 'engdictionary-backup';
export interface Backup {
  format: typeof backupFormat;
  version: 1;
  createdAt: string;
  user: UserState;
  packs: ContentPack[];
}

export function validateBackup(input: unknown): asserts input is Backup {
  const backup = input as Partial<Backup> | null;
  invariant(
    backup?.format === backupFormat && backup.version === 1 && Array.isArray(backup.packs),
    'This backup format or version is not supported.',
  );
  validateUserState(backup.user);
}
