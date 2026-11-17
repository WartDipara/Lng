import React, { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, Heading, useUI } from '../components/UI';
import { LearningWindow } from '../components/LearningWindow';
import { QuestionPanel } from '../components/QuestionPanel';
import { sessionSummary } from '../../src/practice-session.ts';
import type { ScreenProps } from '../routes';

export function PracticeSessionScreen({
  engine,
  refresh,
  navigate,
  sessionId,
  onDirtyChange,
}: ScreenProps & {
  sessionId: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const ui = useUI();
  const session = engine.user.practiceSessions?.find((s) => s.id === sessionId);
  const [index, setIndex] = useState(() =>
    Math.max(0, session?.items.findIndex((i) => !i.attemptId) ?? 0),
  );
  const [reviewing, setReviewing] = useState(false);
  const [draft, setDraft] = useState<unknown>(session?.items[index]?.answer ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const pending = useRef(Promise.resolve());
  const version = useRef(0);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  if (!session)
    return (
      <View style={ui.page}>
        <Heading title="Practice unavailable" />
      </View>
    );
  const item = session.items[index];
  const done = !!session.submittedAt;
  const checked = !!item.attemptId;
  const summary = sessionSummary(session);
  function save(answer: unknown) {
    if (locked.current || checked || done) return;
    setDraft(answer);
    onDirtyChange(true);
    setError('');
    const current = ++version.current;
    pending.current = engine.savePracticeAnswer(sessionId, index, answer);
    void pending.current
      .then(() => {
        if (current === version.current) onDirtyChange(false);
        refresh();
      })
      .catch((failure) => {
        if (current === version.current) setError((failure as Error).message);
      });
    if (item.question.interaction.kind === 'choice' && !item.question.interaction.multiple)
      void check().catch((failure) => setError((failure as Error).message));
  }
  async function check() {
    if (locked.current || checked) return;
    locked.current = true;
    setBusy(true);
    try {
      await pending.current;
      await engine.checkPracticeItem(sessionId, index);
      onDirtyChange(false);
      refresh();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function retry() {
    setError('');
    pending.current = engine.savePracticeAnswer(sessionId, index, draft);
    try {
      await check();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  function select(next: number) {
    setIndex(next);
    setDraft(session!.items[next].answer);
    setError('');
    scroll.current?.scrollTo({ y: 0, animated: false });
  }
  async function advance() {
    const remaining = engine.user
      .practiceSessions!.find((s) => s.id === sessionId)!
      .items.findIndex((entry) => !entry.attemptId);
    if (remaining >= 0) select(remaining);
    else {
      await engine.submitPractice(sessionId);
      refresh();
    }
  }
  if (done && !reviewing)
    return (
      <View style={ui.page}>
        <Heading title="Round complete" subtitle="A little progress, saved." />
        <Card>
          <Text style={ui.title}>{summary.accuracy}%</Text>
          <Text style={ui.body}>
            {summary.correct} of {summary.total} correct
          </Text>
        </Card>
        <Button
          title="Review answers"
          onPress={() => {
            select(0);
            setReviewing(true);
          }}
        />
        <Button title="Done" secondary onPress={() => navigate({ name: 'practice' })} />
      </View>
    );
  return (
    <LearningWindow
      token={`${sessionId}:${index}`}
      feedback={
        !done && checked ? (item.score === item.maxScore ? 'Correct' : 'Incorrect') : undefined
      }
      correct={checked ? item.score === item.maxScore : undefined}
      onAdvance={advance}
    >
      <View style={[ui.page, { paddingVertical: 12 }]}>
        <Text style={ui.small}>
          {done ? 'Review' : 'Practice'} · {index + 1} / {session.items.length}
        </Text>
      </View>
      <ScrollView ref={scroll} contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
        <View pointerEvents={busy ? 'none' : 'auto'}>
          <QuestionPanel
            key={`${sessionId}:${index}`}
            question={item.question}
            passage={item.passage}
            answer={checked || done ? item.answer : draft}
            onChange={save}
            focused={!done}
            submitted={checked || done}
            result={checked ? { score: item.score!, maxScore: item.maxScore! } : undefined}
            onSubmit={check}
            deferred={
              !done &&
              item.question.interaction.kind === 'choice' &&
              !item.question.interaction.multiple
            }
            onNote={() =>
              navigate({
                name: 'note',
                target: {
                  kind: 'question',
                  id: item.question.id,
                  revision: item.question.revision,
                },
              })
            }
          />
        </View>
        {busy && (
          <Text accessibilityLiveRegion="polite" style={ui.small}>
            Saving answer…
          </Text>
        )}
        {!!error && (
          <Card>
            <Text accessibilityRole="alert" style={ui.body}>
              {error}
            </Text>
            <Button title="Retry saving answer" onPress={retry} />
          </Card>
        )}
        {done && (
          <Button
            title={index < session.items.length - 1 ? 'Next answer' : 'Finish review'}
            onPress={() =>
              index < session.items.length - 1 ? select(index + 1) : setReviewing(false)
            }
          />
        )}
      </ScrollView>
    </LearningWindow>
  );
}
