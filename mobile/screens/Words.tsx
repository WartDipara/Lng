import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, Chip, Empty, Field, Heading, ui } from '../components/UI';
import { colors as c } from '../theme';
import type { ScreenProps, Route } from '../routes';
import type { Word, Sense, Target } from '../../src/types.ts';
import { checkSpelling } from '../../src/notebook.ts';
import { id } from '../engine';
import type { Rating } from '../../src/learning.ts';

const tags = ['IELTS', 'TOEFL', 'CET4', 'CET6', 'GRE', 'SAT', 'NPEE', 'TEM8'];
export function WordsScreen({ engine, navigate }: ScreenProps) {
  const [query, setQuery] = useState(''); const [delayed, setDelayed] = useState('');
  const [tag, setTag] = useState(''); const [ready, setReady] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setDelayed(query), 160); return () => clearTimeout(timer); }, [query]);
  const rows = useMemo(() => engine.searchWords(delayed, tag, ready), [engine.words, delayed, tag, ready]);
  return <FlatList data={rows} keyExtractor={w => w.id} contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled"
    ListHeaderComponent={<View style={{ gap: 16, marginBottom: 10 }}><Heading title="Words in context" subtitle="Learn a meaning. Notice how it works." />
      <Field label="Search the offline dictionary" placeholder="Try contingent, nuance, or take off" value={query} onChangeText={setQuery} autoCorrect={false} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}><Chip label="All words" selected={!ready && !tag} onPress={() => { setReady(false); setTag(''); }} /><Chip label="Learning cards" selected={ready} onPress={() => setReady(!ready)} />{tags.map(t => <Chip key={t} label={t} selected={tag === t} onPress={() => setTag(tag === t ? '' : t)} />)}</ScrollView>
      <Text style={ui.small}>{engine.words.length.toLocaleString()} entries on your device. Showing up to 100 matches.</Text>
    </View>}
    ListEmptyComponent={<Empty title="No matching words" text="Try a shorter spelling or remove a vocabulary filter." />}
    renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.headword}`} onPress={() => navigate({ name: 'word', id: item.id })} style={({ pressed }) => ({ paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: c.line, opacity: pressed ? 0.5 : 1 })}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}><Text style={{ ...ui.h2, flex: 1 }}>{item.headword}</Text>{item.ready.length > 0 && <Text style={{ ...ui.small, color: c.teal }}>Learning card</Text>}</View>
      <Text numberOfLines={1} style={ui.small}>{item.tags.filter(t => t !== 'WORDNET').slice(0, 5).join(' / ') || 'English reference'}</Text>
    </Pressable>} />;
}

export function WordDetail({ engine, refresh, notify, navigate, route, onNext }: ScreenProps & { route: Extract<Route, { name: 'word' }>; onNext?: () => void }) {
  const [word, setWord] = useState<Word | null>(null); const [senseId, setSenseId] = useState(route.senseId ?? '');
  const [revealed, setRevealed] = useState(!route.study); const [spelling, setSpelling] = useState(false);
  const [typed, setTyped] = useState(''); const [checked, setChecked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false); const [rated, setRated] = useState(false); const [error, setError] = useState('');
  useEffect(() => { let active = true; engine.word(route.id, route.revision).then(w => { if (active) { setWord(w); if (!w) setError('This word is no longer available.'); } }).catch(e => active && setError(e.message)); return () => { active = false; }; }, [route.id, route.revision]);
  const senses = useMemo(() => [...word?.senses ?? []].sort((a, b) => Number(b.status === 'ready') - Number(a.status === 'ready')), [word]);
  const sense: Sense | undefined = senses.find(s => s.id === senseId) ?? senses[0];
  const target: Target | undefined = sense && word ? { kind: 'sense', id: sense.id, revision: word.revision } : undefined;
  async function rate(rating: Rating) {
    if (!target || busy || rated) return; setBusy(true);
    try {
      await engine.attempt({ id: id('attempt'), kind: 'recall', target, answer: rating, score: rating === 'Again' ? 0 : 1, maxScore: 1, createdAt: new Date().toISOString() }, rating);
      setRated(true); refresh(); notify(rating === 'Again' ? 'Saved. Review again in 10 minutes.' : 'Saved to your review schedule.');
    } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  }
  async function check() {
    if (!word || !target || !typed.trim() || checked !== null) return; setBusy(true);
    try {
      const correct = checkSpelling(typed, [word.headword, ...word.variants]);
      await engine.attempt({ id: id('attempt'), kind: 'spelling', target, answer: typed, score: Number(correct), maxScore: 1, createdAt: new Date().toISOString() }, correct ? 'Good' : 'Again');
      setChecked(correct); setRated(true); refresh();
    } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  }
  if (!word) return <View style={ui.page}><Text style={ui.body}>{error || 'Opening word…'}</Text></View>;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.page}>
    <Heading title={spelling && checked === null ? 'Spell the word' : word.headword} subtitle={sense ? `${sense.partOfSpeech} • ${sense.status === 'ready' ? 'Learning card' : 'Reference meaning'}` : 'Word list entry'} />
    {senses.length > 1 && <ScrollView horizontal contentContainerStyle={{ gap: 8 }} showsHorizontalScrollIndicator={false}>{senses.map((s, i) => <Chip key={s.id} label={`Meaning ${i + 1}${s.status === 'ready' ? ' ✓' : ''}`} selected={sense?.id === s.id} onPress={() => { setSenseId(s.id); setRevealed(true); setRated(false); setSpelling(false); setChecked(null); setTyped(''); }} />)}</ScrollView>}
    {!sense ? <Empty title="A meaning is still needed" text="This word is in a collected list. Import an enriched content pack to add definitions and examples, or make your own note." /> : <>
      {sense.status !== 'ready' && <Text style={ui.small}>Reference content has not yet been rewritten in simple English. You can still choose to review it.</Text>}
      {spelling ? <Card><Text style={ui.h2}>{sense.simpleDefinition ?? sense.definition}</Text><Field label="Your spelling" value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} editable={checked === null} onSubmitEditing={check} />
        {checked === null ? <Button title="Check spelling" onPress={check} disabled={!typed.trim()} busy={busy} /> : <View style={{ gap: 8 }}><Text style={{ ...ui.h2, color: checked ? c.teal : c.red }}>{checked ? 'Correct spelling' : 'Keep practising'}</Text><Text style={ui.body}>Your answer: {typed}</Text><Text style={ui.body}>Correct spelling: {word.headword}</Text>{!checked && <Text style={ui.small}>This spelling has been added to your mistake notebook.</Text>}</View>}
      </Card> : <>
        <Card style={{ backgroundColor: c.blue }}><Text style={ui.small}>In context</Text><Text style={{ ...ui.body, fontSize: 20, lineHeight: 31 }}>{sense.examples[0] ?? 'Think of a sentence where you could use this word.'}</Text></Card>
        {!revealed ? <Button title="Reveal meaning" onPress={() => setRevealed(true)} /> : <>
          <View style={{ gap: 12 }}><Text style={ui.h2}>{sense.simpleDefinition ?? sense.definition ?? 'No definition available.'}</Text>{sense.examples.slice(1).map((e, i) => <Text key={i} style={ui.body}>{e}</Text>)}</View>
          {sense.synonyms.length > 0 && <Card><Text style={ui.h2}>Similar words, different uses</Text><Text style={{ ...ui.body, color: c.teal }}>{sense.synonyms.join(', ')}</Text><Text style={ui.body}>{sense.synonymNote ?? 'These words share this meaning. They may not fit the same sentence or level of formality.'}</Text></Card>}
          {sense.collocations.length > 0 && <View style={{ gap: 8 }}><Text style={ui.h2}>Often used with</Text><View style={ui.row}>{sense.collocations.map(t => <Chip key={t} label={t} />)}</View></View>}
          {!rated && <View style={{ gap: 10 }}><Text style={ui.small}>How well did you remember this meaning?</Text><View style={ui.row}>{(['Again', 'Hard', 'Good', 'Easy'] as Rating[]).map(r => <Button key={r} title={r} secondary={r !== 'Good'} disabled={busy} onPress={() => rate(r)} />)}</View></View>}
        </>}
      </>}
      <View style={ui.row}><Button title={spelling ? 'Read the meaning' : 'Practise spelling'} secondary onPress={() => { setSpelling(!spelling); setChecked(null); setTyped(''); setRated(false); }} /><Button title="Add a note" secondary onPress={() => navigate({ name: 'note', target })} /></View>
      {rated && onNext && <Button title="Next review" onPress={onNext} />}
    </>}
    {!sense && <Button title="Write a note" onPress={() => navigate({ name: 'note' })} />}
  </ScrollView>;
}
