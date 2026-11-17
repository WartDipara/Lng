# Architecture and maintenance

English in Practice is an offline learning application, not a dictionary server.
It combines a large reference vocabulary with curated learning cards, spelling
tests, Use of English questions, saved practice sets, notes, mistakes and spaced
reviews. Content imports add immutable revisions; they must not rewrite a user's
historical answers or the content snapshots inside practice sessions.

## Responsibilities

| Area                                                        | Responsibility                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/types.ts`, `schemas/`                                  | Domain contracts and persisted JSON validation                                   |
| `src/catalog.ts`, `delta.ts`, `split.ts`, `import-batch.ts` | Content identity, revision conflicts, dependencies and distribution              |
| `src/library-index.ts`                                      | Shared index contracts, row construction and ordering                            |
| `src/answers.ts`, `grading.ts`                              | Answer normalization and grading used by both UI and saved results               |
| `src/notebook.ts`, `learning.ts`, `*-progress.ts`           | User-state transitions and review scheduling                                     |
| `src/practice-builder.ts`, `practice-session.ts`            | Pinned practice snapshots, drafts, submission and summaries                      |
| `src/store.ts`                                              | Node filesystem adapter with immutable generations and commit pointers           |
| `mobile/storage/`                                           | Platform I/O, asset access and checksummed two-slot persistence                  |
| `mobile/library-view.ts`                                    | Cooperative index preparation and historical sense lookup                        |
| `mobile/engine.ts`                                          | Application facade coordinating content, progress and serialized transactions    |
| `mobile/study-selection.ts`                                 | Daily allowance, tag scope and available review selection                        |
| `mobile/navigation.ts`, `mobile/hooks/`                     | Navigation transitions, dirty-page guards and startup lifecycle                  |
| `mobile/screens/`, `components/`                            | Presentation and interaction                                                     |
| `scripts/`, `config/`                                       | Collection, asset preparation, release tooling and external-source configuration |

## Design choices

- Use pure functions for domain rules that do not own resources. Screens should
  not define scoring, dependency ordering or study-selection rules.
- Use small injected ports (`JsonIO`, `BundleAccess`, practice content access)
  for external resources. Keep Expo and Node imports outside the domain layer.
- The app owns one engine for its mounted lifetime. Each engine owns its queue,
  snapshot store and cache. Do not introduce a process-wide mutable singleton:
  independent stores, restarts and tests need isolated state.
- Share the English word collator and compiled schema validators at module scope;
  these services are reusable and do not contain a learner's mutable state.
- Practice construction uses a typed options object and an asynchronous factory.
  A fluent builder hierarchy would add no useful constraint here.
- `SerialQueue` defines ordering and failure isolation. Internal transaction
  methods must not enqueue another operation on the queue they already hold.
- `StudyEngine.updateUser` callbacks are immutable transformations. Return a new
  state when changing data; returning the original state represents a no-op.
- Preserve the existing narrow domain modules instead of introducing a generic
  repository framework or a class per question type without a concrete need.

## Configuration ownership

`src/policy.ts` owns product defaults and runtime resource budgets. Practice-size
bounds come from the persisted user-state schema, so validation and the UI agree.
`mobile/theme.tsx` owns semantic colors, including practice results and activity
charts. Word filters come from installed content rather than a fixed exam list.

`config/source-rules.json` contains external provider path selectors and tag
aliases. Non-English upstream filenames are Unicode-escaped data; changing their
decoded values would break source collection. Keep authored code, comments and
documentation in English. Third-party notices and source snapshots retain their
original contents.

`config/release.json` records the release repository and existing Android signing
identity. Application IDs, storage namespaces, backup format identifiers and
signing certificates are compatibility contracts, not arbitrary defaults to
rename. Changing them requires an explicit migration/release decision. Build
scripts use `JAVA_HOME`; they do not assume a developer's personal JDK path.

## Persistence guarantees

Mobile writes alternate checksummed slots. On startup, the newest intact slot
wins; one corrupt slot can recover from the other, while two damaged slots fail
without resetting user data. The engine serializes imports, progress writes,
practice creation, backup reads and restores. Backups cannot race later writes
and mix content from one state with progress from another.

Batch planning validates all packages before writes and orders both dependencies
and versions of the same package. Restores commit content additions first and
replace progress once. A disk failure can leave valid extra content installed;
this is intentionally not an all-or-nothing transaction across every pack.

Node user generations retain all profile and practice fields in the existing
notebook payload, alongside separately stored attempts, reviews and settings.
Older saves without optional fields remain readable. Content and user schema
versions and hash canonicalization are unchanged. New imported content uses gzip
with a checksum descriptor; legacy JSON pack filenames remain readable.

## Resource loading

`src/paged-library.ts` defines the paged manifest and lazy content port.
`scripts/paged-assets.ts` generates compressed lookup and search pages.
`mobile/storage/compressed-resources.ts` owns integrity checks, bounded decoding,
read coalescing and byte-budgeted eviction. Native and web adapters supply bytes
through the same loader; vocabulary, questions, passages, embedded diagrams and
notices share this path. Imported gzip packs share the cache as well.

Select IDs using summaries before loading content. Daily learning opens one card
at a time; practice reads only its selected set. Avoid effects that fetch payloads
for every row of an unbounded list. The bootstrap currently retains all question
summaries and ready-card summaries; those are metadata, not full content. If those
pools grow substantially, page their selection indexes as well.

## Verification workflow

### CI build performance

The Android workflow restores Gradle dependencies and cacheable task outputs
through `gradle/actions/setup-gradle` and enables `--build-cache`. It uses one
explicit Gradle home shared by the action and build script. Signing keys and
the generated native project are not included in this cache.

Run the workflow manually on `main` once to populate the shared cache. GitHub
allows release tags to read default-branch caches, but separate tags cannot
reuse each other's caches. Main builds may rebuild the current published version
without publishing another release; new release tags still require an increased
Android version code. Refresh the main cache after native dependency changes.

Each build writes `output/build-timings.json` and a phase timing table in the
Actions summary. Compare a warm-cache run with the same source and runner before
claiming a speedup. Cache misses remain valid full builds, and existing tests,
signing checks and offline asset verification still run.

Use Node.js 24 or newer. During development, run the smallest relevant test file
or named test for the changed behavior. Do not run the entire suite after every
edit. Once the changes are complete, run the full checks once:

```sh
npm ci
npm run prepare:mobile
npm run typecheck
npm run typecheck:mobile
npm test
npm run test:data
npm run format:check
npm run export
```

`npm run format` formats authored TypeScript and documentation. Generated assets,
large datasets, schemas and third-party notices are excluded. Regenerate schemas
through `scripts/generate_schemas.py` when changing persisted contracts.

The expanded vocabulary and its immutable archive workflow are described in
[Vocabulary collection](VOCABULARY.md).

The refactoring tests cover data round trips, reverse-order package versions,
navigation history, study selection, shared grading rules, pinned practice
snapshots and queue ordering. Existing engine tests cover corrupt-slot recovery,
write failures, historical revisions and restart/restore behavior.

Compilation, data tests and Metro export do not establish Android device
acceptance. Before release, exercise startup and retry, theme persistence,
unsaved-note back navigation, practice draft recovery, imports, backup/restore
and offline cold starts on a device. APK signing and upgrades require the
existing signing key and Android toolchain.

## Mobile learning navigation

Main tabs are small decision screens. Word reference, learning preferences, practice setup,
statistics, history, appearance, backups, and source information use
separate child routes. Only main routes display the tab bar. Back returns to the parent;
advancing learning cards replaces the current route instead of growing the back stack.
Long passages and real content lists remain scrollable, including with large system fonts.

Vocabulary study follows our own progressive workflow, inspired by contextual learning
and repeated recall rather than a copy of another app's UI or proprietary scheduler:

1. An unseen meaning starts with four English meaning choices.
2. A correct choice unlocks recognition without choices.
3. Recognition unlocks recalling the word from its English meaning.
4. Recall unlocks spelling from memory. Successful spelling completes the cycle.

Wrong answers, unknown responses, revealing the answer, and corrected self-assessments
return the meaning to the first stage. Words are interleaved within the selected session.
Every stage is saved as a versioned attempt before feedback; unfinished targets survive
restart and backup restore without consuming another daily-new-word allowance.
A completed cycle schedules a review; intermediate steps never prematurely extend it.
This is practice completion, not a claim of permanent mastery.

Choices use distinct English definitions and avoid known synonyms; semantic ambiguity
still requires editorial review. Only eligible learning content enters automatic sessions.
The large reference dictionary remains a separate, paged lookup resource.

### Single-window practice

Practice starts a system-selected round without a searchable question catalogue or a
question-number picker. The session shows only its current question. Single-choice
answers are checked immediately; text, multiple-choice and matching interactions use
an explicit check action so incomplete input is never submitted automatically.

A checked item records its attempt, score, mistake and review together before feedback
appears. Checked answers are immutable. Resuming selects the first unchecked item;
finishing a round reuses the existing attempts rather than grading them again. Older
unfinished drafts and completed sets remain readable.

`LearningWindow` keeps explicit correct/incorrect feedback visible until the learner
presses Next or swipes left. No timer advances a question. Horizontal gestures only
activate after feedback and do not capture vertical reading gestures. Repeated presses
are locked during transitions; errors keep feedback visible for retry. Reduced-motion
preferences are respected. Long content scrolls inside the question viewport. Detailed
explanations are available in the end-of-round review; reading passages open separately.

Design references: [Duolingo's immediate feedback](https://www.duolingo.com/nojs/splash)
and [Quizlet's mixed question practice](https://quizlet.com/features/study-modes).
Learner-controlled slide navigation is our product decision, not a claim about either service.
