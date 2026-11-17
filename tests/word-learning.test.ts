import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../examples/base.pack.json' with { type: 'json' };
import type { ContentPack } from '../src/types.ts';
import { emptyUserState } from '../src/notebook.ts';
import { newStudyTargets } from '../mobile/study-selection.ts';
import { navigate, initialNavigation } from '../mobile/navigation.ts';
import { emptyCatalog } from '../src/catalog.ts';
import {
  learningProgress,
  recordLearningStep,
  meaningOf,
  meaningChoices,
} from '../src/word-learning.ts';

const word = (fixture as ContentPack).vocabulary![0];
const sense = word.senses[0];
const target = { kind: 'sense' as const, id: sense.id, revision: word.revision };
const now = '2026-11-17T08:00:00.000Z';

test('unseen words start with choices; recognition failure returns to choices without scheduling mastery', () => {
  const initial = emptyUserState();
  assert.equal(learningProgress(initial, target), undefined);
  const input = {
    id: 'learning:1',
    target,
    stage: 'choice' as const,
    response: meaningOf(sense),
    createdAt: now,
  };
  const chosen = recordLearningStep(initial, input, word, sense);
  assert.equal(learningProgress(chosen, target), 'recognize');
  assert.equal(chosen.reviews.length, 0);
  assert.equal(recordLearningStep(chosen, input, word, sense), chosen);
  const restored = JSON.parse(JSON.stringify(chosen));
  assert.equal(learningProgress(restored, target), 'recognize');
  const unknown = recordLearningStep(
    restored,
    { ...input, id: 'learning:2', stage: 'recognize', response: false },
    word,
    sense,
  );
  assert.equal(learningProgress(unknown, target), 'choice');
  assert.equal(unknown.reviews.length, 0);
  assert.equal(unknown.mistakes.length, 1);
  assert.equal(learningProgress(unknown, { ...target, revision: target.revision + 1 }), undefined);
});

test('showing the answer cannot advance; stale steps are rejected', () => {
  const input = {
    id: 'learning:reveal',
    target,
    stage: 'choice' as const,
    response: meaningOf(sense),
    revealed: true,
    createdAt: now,
  };
  const state = recordLearningStep(emptyUserState(), input, word, sense);
  assert.equal(learningProgress(state, target), 'choice');
  assert.throws(
    () =>
      recordLearningStep(
        state,
        { ...input, id: 'learning:stale', stage: 'recognize' },
        word,
        sense,
      ),
    /step has changed/,
  );
});

test('choice generation requires four unique definitions and excludes the same word', () => {
  assert.throws(() => meaningChoices(word, sense, [word]), /Four distinct/);
  const candidates = ['A red object.', 'A blue object.', 'A green object.'].map(
    (definition, index) => ({
      ...word,
      id: `test:distractor:${index}`,
      headword: `candidate${index}`,
      variants: [],
      senses: [{ ...sense, synonyms: [], definition, simpleDefinition: definition }],
    }),
  );
  const options = meaningChoices(word, sense, candidates, () => 0.5);
  assert.equal(new Set(options).size, 4);
  assert.ok(options.includes(meaningOf(sense)));
});

test('a complete round schedules once, and a failed due review resets a long interval', () => {
  let state = emptyUserState();
  let index = 0;
  const step = (stage: 'choice' | 'recognize' | 'recall' | 'spell', response: string | boolean) => {
    state = recordLearningStep(
      state,
      { id: `round:${index++}`, target, stage, response, createdAt: now },
      word,
      sense,
    );
  };
  step('choice', meaningOf(sense));
  step('recognize', true);
  step('recall', true);
  assert.equal(state.reviews.length, 0);
  step('spell', word.headword);
  assert.equal(learningProgress(state, target), 'complete');
  assert.equal(state.reviews[0].repetitions, 1);
  const review = structuredClone(state.reviews);
  step('recognize', true);
  step('recall', true);
  step('spell', word.headword);
  assert.deepEqual(state.reviews, review);
  state.reviews[0] = { ...state.reviews[0], repetitions: 8, intervalDays: 90, dueAt: now };
  step('recognize', false);
  step('choice', meaningOf(sense));
  step('recognize', true);
  step('recall', true);
  step('spell', word.headword);
  assert.equal(state.reviews[0].repetitions, 0);
  assert.ok(state.reviews[0].intervalDays < 1);
});

test('learners can correct a mistaken self-assessment after seeing the meaning', () => {
  const first = recordLearningStep(
    emptyUserState(),
    { id: 'c:1', target, stage: 'choice', response: meaningOf(sense), createdAt: now },
    word,
    sense,
  );
  const known = recordLearningStep(
    first,
    { id: 'c:2', target, stage: 'recognize', response: true, createdAt: now },
    word,
    sense,
  );
  const corrected = recordLearningStep(
    known,
    { id: 'c:3', target, stage: 'recognize', response: false, correction: true, createdAt: now },
    word,
    sense,
  );
  assert.equal(learningProgress(corrected, target), 'choice');
  assert.throws(
    () =>
      recordLearningStep(
        corrected,
        { id: 'c:3', target, stage: 'recognize', response: true, createdAt: now },
        word,
        sense,
      ),
    /conflict/,
  );
});

test('unfinished learning remains available when the daily new-word allowance is exhausted', () => {
  const user = recordLearningStep(
    emptyUserState(),
    { id: 'resume:1', target, stage: 'choice', response: meaningOf(sense), createdAt: now },
    word,
    sense,
  );
  user.settings.dailyNewLimit = 1;
  const targets = newStudyTargets(
    { user, catalog: emptyCatalog(), words: [], questions: [], targetExists: () => true },
    new Date(now),
  );
  assert.deepEqual(targets, [target]);
});

test('interleaved learning replaces the current card so Back exits the round', () => {
  const home = { ...initialNavigation, route: { name: 'words' as const }, tab: 'words' as const };
  const first = navigate(home, { type: 'go', route: { name: 'word', id: 'one', study: true } });
  const second = navigate(first, {
    type: 'go',
    route: { name: 'word', id: 'two', study: true },
    replace: true,
  });
  assert.equal(navigate(second, { type: 'back' }).route.name, 'words');
});
