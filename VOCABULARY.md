# Vocabulary collection

The current reference library combines the original Open English WordNet and
exam-list baseline with full-source lexical ingestion from
[ECDICT](https://github.com/skywind3000/ECDICT) and
[Jeremy Rifkin's Wordlist](https://github.com/jeremy-rifkin/Wordlist).
The curated starter learning cards and practice questions remain separate.

## Contents

| Measure                            |   Count |
| ---------------------------------- | ------: |
| Original reference headwords       | 131,008 |
| New distinct headwords             | 770,534 |
| Current reference headwords        | 901,542 |
| Headwords with English meanings    | 202,911 |
| Headword-only entries              | 698,631 |
| English reference senses           | 314,237 |
| Additional reviewed learning cards |       0 |

The app adds the existing 40 curated starter words and 70 questions to this
reference corpus. See `data/collection-report.json` for source row counts,
rejections, revisions and limitations.

ECDICT's pinned CSV contains 770,611 rows; 767,785 pass the existing headword
format rules. Wordlist's master contains 308,472 rows; 307,869 pass those rules.
Accepted source rows overlap, so their sum is not a unique-word count. No
Chinese translations are imported. The raw pinned files remain available via
the collection command, including fields not represented by the V1 content
schema, such as phonetics and frequency ranks.

## Conversion rules

- Normalize Unicode and whitespace using the existing headword rules and IDs.
  Preserve existing case-sensitive distinctions such as `US` and `us`.
- Wordlist's aggregator calls `capitalize()` on every entry. Align its spellings
  with existing lowercase words first, then an unambiguous known spelling;
  otherwise store a lowercase lexical candidate. Capitalization from that
  source cannot establish proper-noun or acronym identity.
- Keep existing WordNet senses unchanged. For words without meanings, import
  ECDICT gloss lines with explicit part-of-speech prefixes and English text.
  Reject mixed Chinese text, example markers and unstructured prose instead of
  guessing meaning boundaries or generating translations.
- Deduplicate source IDs, tags and repeated glosses. Retain ECDICT exam tags.
- Imported meanings are `reference`; words without meanings are `headword-only`.
  Do not fabricate examples, CEFR levels, simplified explanations or reviewed
  learning-card status. These entries expand search, not the daily ready-card pool.
- Save rejected source rows under `.local/vocabulary-expansion/rejected.jsonl`.
  This is a format filter, not a claim that every accepted lexical item is useful
  everyday English. Sources include names, abbreviations and technical terms.

## Reproducible inputs and outputs

`data/sources.lock.json` pins source commits, paths, retrieval timestamps and
SHA-256 checksums. Collection adds missing providers without silently refreshing
older sources. Both repositories' license notices are retained. Wordlist's README
is also included in app notices because it describes the aggregated upstream
lists and their provenance limitations.

`data/vocabulary.json.gz` remains the immutable original baseline. The new
`data/vocabulary-expansion.jsonl.gz` contains 447 dependency-ordered JSON content
packs, one per line, compressed together. Each line conforms to the existing V1
content-pack schema. The archive itself is a build input, not a single JSON file
for the app's file picker. Its manifest records its checksum and package inventory.

Updated baseline words advance to revision 2; new words start at revision 1.
Asset generation includes both old and new revisions, preserving targets in
notes, attempts and review schedules. It deduplicates the current word list and
keeps the old content bytes addressable. Future data changes must use a new
expansion series; the builder rejects changes to this published series.

```sh
# Fetch only the two expansion sources; existing source pins remain unchanged.
npm run collect -- --provider ecdict --provider wordlist

# Build the expansion through a disk-backed SQLite workspace.
npm run build:data

# Regenerate app assets from the immutable baseline and streamed expansion.
npm run prepare:mobile

# Optional check against actual generated indexes, searches and old revisions.
npm run verify:library
```

The historical `scripts/build_vocabulary.py` and `archive:data` command concern
baseline authoring, not expansion updates. Do not replace the shipped baseline
with a new snapshot under the same package/revision identities.

## On-demand resources and acceptance

The expansion archive is about 38 MB compressed and is only a build input.
Mobile assets use independent gzip blocks for content, ID lookups, search rows,
substring postings and attribution notices. The small compressed bootstrap retains
40 ready-word summaries and 70 question summaries, not the reference corpus.
Search loads candidate summary pages using three- and four-character postings;
opening a word loads its content block. Short queries scan bounded pages until
the result limit is reached. No full dictionary expansion runs at startup.

Learning controls demand: daily new-word allowance selects target IDs, then the
current card loads on opening. Use of English selects the requested set before
reading questions and related passages. Practice snapshots preserve only that
set for draft recovery and historical grading. Review rows mount in a virtualized
list, so opening the schedule does not read every review's content at once.
Reference entries remain searchable but do not become reviewed learning cards.

The shared resource loader verifies compressed checksums and sizes, limits each
decoded block to 4 MiB, coalesces concurrent reads and maintains an 8 MiB LRU
budget measured in decoded JSON bytes. This is not a total JavaScript heap limit:
bootstrap metadata, active screens, practice snapshots and user data also use
memory. Native assets are bundled for offline use; web caches blocks as they are
requested. New local imports use gzip when binary storage is available; legacy
JSON imports remain readable. Oversized imported packs must be split first.

The November 17, 2026 Windows/Node 24 generated-library verification measured
0.065 seconds startup and 88 MiB process RSS; after sample searches and cache
exercise RSS was 240 MiB. The peak retained decoded-cache size was 8,386,476
bytes, within the 8 MiB budget. Sample searches took 18–127 ms. These numbers
are desktop measurements, not Android memory or latency estimates.

Run `npm run verify:library` to reproduce startup, search, historical revision,
question/passage and cache checks. APK installation and device acceptance remain
open; compilation and Metro export do not establish device performance.
