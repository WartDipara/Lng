import { latest } from '../src/catalog.ts';
import { dueReviews, newSensesToday } from '../src/learning.ts';
import type { Catalog, Target, UserState } from '../src/types.ts';
import type { WordRow, QuestionRow } from '../src/library-index.ts';

interface StudyLibrary {
  catalog: Catalog;
  words: WordRow[];
  questions: QuestionRow[];
  user: UserState;
  targetExists(target: Target): boolean;
  targetTags?(target: Target): string[];
}

export function inScope(library: StudyLibrary, target: Target): boolean {
  const tags = library.user.settings.selectedTags;
  if (!tags.length) return true;
  if (library.targetTags) return tags.some((tag) => library.targetTags!(target).includes(tag));
  const content =
    target.kind === 'question'
      ? library.questions.find((question) => question.id === target.id)
      : library.words.find(
          (word) =>
            word.ready.includes(target.id) ||
            library.catalog.entities.vocabulary[word.id]?.[target.revision]?.senseIds?.includes(
              target.id,
            ),
        );
  return Boolean(content && tags.some((tag) => content.tags.includes(tag)));
}

export function newStudyTargets(library: StudyLibrary, now = new Date()): Target[] {
  const seen = new Set(
    library.user.attempts.filter((a) => a.target.kind === 'sense').map((a) => a.target.id),
  );
  const allowance = Math.max(
    0,
    library.user.settings.dailyNewLimit - newSensesToday(library.user, now),
  );
  const targets: Target[] = [];
  if (!allowance) return targets;
  for (const word of library.words) {
    if (
      library.user.settings.selectedTags.length &&
      !library.user.settings.selectedTags.some((tag) => word.tags.includes(tag))
    )
      continue;
    const entry = latest(library.catalog.entities.vocabulary[word.id]);
    if (!entry) continue;
    for (const senseId of word.ready) {
      if (seen.has(senseId)) continue;
      targets.push({ kind: 'sense', id: senseId, revision: entry.revision });
      if (targets.length >= allowance) return targets;
    }
  }
  return targets;
}

export function dueStudyTargets(library: StudyLibrary, now = new Date()): Target[] {
  return dueReviews(library.user, now)
    .filter((review) => library.targetExists(review.target) && inScope(library, review.target))
    .map((review) => review.target);
}
