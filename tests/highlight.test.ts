import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightParts } from '../mobile/highlight.ts';

test('highlights whole words with original case and punctuation preserved', () => {
  const text = 'Apple, apple! A pineapple and apples.';
  const parts = highlightParts(text, ['apple']);
  assert.equal(parts.map((p) => p.text).join(''), text);
  assert.deepEqual(
    parts.filter((p) => p.highlighted).map((p) => p.text),
    ['Apple', 'apple'],
  );
});

test('supports explicit variants, phrases, and literal regex characters', () => {
  const text = 'Apples and an apple; look up C++ (but not lookup).';
  assert.deepEqual(
    highlightParts(text, ['apple', 'apples', 'look up', 'C++'])
      .filter((p) => p.highlighted)
      .map((p) => p.text),
    ['Apples', 'apple', 'look up', 'C++'],
  );
});

test('ignores empty terms and avoids matching inside Unicode words', () => {
  assert.deepEqual(highlightParts('éapple appleβ apple', ['apple', '']), [
    { text: 'éapple appleβ ', highlighted: false },
    { text: 'apple', highlighted: true },
  ]);
  assert.deepEqual(highlightParts('plain text', []), [{ text: 'plain text', highlighted: false }]);
});
