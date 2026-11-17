import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ScreenProps, Route } from '../routes.ts';
import type { Word, Sense, Target } from '../../src/types.ts';
import {
  learningProgress,
  learningStages,
  meaningOf,
  type LearningStage,
  type LearningProgress,
} from '../../src/word-learning.ts';
import { Button, Card, Field, Heading, useUI } from '../components/UI';
import { useTheme } from '../theme';
import { id } from '../engine.ts';
import { LearningWindow } from '../components/LearningWindow';

const stageCopy = {
  choice: ['Meet the word', 'Which meaning fits this word? Take a guess.'],
  recognize: ['Recall its meaning', 'Without choices, can you remember what this word means?'],
  recall: ['Find the word', 'Read the meaning. Can you bring the English word to mind?'],
  spell: ['Make it stick', 'Type the word from memory.'],
} as const;

export function WordLearning({
  engine,
  route,
  refresh,
  notify,
  navigate,
  onNext,
}: ScreenProps & {
  route: Extract<Route, { name: 'word' }>;
  onNext?: (repeat?: boolean) => void | Promise<void>;
}) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const [content, setContent] = useState<{ word: Word; sense: Sense; choices: string[] }>();
  const [stage, setStage] = useState<LearningStage>('choice');
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    next: LearningProgress;
    revealed?: boolean;
  }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    setContent(undefined);
    setError('');
    setFeedback(undefined);
    setText('');
    (async () => {
      const word = await engine.word(route.id, route.revision);
      const sense = route.senseId
        ? word?.senses.find((item) => item.id === route.senseId)
        : word?.senses[0];
      if (!word || !sense || !meaningOf(sense))
        throw new Error('This word needs an English meaning before it can be studied.');
      const target: Target = { kind: 'sense', id: sense.id, revision: word.revision };
      const progress = learningProgress(engine.user, target);
      const choices = await engine.learningChoices(word, sense.id);
      if (active) {
        setStage(progress === 'complete' ? 'recognize' : (progress ?? 'choice'));
        setContent({ word, sense, choices });
      }
    })().catch((error) => active && setError((error as Error).message));
    return () => {
      active = false;
    };
  }, [engine, route.id, route.revision, route.senseId, retry]);
  if (!content)
    return (
      <View style={ui.page}>
        <Text style={ui.body}>{error || 'Preparing your learning card…'}</Text>
        {!!error && <Button title="Try again" onPress={() => setRetry((value) => value + 1)} />}
      </View>
    );
  const { word, sense, choices } = content;
  const target: Target = { kind: 'sense', id: sense.id, revision: word.revision };
  const definition = meaningOf(sense);
  // A definition can contain the answer; hide all accepted spellings during recall.
  const clue = [word.headword, ...word.variants]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce(
      (value, term) =>
        value.replace(
          new RegExp(
            '(^|[^\\p{L}\\p{N}])' +
              term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
              '(?=$|[^\\p{L}\\p{N}])',
            'giu',
          ),
          '$1_____',
        ),
      definition,
    );
  async function answer(response: string | boolean, revealed = false, correction = false) {
    if (saving.current || (feedback && !correction)) return;
    saving.current = true;
    setBusy(true);
    try {
      await engine.learningStep({
        id: id('learning'),
        target,
        stage,
        response,
        revealed,
        correction,
        createdAt: new Date().toISOString(),
      });
      const next = learningProgress(engine.user, target)!;
      setFeedback({ correct: next !== 'choice', next, revealed });
      refresh();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function advance() {
    if (!feedback || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const complete = feedback.next === 'complete';
      if (complete) {
        if (onNext) await onNext();
        else navigate({ name: 'words' });
      } else {
        setStage(feedback.next as LearningStage);
        setFeedback(undefined);
        setText('');
        await onNext?.(true);
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <LearningWindow
      token={`${route.id}:${stage}:${feedback?.next ?? 'answer'}`}
      feedback={
        feedback
          ? feedback.correct
            ? 'Correct'
            : feedback.revealed
              ? 'Answer revealed'
              : 'Incorrect'
          : undefined
      }
      correct={feedback?.revealed ? undefined : feedback?.correct}
      onAdvance={advance}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[ui.page, { gap: 24 }]}
      >
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {learningStages.map((item, index) => (
            <View
              key={item}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                backgroundColor: index <= learningStages.indexOf(stage) ? c.teal : c.line,
              }}
            />
          ))}
        </View>
        <Heading
          title={stageCopy[stage][0]}
          subtitle={`Step ${learningStages.indexOf(stage) + 1} of 4 · ${stageCopy[stage][1]}`}
        />
        <View style={{ paddingVertical: 24, gap: 14 }}>
          <Text style={{ ...ui.small, textAlign: 'center' }}>{sense.partOfSpeech}</Text>
          <Text
            accessibilityRole="header"
            style={{
              color: c.ink,
              textAlign: 'center',
              fontSize: stage === 'choice' || stage === 'recognize' ? 38 : 22,
              lineHeight: stage === 'choice' || stage === 'recognize' ? 48 : 34,
              fontWeight: '600',
            }}
          >
            {stage === 'choice' || stage === 'recognize' ? word.headword : clue}
          </Text>
        </View>
        {!feedback && stage === 'choice' && (
          <View style={{ gap: 12 }}>
            {choices.map((option, index) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={`${String.fromCharCode(65 + index)}. ${option}`}
                disabled={busy}
                onPress={() => void answer(option)}
                style={{
                  padding: 20,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: c.line,
                  backgroundColor: c.paper,
                  flexDirection: 'row',
                  gap: 14,
                  opacity: busy ? 0.5 : 1,
                }}
              >
                <Text style={{ ...ui.body, color: c.teal }}>{String.fromCharCode(65 + index)}</Text>
                <Text style={{ ...ui.body, flex: 1 }}>{option}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {!feedback && (stage === 'recognize' || stage === 'recall') && (
          <View style={{ gap: 12 }}>
            <Button
              title={stage === 'recognize' ? 'I know the meaning' : 'I can recall the word'}
              busy={busy}
              onPress={() => void answer(true)}
            />
            <Button
              title="I don’t know yet"
              secondary
              disabled={busy}
              onPress={() => void answer(false)}
            />
          </View>
        )}
        {!feedback && stage === 'spell' && (
          <View style={{ gap: 16 }}>
            <Field
              label="Your spelling"
              value={text}
              onChangeText={setText}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              editable={!busy}
              onSubmitEditing={() => text.trim() && void answer(text)}
            />
            <Button
              title="Check spelling"
              busy={busy}
              disabled={!text.trim()}
              onPress={() => void answer(text)}
            />
          </View>
        )}
        {!feedback && (stage === 'choice' || stage === 'spell') && (
          <Button
            title="Show me the answer"
            secondary
            disabled={busy}
            onPress={() => void answer(false, true)}
          />
        )}
        {!!feedback && (
          <>
            <Card>
              <Text style={{ ...ui.h2, color: feedback.correct ? c.teal : c.ink }}>
                {feedback.next === 'complete'
                  ? 'This round is complete'
                  : feedback.correct
                    ? 'Keep going'
                    : 'Let’s learn it together'}
              </Text>
              <Text style={ui.h2}>{word.headword}</Text>
              <Text style={ui.body}>{definition}</Text>
              {!!sense.examples[0] && <Text style={ui.body}>{sense.examples[0]}</Text>}
              <Text style={ui.small}>
                {feedback.next === 'complete'
                  ? 'Your progress is saved. A later review will check what stays.'
                  : feedback.correct
                    ? 'Recall this again without the same hints.'
                    : 'Read the meaning and example. Next time, start with the four choices again.'}
              </Text>
            </Card>
            {feedback.correct && (stage === 'recognize' || stage === 'recall') && (
              <Button
                title="I recalled it differently"
                secondary
                disabled={busy}
                onPress={() => void answer(false, false, true)}
              />
            )}
          </>
        )}
      </ScrollView>
    </LearningWindow>
  );
}
