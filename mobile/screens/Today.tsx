import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, Heading, Empty, ui } from '../components/UI';
import { colors as c } from '../theme';
import { dueReviews, studiedToday, sameLocalDay } from '../../src/learning.ts';
import type { Target } from '../../src/types.ts';
import type { ScreenProps } from '../routes';

export function inScope(engine: ScreenProps['engine'], target: Target): boolean {
  const tags = engine.user.settings.selectedTags;
  if (!tags.length) return true;
  const content = target.kind === 'question' ? engine.questions.find(q => q.id === target.id) : engine.words.find(w => w.ready.includes(target.id) || engine.catalog.entities.vocabulary[w.id]?.[target.revision]?.senseIds?.includes(target.id));
  return Boolean(content && tags.some(tag => content.tags.includes(tag)));
}
export function TodayScreen({ engine, navigate, startNew, startDue }: ScreenProps & { startNew: () => void; startDue: () => void }) {
  const now = new Date(); const due = dueReviews(engine.user).filter(r => inScope(engine, r.target));
  const mistakes = engine.user.mistakes.filter(m => !m.mastered).length;
  const answered = engine.user.attempts.filter(a => a.kind === 'question' && sameLocalDay(a.createdAt, now));
  const words = studiedToday(engine.user);
  return <ScrollView contentContainerStyle={ui.page}>
    <Heading title="A little English, every day." subtitle={now.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })} />
    <Card style={{ backgroundColor: c.ink, borderColor: c.ink, padding: 26, gap: 18 }}>
      <Text style={{ fontSize: 15, color: '#BFDAD9' }}>Your next chapter</Text>
      <Text style={{ fontSize: 28, color: 'white', lineHeight: 36 }}>{due.length ? `${due.length} ${due.length === 1 ? 'meaning or task is' : 'meanings and tasks are'} ready to revisit.` : 'Make a new word part of your English.'}</Text>
      <Text style={{ fontSize: 15, lineHeight: 24, color: '#D9E6EE' }}>Start with a sentence. Recall its meaning. Come back when it matters.</Text>
      <Button title={due.length ? 'Start today’s review' : 'Learn new words'} onPress={due.length ? startDue : startNew} />
    </Card>
    <View style={{ flexDirection: 'row', gap: 12 }}><View style={{ flex: 1, gap: 5, padding: 12 }}><Text style={{ fontSize: 30, color: c.ink }}>{words}</Text><Text style={ui.small}>meanings practised today</Text></View><View style={{ flex: 1, gap: 5, padding: 12 }}><Text style={{ fontSize: 30, color: c.ink }}>{answered.length}</Text><Text style={ui.small}>tasks completed today</Text></View></View>
    <Text accessibilityRole="header" style={ui.h2}>Keep the language moving</Text>
    <Action title="Learn new words" text={`${engine.user.settings.dailyNewLimit} new meanings a day, at your pace.`} onPress={startNew} />
    <Action title="Use of English" text="Reading, grammar, word choice and clear expression." onPress={() => navigate({ name: 'practice' })} />
    <Action title="Mistake notebook" text={mistakes ? `${mistakes} places to practise again.` : 'Turn a wrong answer into something you remember.'} onPress={() => navigate({ name: 'mistakes' })} />
    <Action title="Review schedule" text="See what is due and choose what to revisit." onPress={() => navigate({ name: 'reviews' })} />
    <Text style={ui.small}>Available offline. Your learning stays on this device.</Text>
  </ScrollView>;
}
function Action({ title, text, onPress }: { title: string; text: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ paddingVertical: 13, borderBottomColor: c.line, borderBottomWidth: 1, gap: 5, opacity: pressed ? 0.6 : 1 })}><Text style={ui.h2}>{title}</Text><Text style={ui.body}>{text}</Text></Pressable>;
}
export function ReviewsScreen({ engine, openTarget }: ScreenProps) {
  const reviews = [...engine.user.reviews].filter(r => inScope(engine, r.target)).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return <ScrollView contentContainerStyle={ui.page}><Heading title="Your next reviews" subtitle="Spacing practice helps you keep what you learn." />
    {!reviews.length && <Empty title="Your schedule starts with practice" text="Rate a word or answer a question, and its next review will appear here." />}
    {reviews.map(r => <ReviewRow key={`${r.target.id}:${r.target.revision}`} engine={engine} review={r} onPress={() => openTarget(r.target)} />)}
  </ScrollView>;
}
function ReviewRow({ engine, review, onPress }: { engine: ScreenProps['engine']; review: ScreenProps['engine']['user']['reviews'][number]; onPress: () => void }) {
  const [title, setTitle] = React.useState('Opening content…');
  React.useEffect(() => { let active = true; (async () => {
    const label = review.target.kind === 'question' ? (await engine.question(review.target.id, review.target.revision))?.title : (await engine.sense(review.target.id, review.target.revision))?.word.headword;
    if (active) setTitle(label ?? 'Content unavailable');
  })().catch(() => active && setTitle('Content unavailable')); return () => { active = false; }; }, []);
  const due = Date.parse(review.dueAt) <= Date.now();
  return <Card><Text style={ui.h2}>{title}</Text><Text style={{ ...ui.small, color: due ? c.teal : c.muted }}>{due ? 'Ready to review' : `Next review: ${new Date(review.dueAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}</Text><Button title="Practise now" secondary onPress={onPress} disabled={!engine.targetExists(review.target)} /></Card>;
}
