import { MenuRow } from '../components/MenuRow';
import { newStudyTargets, dueStudyTargets } from '../study-selection.ts';
import { newSensesToday } from '../../src/learning.ts';
import { Ionicons } from '@expo/vector-icons';
import { libraryPolicy } from '../../src/policy.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  Disclosure,
  Empty,
  Feedback,
  Field,
  Heading,
  HighlightText,
  Reveal,
  useUI,
} from '../components/UI';
import { useTheme } from '../theme';
import type { ScreenProps, Route } from '../routes';
import type { Word, Sense, Target } from '../../src/types.ts';
import { checkSpelling } from '../../src/notebook.ts';
import { id } from '../engine';

export function WordsScreen({
  engine,
  navigate,
  startLearning,
  reference = false,
}: ScreenProps & { startLearning: (targets: Target[]) => void; reference?: boolean }) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const browsing = reference;
  const fresh = newStudyTargets(engine);
  const due = dueStudyTargets(engine).filter((target) => target.kind === 'sense');
  const completed = newSensesToday(engine.user);
  const goal = engine.user.settings.dailyNewLimit;
  const tags = engine.wordTags;
  const [query, setQuery] = useState('');
  const [delayed, setDelayed] = useState('');
  const [tag, setTag] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDelayed(query), 160);
    return () => clearTimeout(timer);
  }, [query]);
  const [rows, setRows] = useState<import('../engine.ts').WordRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  useEffect(() => {
    if (!browsing) return;
    const controller = new AbortController();
    setSearching(true);
    setSearchError('');
    setRows([]);
    engine
      .findWords(delayed, tag, ready, libraryPolicy.searchLimit, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setRows(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setSearchError((error as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [engine, engine.words, delayed, tag, ready, browsing]);
  if (!browsing)
    return (
      <ScrollView contentContainerStyle={[ui.page, { gap: 20 }]}>
        <Heading
          title="Make words yours."
          subtitle="A small daily habit. Words that stay with you."
        />
        <View style={{ backgroundColor: c.hero, borderRadius: 24, padding: 22, gap: 18 }}>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text style={{ color: c.heroText, fontSize: 12, letterSpacing: 2, fontWeight: '700' }}>
              YOUR DAILY SESSION
            </Text>
            <Ionicons name="leaf-outline" size={26} color={c.heroText} />
          </View>
          <Text style={{ color: c.heroText, fontSize: 25, lineHeight: 32, fontWeight: '600' }}>
            {due.length
              ? 'Bring familiar words back.'
              : fresh.length
                ? 'Learn a little. Remember more.'
                : 'You have earned a pause.'}
          </Text>
          <Text style={{ color: c.heroText, fontSize: 15, lineHeight: 24 }}>
            {due.length
              ? `${due.length} meanings are ready to review.`
              : fresh.length
                ? `${fresh.length} meanings to practise, one step at a time.`
                : 'Your current learning plan is complete. Come back for your next review.'}
          </Text>
          <Button
            title={due.length ? 'Start review' : 'Start learning'}
            disabled={!due.length && !fresh.length}
            onPress={() => startLearning(due.length ? due : fresh)}
          />
        </View>
        <View style={{ gap: 12 }}>
          <View style={{ gap: 4 }}>
            <Text style={ui.h2}>Today’s rhythm</Text>
            <Text style={ui.small}>
              {completed} / {goal} new meanings introduced
            </Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: Math.max(1, goal),
              now: Math.min(completed, Math.max(1, goal)),
            }}
            style={{ height: 6, borderRadius: 3, backgroundColor: c.line, overflow: 'hidden' }}
          >
            <View
              style={{
                height: 6,
                width: `${goal ? Math.min(100, (completed / goal) * 100) : 0}%`,
                backgroundColor: c.teal,
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 14 }}>
            <Card style={{ flex: 1 }}>
              <Text style={{ ...ui.title, fontFamily: undefined }}>{fresh.length}</Text>
              <Text style={ui.small}>To practise</Text>
            </Card>
            <Card style={{ flex: 1 }}>
              <Text style={{ ...ui.title, fontFamily: undefined }}>{due.length}</Text>
              <Text style={ui.small}>Ready to review</Text>
            </Card>
          </View>
        </View>
        {!!due.length && !!fresh.length && (
          <Button title="Learn new words instead" secondary onPress={() => startLearning(fresh)} />
        )}
        <View>
          <MenuRow
            title="Learning plan"
            detail={`${goal} new meanings a day`}
            icon="options-outline"
            onPress={() => navigate({ name: 'learning-plan' })}
          />
          <MenuRow
            title="Word reference"
            icon="search-outline"
            onPress={() => navigate({ name: 'word-reference' })}
          />
        </View>
      </ScrollView>
    );
  return (
    <FlatList
      data={rows}
      keyExtractor={(w) => w.id}
      contentContainerStyle={ui.page}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: 14, marginBottom: 4 }}>
          <Heading
            title="Word reference"
            subtitle="Find a meaning, then return to your learning."
          />
          {searching && <Text style={ui.small}>Searching offline blocks…</Text>}
          {!!searchError && <Text style={ui.small}>{searchError}</Text>}
          <Field
            label="Search the offline dictionary"
            placeholder="A word or phrase"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          <View style={ui.row}>
            <Chip
              label="All words"
              selected={!ready && !tag}
              onPress={() => {
                setReady(false);
                setTag('');
              }}
            />
            <Chip label="Learning cards" selected={ready} onPress={() => setReady(!ready)} />
          </View>
          <Disclosure title={tag ? `Exam lists: ${tag}` : 'Exam lists'}>
            <View style={ui.row}>
              {tags.map((t) => (
                <Chip
                  key={t}
                  label={t}
                  selected={tag === t}
                  onPress={() => setTag(tag === t ? '' : t)}
                />
              ))}
            </View>
          </Disclosure>
          <Text style={ui.small}>
            {rows.length
              ? `Showing ${rows.length === libraryPolicy.searchLimit ? 'the first ' : ''}${rows.length} matches`
              : 'No matches'}{' '}
            from {engine.wordCount.toLocaleString()} offline entries.
          </Text>
        </View>
      }
      ListEmptyComponent={
        !searching && !searchError ? (
          <Empty
            title="No matching words"
            text="Try a shorter spelling or remove a vocabulary filter."
          />
        ) : undefined
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.headword}`}
          onPress={() => navigate({ name: 'word', id: item.id })}
          style={({ pressed }) => ({
            paddingVertical: 17,
            borderBottomWidth: 1,
            borderBottomColor: c.line,
            opacity: pressed ? 0.55 : 1,
            gap: 3,
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ ...ui.h2, flex: 1 }}>{item.headword}</Text>
            {item.ready.length > 0 && (
              <View
                style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.teal }}
                accessibilityLabel="Learning card available"
              />
            )}
            <Text style={{ ...ui.body, color: c.muted }} accessibilityElementsHidden>
              ›
            </Text>
          </View>
          <Text numberOfLines={1} style={ui.small}>
            {item.tags
              .filter((t) => t !== 'WORDNET')
              .slice(0, 4)
              .join(' / ') || 'English reference'}
          </Text>
        </Pressable>
      )}
    />
  );
}

function hideSpelling(text: string, word: Word): string {
  // Reference definitions can themselves contain the answer. Hide declared spellings
  // in the clue as well as the title, without changing persisted content.
  return [word.headword, ...word.variants]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce(
      (value, spelling) =>
        value.replace(
          new RegExp(
            '(^|[^\\p{L}\\p{N}])' +
              spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
              '(?=$|[^\\p{L}\\p{N}])',
            'giu',
          ),
          '$1_____',
        ),
      text,
    );
}

export function WordDetail({
  engine,
  refresh,
  notify,
  navigate,
  route,
  onNext,
}: ScreenProps & { route: Extract<Route, { name: 'word' }>; onNext?: () => void }) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const [word, setWord] = useState<Word | null>(null);
  const [senseId, setSenseId] = useState(route.senseId ?? '');
  const [revealed, setRevealed] = useState(!route.study);
  const [spelling, setSpelling] = useState(!!route.study);
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [rated, setRated] = useState(false);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const assisted = useRef(!route.study);
  const submitting = useRef(false);
  useEffect(() => {
    let active = true;
    setWord(null);
    setError('');
    setSenseId(route.senseId ?? '');
    setRevealed(!route.study);
    setSpelling(!!route.study);
    assisted.current = !route.study;
    setTyped('');
    setChecked(null);
    setRated(false);
    setSavedMessage('');
    engine
      .word(route.id, route.revision)
      .then((w) => {
        if (active) {
          setWord(w);
          if (!w) setError('This word is no longer available.');
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [route.id, route.revision, route.senseId, route.study]);
  const senses = useMemo(
    () =>
      [...(word?.senses ?? [])].sort(
        (a, b) => Number(b.status === 'ready') - Number(a.status === 'ready'),
      ),
    [word],
  );
  const sense: Sense | undefined = senses.find((s) => s.id === senseId) ?? senses[0];
  const target: Target | undefined =
    sense && word ? { kind: 'sense', id: sense.id, revision: word.revision } : undefined;
  async function check(revealAnswer = false) {
    if (
      !word ||
      !target ||
      (!revealAnswer && !typed.trim()) ||
      checked !== null ||
      submitting.current
    )
      return;
    submitting.current = true;
    setBusy(true);
    try {
      const correct = !revealAnswer && checkSpelling(typed, [word.headword, ...word.variants]);
      const helped = assisted.current;
      await engine.wordTest({
        id: id('attempt'),
        target,
        text: typed,
        assisted: helped,
        revealed: revealAnswer,
        createdAt: new Date().toISOString(),
      });
      setChecked(correct);
      setRated(true);
      refresh();
      setSavedMessage(
        revealAnswer
          ? 'Answer viewed. A short review is scheduled.'
          : !correct
            ? 'Needs practice. Saved to your mistake notebook.'
            : helped
              ? 'Correct after studying. A later test will check your recall.'
              : 'Recalled without help. Your review schedule is saved.',
      );
      assisted.current = true;
    } catch (e) {
      notify((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  function changeSense(s: Sense) {
    assisted.current = true;
    setSenseId(s.id);
    setRevealed(!route.study);
    setRated(false);
    setSpelling(false);
    setChecked(null);
    setTyped('');
    setSavedMessage('');
  }
  function toggleSpelling() {
    assisted.current = true;
    setSpelling(!spelling);
    setChecked(null);
    setTyped('');
    setRated(false);
    setSavedMessage('');
  }
  if (!word)
    return (
      <View style={ui.page}>
        {error ? (
          <Feedback kind="error">
            <Text style={ui.body}>{error}</Text>
          </Feedback>
        ) : (
          <Text style={ui.body}>Opening word…</Text>
        )}
      </View>
    );
  const headingSize = word.headword.length > 22 ? 34 : word.headword.length > 15 ? 40 : 52;
  const meaning = sense?.simpleDefinition ?? sense?.definition ?? 'No definition available.';
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[ui.page, { gap: 22 }]}>
      <View style={{ alignItems: 'center', paddingTop: 18, paddingBottom: 10, gap: 10 }}>
        <Text
          accessibilityRole="header"
          style={{
            color: c.ink,
            fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
            textAlign: 'center',
            fontSize: spelling && checked === null ? 34 : headingSize,
            lineHeight: spelling && checked === null ? 44 : headingSize + 12,
          }}
        >
          {spelling && checked === null ? 'Spell the word' : word.headword}
        </Text>
        <Text style={{ ...ui.small, textAlign: 'center' }}>
          {sense?.partOfSpeech ?? 'Word list entry'}
        </Text>
      </View>
      {senses.length > 1 && !spelling && (
        <Disclosure title={`Choose a meaning (${senses.length})`}>
          <View style={ui.row}>
            {senses.map((s, i) => (
              <Chip
                key={s.id}
                label={`Meaning ${i + 1}${s.status === 'ready' ? ' ✓' : ''}`}
                selected={sense?.id === s.id}
                onPress={() => changeSense(s)}
              />
            ))}
          </View>
        </Disclosure>
      )}
      {!sense ? (
        <Empty
          title="A meaning is still needed"
          text="This collected word does not have a definition yet. You can add a note or enrich it with a content pack."
        />
      ) : (
        <>
          {spelling ? (
            <View style={{ gap: 20 }}>
              <Text style={{ ...ui.body, textAlign: 'center', fontSize: 20, lineHeight: 30 }}>
                {checked === null ? hideSpelling(meaning, word) : meaning}
              </Text>
              <Field
                label="Your spelling"
                placeholder="Type the word"
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                editable={checked === null && !busy}
                onSubmitEditing={() => check()}
                returnKeyType="done"
                style={{ textAlign: 'center', fontSize: 22 }}
              />
              {checked === null ? (
                <View style={{ gap: 10 }}>
                  <Button
                    title="Check spelling"
                    onPress={() => check()}
                    disabled={!typed.trim()}
                    busy={busy}
                  />
                  <Button
                    title="Show answer"
                    secondary
                    disabled={busy}
                    onPress={() => check(true)}
                  />
                </View>
              ) : (
                <Feedback kind={checked ? 'success' : 'error'}>
                  <Text style={{ ...ui.h2, color: checked ? c.teal : c.red }}>
                    {checked ? 'Correct spelling' : 'Keep practising'}
                  </Text>
                  <Text style={ui.body}>Your answer: {typed}</Text>
                  <Text style={ui.body}>Correct spelling: {word.headword}</Text>
                  <Text style={ui.small}>{savedMessage}</Text>
                </Feedback>
              )}
            </View>
          ) : (
            <>
              <View
                style={{
                  paddingVertical: 20,
                  paddingHorizontal: 16,
                  borderRadius: 16,
                  backgroundColor: c.blue,
                  borderLeftWidth: 3,
                  borderLeftColor: c.teal,
                }}
              >
                <HighlightText
                  text={sense.examples[0] ?? 'Recall a sentence where you could use this word.'}
                  terms={[word.headword, ...word.variants]}
                  style={{ ...ui.body, textAlign: 'center', fontSize: 21, lineHeight: 33 }}
                />
              </View>
              {!revealed && (
                <View style={{ gap: 10 }}>
                  <Text style={{ ...ui.small, textAlign: 'center' }}>
                    Can you recall its meaning here?
                  </Text>
                  <Button
                    title="Reveal meaning"
                    onPress={() => {
                      assisted.current = true;
                      setRevealed(true);
                    }}
                  />
                </View>
              )}
              <Reveal visible={revealed}>
                <View style={{ gap: 20 }}>
                  <Text
                    style={{
                      ...ui.h2,
                      fontSize: 21,
                      lineHeight: 31,
                      textAlign: 'center',
                      fontWeight: '500',
                    }}
                  >
                    {meaning}
                  </Text>
                  {savedMessage ? (
                    <Feedback kind="success">
                      <Text style={ui.body}>{savedMessage}</Text>
                    </Feedback>
                  ) : null}
                  {sense.examples.length > 1 && (
                    <Disclosure title="More examples">
                      {sense.examples.slice(1).map((example, i) => (
                        <HighlightText
                          key={i}
                          text={example}
                          terms={[word.headword, ...word.variants]}
                          style={ui.body}
                        />
                      ))}
                    </Disclosure>
                  )}
                  {sense.synonyms.length > 0 && (
                    <Disclosure title="Similar words, different uses">
                      <Text style={{ ...ui.body, color: c.teal }}>{sense.synonyms.join(', ')}</Text>
                      <Text style={ui.body}>
                        {sense.synonymNote ??
                          'These words share this meaning. Their grammar or level of formality may differ.'}
                      </Text>
                    </Disclosure>
                  )}
                  {sense.collocations.length > 0 && (
                    <Disclosure title="Often used with">
                      <View style={ui.row}>
                        {sense.collocations.map((t) => (
                          <Chip key={t} label={t} />
                        ))}
                      </View>
                    </Disclosure>
                  )}
                  {sense.status !== 'ready' && (
                    <Text style={ui.small}>
                      Reference meaning. This explanation has not yet been rewritten in simple
                      English.
                    </Text>
                  )}
                </View>
              </Reveal>
            </>
          )}
          {checked !== null && (
            <Button
              title="Try spelling again"
              secondary
              disabled={busy}
              onPress={() => {
                setTyped('');
                setChecked(null);
                setRated(false);
                setSavedMessage('');
                setSpelling(true);
              }}
            />
          )}
          {rated && onNext && <Button title="Next review" onPress={onNext} />}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                title={spelling ? 'Read the meaning' : 'Practise spelling'}
                secondary
                disabled={busy || (!!route.study && checked === null)}
                onPress={toggleSpelling}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Add a note"
                secondary
                disabled={busy}
                onPress={() => navigate({ name: 'note', target })}
              />
            </View>
          </View>
        </>
      )}
      {!sense && <Button title="Write a note" onPress={() => navigate({ name: 'note' })} />}
    </ScrollView>
  );
}
