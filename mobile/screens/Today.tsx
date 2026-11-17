import { MenuRow } from '../components/MenuRow';
import { inScope, dueStudyTargets } from '../study-selection.ts';
import React from 'react';
import { FlatList, ScrollView, Text, View } from 'react-native';
import { Button, Card, Heading, Empty, useUI } from '../components/UI';
import { useTheme } from '../theme';
import { studiedToday, sameLocalDay } from '../../src/learning.ts';
import type { ScreenProps } from '../routes';

export function TodayScreen({
  engine,
  navigate,
  startNew,
  startDue,
}: ScreenProps & { startNew: () => void; startDue: () => void }) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const now = new Date();
  const due = dueStudyTargets(engine, now);
  const mistakes = engine.user.mistakes.filter((m) => !m.mastered).length;
  const answered = engine.user.attempts.filter(
    (a) => a.kind === 'question' && sameLocalDay(a.createdAt, now),
  );
  const words = studiedToday(engine.user);
  return (
    <ScrollView contentContainerStyle={[ui.page, { gap: 24 }]}>
      <Heading
        title="A little English, every day."
        subtitle={now.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
      />
      <View style={{ padding: 22, borderRadius: 24, backgroundColor: c.paper, gap: 22 }}>
        <Text style={{ ...ui.body, fontSize: 18, lineHeight: 28 }}>
          {due.length
            ? 'Pick up where your memory needs you.'
            : 'Start with a sentence. Make the word yours.'}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            paddingVertical: 15,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: c.line,
          }}
        >
          <Metric value={due.length} label="Due" />
          <Metric value={words} label="Words today" />
          <Metric value={answered.length} label="Tasks today" />
        </View>
        <Button
          title={due.length ? 'Start today’s review' : 'Learn new words'}
          onPress={due.length ? startDue : startNew}
        />
        <Text style={{ ...ui.small, textAlign: 'center' }}>
          {due.length
            ? `${due.length} ${due.length === 1 ? 'review' : 'reviews'} ready. Take them at your pace.`
            : `Your daily plan: ${engine.user.settings.dailyNewLimit} new meanings.`}
        </Text>
      </View>
      <View>
        <MenuRow
          title="Use of English"
          icon="reader-outline"
          onPress={() => navigate({ name: 'practice' })}
        />
        <MenuRow
          title="Mistake notebook"
          detail={mistakes ? `${mistakes} items to revisit` : undefined}
          icon="refresh-outline"
          onPress={() => navigate({ name: 'mistakes' })}
        />
        <MenuRow
          title="Review schedule"
          icon="calendar-outline"
          onPress={() => navigate({ name: 'reviews' })}
        />
      </View>
    </ScrollView>
  );
}
function Metric({ value, label }: { value: number; label: string }) {
  const ui = useUI();
  const { colors: c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
      <Text style={{ color: c.ink, fontSize: 28, lineHeight: 34, fontWeight: '500' }}>{value}</Text>
      <Text style={ui.small}>{label}</Text>
    </View>
  );
}
export function ReviewsScreen({ engine, openTarget }: ScreenProps) {
  const ui = useUI();
  const reviews = [...engine.user.reviews]
    .filter((r) => inScope(engine, r.target))
    .sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0));
  return (
    <FlatList
      data={reviews}
      keyExtractor={(review) =>
        `${review.target.kind}:${review.target.id}:${review.target.revision}`
      }
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={5}
      contentContainerStyle={ui.page}
      ListHeaderComponent={
        <Heading title="Your next reviews" subtitle="A little space helps a word stay." />
      }
      ListEmptyComponent={
        <Empty
          title="Your schedule starts with practice"
          text="Complete a spelling test or answer a question, and its next review will appear here."
        />
      }
      renderItem={({ item: r }) => (
        <ReviewRow engine={engine} review={r} onPress={() => openTarget(r.target)} />
      )}
    />
  );
}
function ReviewRow({
  engine,
  review,
  onPress,
}: {
  engine: ScreenProps['engine'];
  review: ScreenProps['engine']['user']['reviews'][number];
  onPress: () => void;
}) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const [title, setTitle] = React.useState('Opening content…');
  React.useEffect(() => {
    let active = true;
    (async () => {
      const label =
        review.target.kind === 'question'
          ? (await engine.question(review.target.id, review.target.revision))?.title
          : (await engine.sense(review.target.id, review.target.revision))?.word.headword;
      if (active) setTitle(label ?? 'Content unavailable');
    })().catch(() => active && setTitle('Content unavailable'));
    return () => {
      active = false;
    };
  }, [review.target.id, review.target.revision]);
  const due = Date.parse(review.dueAt) <= Date.now();
  return (
    <Card>
      <Text style={ui.h2}>{title}</Text>
      <Text style={{ ...ui.small, color: due ? c.teal : c.muted }}>
        {due
          ? 'Ready to review'
          : `Next review: ${new Date(review.dueAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
      </Text>
      <Button
        title="Practise now"
        secondary
        onPress={onPress}
        disabled={!engine.targetExists(review.target)}
      />
    </Card>
  );
}
