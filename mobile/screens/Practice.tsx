import { MenuRow } from '../components/MenuRow';
import { practicePolicy } from '../../src/policy.ts';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Field, Heading, useUI } from '../components/UI';
import { QuestionPanel } from '../components/QuestionPanel';
import type { ScreenProps, Route } from '../routes';
import type { Passage, Question, Target } from '../../src/types.ts';
import { questionFeedback, type QuestionOutcome } from '../../src/question-progress.ts';
import { id } from '../engine';
import { useTheme } from '../theme';

export function PracticeScreen({
  engine,
  navigate,
  refresh,
  notify,
  section = 'practice',
}: ScreenProps & { section?: 'practice' | 'practice-setup' }) {
  const ui = useUI();
  const [count, setCount] = useState(
    String(engine.user.practiceSize ?? practicePolicy.defaultSize),
  );
  const [starting, setStarting] = useState(false);
  const unfinished = engine.user.practiceSessions?.find((session) => !session.submittedAt);
  async function start() {
    if (starting) return;
    if (unfinished) {
      navigate({ name: 'practice-session', id: unfinished.id });
      return;
    }
    setStarting(true);
    try {
      const sessionId = await engine.startPractice(
        Number(count),
        engine.questions.map((q) => q.id),
      );
      refresh();
      navigate({ name: 'practice-session', id: sessionId });
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setStarting(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={[ui.page, { gap: 24 }]}>
      <Heading
        title={section === 'practice' ? 'A little practice.' : 'Your pace'}
        subtitle={
          section === 'practice'
            ? 'One question at a time.'
            : 'Choose how much to practise in one round.'
        }
      />
      {section === 'practice-setup' ? (
        <Field
          label="Questions per round"
          keyboardType="number-pad"
          value={count}
          onChangeText={setCount}
        />
      ) : (
        <Card>
          <Text style={ui.h2}>{unfinished ? 'Ready to pick up again?' : 'Find your focus.'}</Text>
          <Text style={ui.body}>
            Read, answer, and move forward. We will take care of what comes next.
          </Text>
        </Card>
      )}
      <Button
        title={unfinished ? 'Resume practice' : 'Start practice'}
        onPress={start}
        busy={starting}
        disabled={!engine.questions.length}
      />
      {section === 'practice' && (
        <View>
          <MenuRow
            title="Round length"
            icon="options-outline"
            onPress={() => navigate({ name: 'practice-setup' })}
          />
          <MenuRow
            title="Mistake notebook"
            icon="refresh-outline"
            onPress={() => navigate({ name: 'mistakes' })}
          />
          <MenuRow
            title="Practice history"
            icon="time-outline"
            onPress={() => navigate({ name: 'practice-history' })}
          />
        </View>
      )}
    </ScrollView>
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
    footnote: { color: c.muted, fontSize: 12, lineHeight: 19, paddingBottom: 8 },
  });
