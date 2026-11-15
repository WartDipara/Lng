import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, Chip, Empty, Field, Heading, ui } from '../components/UI';
import { QuestionPanel } from '../components/QuestionPanel';
import type { ScreenProps, Route } from '../routes';
import type { Passage, Question, Target } from '../../src/types.ts';
import { grade } from '../../src/grading.ts';
import { id } from '../engine';
import { colors as c } from '../theme';

export function PracticeScreen({ engine, navigate }: ScreenProps) {
  const [query, setQuery] = useState(''); const [type, setType] = useState('');
  const types = [...new Set(engine.questions.map(q => q.type))];
  const rows = engine.questions.filter(q => (!type || q.type === type) && `${q.title} ${q.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const attempts = new Map(engine.user.attempts.filter(a => a.kind === 'question').map(a => [a.target.id, a]));
  return <FlatList data={rows} contentContainerStyle={ui.page} keyExtractor={q => q.id}
    ListHeaderComponent={<View style={{ gap: 16, marginBottom: 12 }}><Heading title="Use of English" subtitle="Read closely. Choose precisely. Make the language yours." /><Button title="Open mistake notebook" secondary onPress={() => navigate({ name: 'mistakes' })} />
      <Field label="Find a practice task" value={query} onChangeText={setQuery} placeholder="Search topic or title" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}><Chip label="All types" selected={!type} onPress={() => setType('')} />{types.map(t => <Chip key={t} label={t.replaceAll('-', ' ')} selected={type === t} onPress={() => setType(type === t ? '' : t)} />)}</ScrollView>
      <Text style={ui.small}>{rows.length} tasks available offline</Text></View>}
    ListEmptyComponent={<Empty title="No tasks here yet" text="Choose another filter or import a content pack from Library." />}
    renderItem={({ item }) => { const attempt = attempts.get(item.id); return <Pressable accessibilityRole="button" onPress={() => navigate({ name: 'question', id: item.id })} style={{ paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: c.line, gap: 6 }}><Text style={ui.small}>{item.type.replaceAll('-', ' ')}</Text><Text style={ui.h2}>{item.title}</Text><Text style={{ ...ui.small, color: attempt ? attempt.score === attempt.maxScore ? c.teal : c.red : c.muted }}>{attempt ? `Last attempt ${attempt.score}/${attempt.maxScore}` : 'Not attempted'}</Text></Pressable>; }} />;
}

export function QuestionScreen({ engine, refresh, notify, navigate, route, onNext }: ScreenProps & { route: Extract<Route, { name: 'question' }>; onNext?: () => void }) {
  const [question, setQuestion] = useState<Question | null>(null); const [passage, setPassage] = useState<Passage>();
  const [answer, setAnswer] = useState<unknown>(null); const [result, setResult] = useState<{ score: number; maxScore: number }>();
  const [error, setError] = useState('');
  useEffect(() => { let active = true;
    (async () => { const q = await engine.question(route.id, route.revision); if (!q) throw new Error('This question is unavailable. Import its original content pack.');
      const p = q.passageId ? await engine.passage(q.passageId, q.passageRevision!) : undefined;
      if (active) { setQuestion(q); setPassage(p ?? undefined); }
    })().catch(e => active && setError(e.message));
    return () => { active = false; };
  }, [route.id, route.revision]);
  if (!question) return <View style={ui.page}><Text style={ui.body}>{error || 'Opening practice…'}</Text></View>;
  const target: Target = { kind: 'question', id: question.id, revision: question.revision };
  async function submit() {
    if (!question || result) return;
    const score = grade(question, answer);
    try {
      await engine.attempt({ id: id('attempt'), target, kind: 'question', answer, ...score, createdAt: new Date().toISOString() }, score.score === score.maxScore ? 'Good' : 'Again');
      setResult(score); refresh();
    } catch (e) { notify((e as Error).message); throw e; }
  }
  async function openWord(sid: string) { const value = await engine.sense(sid); if (value) navigate({ name: 'word', id: value.word.id, senseId: sid }); else notify('Import the vocabulary pack for this word.'); }
  return <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled"><QuestionPanel key={`${question.id}:${question.revision}`} question={question} passage={passage} answer={answer} onChange={setAnswer} submitted={!!result} result={result} onSubmit={submit} onNext={onNext} onNote={() => navigate({ name: 'note', target })} onWord={openWord} />
    <Text style={ui.small}>{question.origin === 'original' ? 'Original practice' : question.origin === 'past-paper' ? `Past paper: ${question.exam?.name} ${question.exam?.year}` : `Official sample: ${question.exam?.name}`}. Practice scores do not predict an IELTS band.</Text>
  </ScrollView>;
}
