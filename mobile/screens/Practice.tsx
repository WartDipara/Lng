import { practicePolicy } from '../../src/policy.ts';
import { sessionSummary } from '../../src/practice-session.ts';
import { latest } from '../../src/catalog.ts';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, Empty, Field, Heading, useUI } from '../components/UI';
import { QuestionPanel } from '../components/QuestionPanel';
import type { ScreenProps, Route } from '../routes';
import type { Passage, Question, Target } from '../../src/types.ts';
import { questionFeedback, type QuestionOutcome } from '../../src/question-progress.ts';
import { id } from '../engine';
import { useTheme } from '../theme';

export function PracticeScreen({ engine, navigate, refresh, notify }: ScreenProps) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const styles = useMemo(() => createStyles(c), [c]);
  const [count, setCount] = useState(
    String(engine.user.practiceSize ?? practicePolicy.defaultSize),
  );
  const [starting, setStarting] = useState(false);
  const totalResults = (engine.user.practiceSessions ?? [])
    .filter((s) => s.submittedAt)
    .reduce(
      (total, session) => {
        const r = sessionSummary(session);
        return { correct: total.correct + r.correct, total: total.total + r.total };
      },
      { correct: 0, total: 0 },
    );
  const unfinished = engine.user.practiceSessions?.find((s) => !s.submittedAt);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const types = [...new Set(engine.questions.map((q) => q.type))];
  const rows = engine.questions.filter(
    (q) =>
      (!type || q.type === type) &&
      `${q.title} ${q.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
  );
  const attempts = new Map(
    engine.user.attempts
      .filter((a) => a.kind === 'question')
      .map((a) => [`${a.target.id}@${a.target.revision}`, a]),
  );
  return (
    <FlatList
      data={rows}
      contentContainerStyle={ui.page}
      keyExtractor={(q) => q.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.header}>
          <Heading title="Use of English" />
          <Card>
            <Text style={ui.h2}>Practice in sets</Text>
            <Text style={ui.body}>
              {engine.questions.length} available ·{' '}
              {
                new Set(
                  engine.user.attempts
                    .filter(
                      (a) =>
                        a.kind === 'question' &&
                        latest(engine.catalog.entities.questions[a.target.id])?.revision ===
                          a.target.revision,
                    )
                    .map((a) => a.target.id),
                ).size
              }{' '}
              attempted
            </Text>
            <Text style={ui.small}>
              Set accuracy:{' '}
              {totalResults.total
                ? `${Math.round((totalResults.correct / totalResults.total) * 100)}% (${totalResults.correct}/${totalResults.total})`
                : 'No submitted sets yet'}
            </Text>
            {unfinished ? (
              <Button
                title={`Resume ${unfinished.items.length}-question set`}
                onPress={() => navigate({ name: 'practice-session', id: unfinished.id })}
              />
            ) : (
              <>
                <Field
                  label="Questions per set"
                  value={count}
                  onChangeText={setCount}
                  keyboardType="number-pad"
                />
                <Text style={ui.small}>
                  Choose 1–{Math.min(practicePolicy.maxSize, rows.length)} from the current filter (
                  {rows.length} available). Results appear after submitting the entire set.
                </Text>
                <Button
                  title="Start practice set"
                  busy={starting}
                  disabled={!rows.length}
                  onPress={async () => {
                    setStarting(true);
                    try {
                      const id = await engine.startPractice(
                        Number(count),
                        rows.map((q) => q.id),
                      );
                      refresh();
                      navigate({ name: 'practice-session', id });
                    } catch (e) {
                      notify((e as Error).message);
                    } finally {
                      setStarting(false);
                    }
                  }}
                />
              </>
            )}
            <Button
              title="My progress and accuracy"
              secondary
              onPress={() => navigate({ name: 'profile' })}
            />
          </Card>
          <Field
            label="Find a practice task"
            value={query}
            onChangeText={setQuery}
            placeholder="Search topic or title"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            <Chip label="All types" selected={!type} onPress={() => setType('')} />
            {types.map((t) => (
              <Chip
                key={t}
                label={t.replaceAll('-', ' ')}
                selected={type === t}
                onPress={() => setType(type === t ? '' : t)}
              />
            ))}
          </ScrollView>
          <View style={styles.listCaption}>
            <Text style={ui.small}>{rows.length} tasks available offline</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open mistake notebook"
              onPress={() => navigate({ name: 'mistakes' })}
              style={({ pressed }) => [styles.notebookLink, pressed && styles.pressed]}
            >
              <Text style={styles.linkText}>Mistakes</Text>
            </Pressable>
          </View>
        </View>
      }
      ListEmptyComponent={
        <Empty
          title="No tasks here yet"
          text="Choose another filter or import a content pack from Library."
        />
      }
      renderItem={({ item }) => {
        const attempt = attempts.get(
          `${item.id}@${latest(engine.catalog.entities.questions[item.id])?.revision}`,
        );
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => navigate({ name: 'question', id: item.id })}
            style={({ pressed }) => [styles.taskRow, pressed && styles.taskPressed]}
          >
            <Text style={ui.small}>{item.type.replaceAll('-', ' ')}</Text>
            <Text style={ui.h2}>{item.title}</Text>
            {attempt && (
              <Text
                style={[
                  ui.small,
                  attempt.score === attempt.maxScore ? styles.success : styles.review,
                ]}
              >{`Last attempt ${attempt.score}/${attempt.maxScore}`}</Text>
            )}
          </Pressable>
        );
      }}
    />
  );
}

export function QuestionScreen({
  engine,
  refresh,
  notify,
  navigate,
  route,
  onNext,
}: ScreenProps & { route: Extract<Route, { name: 'question' }>; onNext?: () => void }) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const styles = useMemo(() => createStyles(c), [c]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [passage, setPassage] = useState<Passage>();
  const [answer, setAnswer] = useState<unknown>(null);
  const [result, setResult] = useState<{
    score: number;
    maxScore: number;
    outcome: QuestionOutcome;
  }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setQuestion(null);
    setPassage(undefined);
    setAnswer(null);
    setResult(undefined);
    setError('');
    (async () => {
      const q = await engine.question(route.id, route.revision);
      if (!q) throw new Error('This question is unavailable. Import its original content pack.');
      const p = q.passageId ? await engine.passage(q.passageId, q.passageRevision!) : undefined;
      if (active) {
        setQuestion(q);
        setPassage(p ?? undefined);
      }
    })().catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [route.id, route.revision]);
  if (!question)
    return (
      <View style={ui.page}>
        <Text style={ui.body}>{error || 'Opening practice…'}</Text>
      </View>
    );
  const target: Target = { kind: 'question', id: question.id, revision: question.revision };
  async function submit() {
    if (!question || result) return;
    try {
      const score = await engine.questionTest({
        id: id('attempt'),
        target,
        answer,
        createdAt: new Date().toISOString(),
      });
      setResult(score);
      refresh();
    } catch (e) {
      notify((e as Error).message);
      throw e;
    }
  }
  async function openWord(sid: string) {
    const value = await engine.sense(sid);
    if (value) navigate({ name: 'word', id: value.word.id, senseId: sid });
    else notify('Import the vocabulary pack for this word.');
  }
  return (
    <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      <QuestionPanel
        key={`${question.id}:${question.revision}`}
        question={question}
        passage={passage}
        answer={answer}
        onChange={setAnswer}
        submitted={!!result}
        result={result}
        feedback={result ? questionFeedback[result.outcome] : undefined}
        onSubmit={submit}
        onNext={onNext}
        onNote={() => navigate({ name: 'note', target })}
        onWord={openWord}
      />
      <Text style={styles.footnote}>Practice scores do not predict an IELTS band.</Text>
    </ScrollView>
  );
}

const createStyles = (c: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    header: { gap: 18, marginBottom: 0 },
    filters: { gap: 8 },
    listCaption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    notebookLink: {
      minHeight: 48,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    linkText: { color: c.teal, fontSize: 14, fontWeight: '600' },
    taskRow: {
      paddingVertical: 24,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
      gap: 8,
      minHeight: 88,
    },
    taskPressed: { backgroundColor: c.blue, opacity: 0.8 },
    pressed: { opacity: 0.65 },
    success: { color: c.teal },
    review: { color: c.red },
    footnote: { color: c.muted, fontSize: 12, lineHeight: 19, paddingBottom: 8 },
  });
