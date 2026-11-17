import { SerialQueue } from '../../src/serial-queue.ts';
import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, Heading, useUI } from '../components/UI';
import { QuestionPanel } from '../components/QuestionPanel';
import {
  completeAnswer,
  hasAnswer,
  itemStatus,
  sessionSummary,
} from '../../src/practice-session.ts';
import type { ScreenProps } from '../routes';
import { useTheme } from '../theme';

export function PracticeSessionScreen({
  engine,
  refresh,
  navigate,
  notify,
  sessionId,
  onDirtyChange,
}: ScreenProps & { sessionId: string; onDirtyChange: (dirty: boolean) => void }) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const session = engine.user.practiceSessions?.find((s) => s.id === sessionId);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<unknown>(session?.items[0].answer ?? null);
  const pending = useRef(Promise.resolve());
  const [saves] = useState(() => new SerialQueue());
  const saveVersion = useRef(0);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  if (!session)
    return (
      <View style={ui.page}>
        <Heading title="Practice unavailable" />
      </View>
    );
  const item = session.items[index];
  const done = !!session.submittedAt;
  const completed = session.items.filter((i) => completeAnswer(i.question, i.answer)).length;
  const summary = sessionSummary(session);
  function save(answer: unknown) {
    onDirtyChange(true);
    setDraft(answer);
    setSaving((n) => n + 1);
    setError('');
    const version = ++saveVersion.current;
    pending.current = saves
      .run(() => engine.savePracticeAnswer(sessionId, index, answer))
      .then(() => {
        if (version === saveVersion.current) {
          setError('');
          onDirtyChange(false);
        }
        refresh();
      })
      .catch((e) => {
        if (version === saveVersion.current) setError((e as Error).message);
      })
      .finally(() => setSaving((n) => n - 1));
  }
  function select(next: number) {
    setIndex(next);
    setDraft(session!.items[next].answer);
    setConfirm(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }
  async function submit() {
    if (busy || saving || error) return;
    setBusy(true);
    try {
      await pending.current;
      await engine.submitPractice(sessionId);
      refresh();
      setConfirm(false);
      scroll.current?.scrollTo({ y: 0, animated: false });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView ref={scroll} contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      <Heading
        title={done ? 'Practice results' : 'Your practice set'}
        subtitle={
          done
            ? `${summary.accuracy}% accuracy · ${summary.correct}/${summary.total} fully correct`
            : `${completed}/${session.items.length} completed · ${session.items.length - completed} remaining`
        }
      />
      {done && (
        <Card>
          <Text style={ui.body}>
            {summary.correct} correct · {summary.incorrect} incorrect · {summary.unanswered}{' '}
            unanswered
          </Text>
          <Text style={ui.small}>
            Accuracy = fully correct questions ÷ all questions. Partial answers count as incorrect;
            their individual marks appear below.
          </Text>
          <Button
            title="View my progress"
            secondary
            onPress={() => navigate({ name: 'profile' })}
          />
        </Card>
      )}
      <View style={ui.row}>
        {session.items.map((entry, i) => {
          const status = done
            ? itemStatus(entry)
            : completeAnswer(entry.question, entry.answer)
              ? 'answered'
              : hasAnswer(entry.answer)
                ? 'partial'
                : 'unanswered';
          const fill =
            status === 'correct'
              ? c.success
              : status === 'incorrect'
                ? c.red
                : status === 'answered' || status === 'partial'
                  ? c.blue
                  : c.line;
          return (
            <Pressable
              key={entry.question.id}
              accessibilityRole="button"
              accessibilityLabel={`Question ${i + 1}, ${status}`}
              accessibilityState={{ selected: i === index, disabled: !!saving || !!error || busy }}
              disabled={!!saving || !!error || busy}
              onPress={() => select(i)}
              style={{
                width: 48,
                minHeight: 48,
                borderRadius: 12,
                backgroundColor: fill,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: i === index ? c.ink : fill,
              }}
            >
              <Text
                style={{
                  color:
                    status === 'correct' ? c.onSuccess : status === 'incorrect' ? c.paper : c.ink,
                }}
              >
                {i + 1}
                {done ? (status === 'correct' ? ' ✓' : status === 'incorrect' ? ' ×' : ' –') : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={ui.small}>
        {done
          ? 'Green ✓ correct · Red × incorrect · Gray – unanswered'
          : 'Answers stay hidden until you submit the whole set.'}
      </Text>
      <Text style={ui.h2}>
        Question {index + 1} of {session.items.length}
      </Text>
      <QuestionPanel
        key={`${session.id}:${index}`}
        question={item.question}
        passage={item.passage}
        answer={done ? item.answer : draft}
        onChange={save}
        deferred
        submitted={done}
        result={
          done && item.score !== undefined
            ? { score: item.score, maxScore: item.maxScore! }
            : undefined
        }
        feedback={
          done && !hasAnswer(item.answer)
            ? 'Unanswered. This question counts in the accuracy total.'
            : undefined
        }
        onSubmit={() => {}}
        onNote={() =>
          navigate({
            name: 'note',
            target: { kind: 'question', id: item.question.id, revision: item.question.revision },
          })
        }
      />
      {!!saving && (
        <Text accessibilityLiveRegion="polite" style={ui.small}>
          Saving draft…
        </Text>
      )}
      {!!error && (
        <Card>
          <Text accessibilityRole="alert" style={ui.body}>
            Draft not saved: {error}
          </Text>
          <Button title="Retry saving" onPress={() => save(draft)} />
        </Card>
      )}
      <View style={ui.row}>
        <Button
          title="Previous question"
          secondary
          disabled={!index || !!saving || !!error || busy}
          onPress={() => select(index - 1)}
        />
        <Button
          title="Next question"
          secondary
          disabled={index === session.items.length - 1 || !!saving || !!error || busy}
          onPress={() => select(index + 1)}
        />
      </View>
      {!done &&
        (confirm ? (
          <Card>
            <Text style={ui.body}>
              {session.items.length - completed} questions are incomplete. Submit now? Answers will
              be locked.
            </Text>
            <Button
              title="Submit with incomplete answers"
              onPress={submit}
              disabled={!!saving || !!error}
              busy={busy}
            />
            <Button title="Keep answering" secondary onPress={() => setConfirm(false)} />
          </Card>
        ) : (
          <Button
            title="Submit practice set"
            disabled={!!saving || !!error}
            busy={busy}
            onPress={() => (completed < session.items.length ? setConfirm(true) : submit())}
          />
        ))}
    </ScrollView>
  );
}
