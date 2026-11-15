import type { Note, Target } from '../src/types.ts';
import type { StudyEngine } from './engine.ts';
export type MainTab = 'today' | 'words' | 'practice' | 'notebook' | 'library' | 'profile';
export type Route = { name: MainTab | 'mistakes' | 'reviews' }
  | { name: 'word'; id: string; revision?: number; senseId?: string; study?: boolean }
  | { name: 'question'; id: string; revision?: number }
  | { name: 'practice-session'; id: string }
  | { name: 'note'; note?: Note; target?: Target };
export interface ScreenProps {
  engine: StudyEngine; refresh: () => void; navigate: (route: Route) => void;
  notify: (text: string) => void; openTarget: (target: Target) => Promise<void>;
}
