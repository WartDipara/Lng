import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, Heading, Empty, useUI } from '../components/UI';
import { useTheme } from '../theme';
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
  const ui = useUI(); const { colors: c } = useTheme();
  const now = new Date(); const due = dueReviews(engine.user).filter(r => inScope(engine, r.target));
  const mistakes = engine.user.mistakes.filter(m => !m.mastered).length;
  const answered = engine.user.attempts.filter(a => a.kind === 'question' && sameLocalDay(a.createdAt, now));
  const words = studiedToday(engine.user);
  return <ScrollView contentContainerStyle={[ui.page, { gap: 24 }]}>
    <Heading title="A little English, every day." subtitle={now.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })} />
    <View style={{ paddingVertical: 10, gap: 18 }}>
      <Text style={{ ...ui.body, fontSize: 18, lineHeight: 28 }}>{due.length ? 'Pick up where your memory needs you.' : 'Start with a sentence. Make the word yours.'}</Text>
      <View style={{ flexDirection: 'row', paddingVertical: 15, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line }}><Metric value={due.length} label="Due" /><Metric value={words} label="Words today" /><Metric value={answered.length} label="Tasks today" /></View>
      <Button title={due.length ? 'Start today’s review' : 'Learn new words'} onPress={due.length ? startDue : startNew} />
      <Text style={{ ...ui.small, textAlign: 'center' }}>{due.length ? `${due.length} ${due.length === 1 ? 'review' : 'reviews'} ready. Take them at your pace.` : `Your daily plan: ${engine.user.settings.dailyNewLimit} new meanings.`}</Text>
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      <Action title="Use of English" text="Read. Think. Apply." onPress={() => navigate({ name: 'practice' })} />
      <Action title="Mistake notebook" text={mistakes ? `${mistakes} ${mistakes === 1 ? 'item' : 'items'} to revisit.` : 'Learn from each attempt.'} onPress={() => navigate({ name: 'mistakes' })} />
      <Action title="New words" text={`${engine.user.settings.dailyNewLimit} meanings a day.`} onPress={startNew} />
      <Action title="Review schedule" text="See what comes next." onPress={() => navigate({ name: 'reviews' })} />
    </View>
    <Text style={{ ...ui.small, textAlign: 'center' }}>Offline, and at your pace.</Text>
  </ScrollView>;
}
function Metric({ value, label }: { value: number; label: string }) {
  const ui = useUI(); const { colors: c } = useTheme();
  return <View style={{ flex: 1, alignItems: 'center', gap: 3 }}><Text style={{ color: c.ink, fontSize: 28, lineHeight: 34, fontWeight: '500' }}>{value}</Text><Text style={ui.small}>{label}</Text></View>;
}
function Action({ title, text, onPress }: { title: string; text: string; onPress: () => void }) {
  const ui = useUI(); const { colors: c } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => ({ flexBasis: '46%', flexGrow: 1, minWidth: 120, minHeight: 122, padding: 16, borderRadius: 18, backgroundColor: c.paper, borderColor: c.line, borderWidth: 1, justifyContent: 'space-between', gap: 12, opacity: pressed ? 0.55 : 1 })}>
    <Text style={{ ...ui.h2, fontSize: 17, lineHeight: 24 }}>{title}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Text style={[ui.small, { flex: 1 }]}>{text}</Text><Text style={{ ...ui.body, color: c.teal }} accessibilityElementsHidden>›</Text></View>
  </Pressable>;
}
export function ReviewsScreen({ engine, openTarget }: ScreenProps) {
  const ui = useUI();
  const reviews = [...engine.user.reviews].filter(r => inScope(engine, r.target)).sort((a, b) => a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0);
  return <ScrollView contentContainerStyle={ui.page}><Heading title="Your next reviews" subtitle="A little space helps a word stay." />{!reviews.length && <Empty title="Your schedule starts with practice" text="Complete a spelling test or answer a question, and its next review will appear here." />}{reviews.map(r => <ReviewRow key={`${r.target.id}:${r.target.revision}`} engine={engine} review={r} onPress={() => openTarget(r.target)} />)}</ScrollView>;
}
function ReviewRow({ engine, review, onPress }: { engine: ScreenProps['engine']; review: ScreenProps['engine']['user']['reviews'][number]; onPress: () => void }) {
  const ui = useUI(); const { colors: c } = useTheme();
  const [title, setTitle] = React.useState('Opening content…');
  React.useEffect(() => { let active = true; (async () => {
    const label = review.target.kind === 'question' ? (await engine.question(review.target.id, review.target.revision))?.title : (await engine.sense(review.target.id, review.target.revision))?.word.headword;
    if (active) setTitle(label ?? 'Content unavailable');
  })().catch(() => active && setTitle('Content unavailable')); return () => { active = false; }; }, [review.target.id, review.target.revision]);
  const due = Date.parse(review.dueAt) <= Date.now();
  return <Card><Text style={ui.h2}>{title}</Text><Text style={{ ...ui.small, color: due ? c.teal : c.muted }}>{due ? 'Ready to review' : `Next review: ${new Date(review.dueAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}</Text><Button title="Practise now" secondary onPress={onPress} disabled={!engine.targetExists(review.target)} /></Card>;
}
