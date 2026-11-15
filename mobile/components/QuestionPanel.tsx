import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Interaction, Passage, Question } from '../../src/types.ts';

export interface QuestionPanelProps {
  question: Question;
  passage?: Passage;
  answer: unknown;
  onChange: (answer: unknown) => void;
  submitted: boolean;
  result?: { score: number; maxScore: number };
  onSubmit: () => void | Promise<void>;
  onNext?: () => void;
  onNote: () => void;
  onWord?: (senseId: string) => void;
}

type TextField = Extract<Interaction, { kind: 'text' }>['fields'][number];
const color = {
  ink: '#17324D',
  body: '#263D50',
  muted: '#52697B',
  teal: '#117B72',
  pale: '#EDF3F8',
  border: '#CEDBE4',
  white: '#FFFFFF',
  correct: '#E5F4EE',
  wrong: '#FFF0ED',
  red: '#A33E32',
};

function stringMap(answer: unknown): Record<string, string> {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return {};
  return Object.fromEntries(Object.entries(answer).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
}

function stringArray(answer: unknown): string[] {
  return Array.isArray(answer) ? answer.filter((item): item is string => typeof item === 'string') : [];
}

function normalized(value: string, caseSensitive = false): string {
  const text = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return caseSensitive ? text : text.toLocaleLowerCase('en');
}

function textCorrect(field: TextField, value: string): boolean {
  const text = normalized(value, field.caseSensitive);
  return text.length > 0 && text.split(' ').length <= field.maxWords
    && field.accepted.some(item => normalized(item, field.caseSensitive) === text);
}

function readableType(value: string): string {
  const text = value.replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function readablePrompt(value: string): string {
  return value.replace(/\{\{[^}]+\}\}/g, '________');
}

/** Controlled, offline question UI. The parent owns grading and durable attempt storage. */
export function QuestionPanel(props: QuestionPanelProps) {
  const { question, passage, answer, onChange, submitted, result, onSubmit, onNext, onNote, onWord } = props;
  const interaction = question.interaction;
  const [showPassage, setShowPassage] = useState(true);
  const [activeMatch, setActiveMatch] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [panelWidth, setPanelWidth] = useState(320);
  const submittingRef = useRef(false);
  const [imageRatio, setImageRatio] = useState(1.5);

  useEffect(() => {
    setShowPassage(true);
    setActiveMatch(null);
    setSubmitError('');
    submittingRef.current = false;
    setSubmitting(false);
  }, [question.id, question.revision]);

  useEffect(() => {
    if (interaction.kind === 'ordering' && !submitted) {
      const ids = stringArray(answer);
      if (ids.length !== interaction.items.length || new Set(ids).size !== ids.length || !ids.every(id => interaction.items.some(item => item.id === id))) {
        onChange(interaction.items.map(item => item.id));
      }
    }
  }, [interaction, answer, submitted, onChange]);

  useEffect(() => {
    if (question.layout?.kind !== 'diagram' || !question.layout.imageDataUri) return;
    let active = true;
    Image.getSize(question.layout.imageDataUri, (width, height) => {
      if (active && width > 0 && height > 0) {
        setImageRatio(width / height);
      }
    }, () => { if (active) setImageRatio(1.5); });
    return () => { active = false; };
  }, [question.layout?.imageDataUri, question.layout?.kind]);

  const fieldAnswers = stringMap(answer);
  const selectedIds = stringArray(answer);
  const locked = submitted || submitting;
  const ready = interaction.kind === 'choice'
    ? selectedIds.length > 0 && selectedIds.every(id => interaction.options.some(option => option.id === id))
    : interaction.kind === 'text'
      ? interaction.fields.every(field => (fieldAnswers[field.id] ?? '').trim().length > 0)
      : interaction.kind === 'matching'
        ? interaction.prompts.every(prompt => interaction.options.some(option => option.id === fieldAnswers[prompt.id]))
        : selectedIds.length === interaction.items.length && new Set(selectedIds).size === interaction.items.length && selectedIds.every(id => interaction.items.some(item => item.id === id));

  async function submit() {
    if (locked || !ready || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    try { await onSubmit(); }
    catch (error) { setSubmitError(error instanceof Error ? error.message : 'Your answer could not be saved. Try again.'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }

  function renderField(field: TextField, label?: string) {
    const value = fieldAnswers[field.id] ?? '';
    const correct = submitted && textCorrect(field, value);
    return (
      <View key={field.id} style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>{label ?? readablePrompt(field.prompt)}</Text>
        <TextInput
          accessibilityLabel={label ?? readablePrompt(field.prompt)}
          testID={`answer-${field.id}`}
          value={value}
          onChangeText={text => onChange({ ...fieldAnswers, [field.id]: text })}
          editable={!locked}
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Type your answer"
          placeholderTextColor={color.muted}
          style={[styles.input, submitted && (correct ? styles.correctInput : styles.wrongInput)]}
        />
        {submitted ? (
          <Text style={[styles.feedback, !correct && styles.wrongText]}>
            {correct ? 'Correct.' : `Accepted: ${field.accepted.join(' / ')}`}
          </Text>
        ) : (
          <Text style={styles.hint}>
            {field.maxWords === 1 ? 'One word' : `Up to ${field.maxWords} words`}{field.caseSensitive ? '; match the capital letters.' : '.'}
          </Text>
        )}
      </View>
    );
  }

  function renderTemplate(text: string, location: string): React.ReactNode {
    if (interaction.kind !== 'text') return <Text style={styles.body}>{text}</Text>;
    return text.split(/(\{\{[^}]+\}\})/g).filter(Boolean).map((part, index) => {
      const match = /^\{\{([^}]+)\}\}$/.exec(part);
      if (!match) return <Text key={`${location}-${index}`} style={styles.body}>{part}</Text>;
      const field = interaction.fields.find(candidate => candidate.id === match[1]);
      return field ? renderField(field) : <Text key={`${location}-${index}`} style={styles.body}>________</Text>;
    });
  }

  function renderTextInteraction() {
    if (interaction.kind !== 'text') return null;
    const layout = question.layout;
    if (layout?.kind === 'table') {
      const rows = layout.rows ?? [];
      const columns = Math.max(1, ...rows.map(row => row.length));
      const cellWidth = columns <= 2 ? Math.max(140, (panelWidth - 1) / columns) : 180;
      const wideTable = cellWidth * columns + 1 > panelWidth + 1;
      return (
        <View style={styles.tableGroup}>
          {wideTable && <Text style={styles.hint}>Swipe sideways to see all columns.</Text>}
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableContainer}>
            <View accessibilityLabel="Completion table" style={[styles.table, { width: cellWidth * columns + 1 }]}>
              {rows.map((row, rowIndex) => (
                <View key={`row-${rowIndex}`} style={[styles.tableRow, rowIndex === 0 && styles.tableHeading]}>
                  {Array.from({ length: columns }, (_, columnIndex) => <View key={`cell-${columnIndex}`} style={[styles.tableCell, { width: cellWidth }]}>{renderTemplate(row[columnIndex] ?? '', `${rowIndex}-${columnIndex}`)}</View>)}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      );
    }
    if (layout?.kind === 'flowchart') {
      return <View style={styles.flow}>
        {(layout.steps ?? []).map((step, index) => (
          <View key={`step-${index}`}>
            {index > 0 && <Text accessibilityLabel="Then" style={styles.flowArrow}>↓</Text>}
            <View style={styles.flowStep}>{renderTemplate(step, `step-${index}`)}</View>
          </View>
        ))}
      </View>;
    }
    if (layout?.kind === 'diagram') {
      return <View style={styles.stack}>
        <View style={[styles.diagram, { aspectRatio: imageRatio }]}>
          <Image source={{ uri: layout.imageDataUri }} accessibilityLabel={layout.altText} resizeMode="contain" style={StyleSheet.absoluteFill} />
          {layout.labels?.map((label, index) => <View
            key={label.fieldId}
            accessibilityLabel={`Label ${index + 1}`}
            style={[styles.diagramLabel, { left: `${label.x * 100}%`, top: `${label.y * 100}%` }]}
          ><Text style={styles.diagramLabelText}>{index + 1}</Text></View>)}
        </View>
        <Text style={styles.hint}>{layout.altText}</Text>
        {interaction.fields.map(field => {
          const number = (layout.labels?.findIndex(label => label.fieldId === field.id) ?? -1) + 1;
          return renderField(field, `${number}. ${readablePrompt(field.prompt)}`);
        })}
      </View>;
    }
    return <View style={styles.stack}>{interaction.fields.map(field => renderField(field))}</View>;
  }

  function renderChoices() {
    if (interaction.kind !== 'choice') return null;
    return <View style={styles.stack}>
      {interaction.multiple && <Text style={styles.hint}>Choose all answers that apply.</Text>}
      {interaction.options.map((option, index) => {
        const selected = selectedIds.includes(option.id);
        const correct = submitted && interaction.correctIds.includes(option.id);
        const wrong = submitted && selected && !correct;
        return <View key={option.id}>
          <Pressable
            accessibilityRole={interaction.multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: selected, disabled: locked }}
            accessibilityLabel={`${String.fromCharCode(65 + index)}. ${option.text}`}
            disabled={locked}
            onPress={() => onChange(interaction.multiple
              ? selected ? selectedIds.filter(id => id !== option.id) : [...selectedIds, option.id]
              : [option.id])}
            style={({ pressed }) => [styles.option, selected && styles.selectedOption, correct && styles.correctOption, wrong && styles.wrongOption, pressed && styles.pressed]}
          >
            <View style={[styles.optionMarker, selected && styles.selectedMarker]}><Text style={[styles.optionLetter, selected && styles.selectedLetter]}>{String.fromCharCode(65 + index)}</Text></View>
            <View style={styles.flex}>
              <Text style={styles.optionText}>{option.text}</Text>
              {submitted && <Text style={[styles.feedback, wrong && styles.wrongText]}>{correct ? selected ? 'Your answer · correct' : 'Correct answer' : selected ? 'Your answer · incorrect' : 'Not the answer'}</Text>}
            </View>
          </Pressable>
          {submitted && question.optionExplanations?.[option.id] && <Text style={styles.optionExplanation}>{question.optionExplanations[option.id]}</Text>}
        </View>;
      })}
    </View>;
  }

  function renderMatching() {
    if (interaction.kind !== 'matching') return null;
    return <View style={styles.stack}>
      <Text style={styles.hint}>{interaction.reuseOptions ? 'An option may be used more than once.' : 'Use each option no more than once. To move an option, clear its previous match first.'}</Text>
      {interaction.prompts.map((prompt, index) => {
        const selectedId = fieldAnswers[prompt.id];
        const selected = interaction.options.find(option => option.id === selectedId);
        const correctId = interaction.pairs.find(pair => pair.promptId === prompt.id)?.optionId;
        const correctOption = interaction.options.find(option => option.id === correctId);
        const correct = selectedId === correctId;
        const expanded = activeMatch === prompt.id;
        return <View key={prompt.id} style={styles.matchGroup}>
          <Text style={styles.fieldLabel}>{index + 1}. {prompt.text}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded, disabled: locked }}
            accessibilityLabel={`Choose match for ${prompt.text}. ${selected?.text ?? 'No match chosen.'}`}
            onPress={() => setActiveMatch(expanded ? null : prompt.id)}
            disabled={locked}
            style={[styles.matchPicker, submitted && (correct ? styles.correctInput : styles.wrongInput)]}
          ><Text style={[styles.flex, styles.body]}>{selected?.text ?? 'Choose a match'}</Text><Text style={styles.matchToggle}>{expanded ? '−' : '+'}</Text></Pressable>
          {!locked && selected && <Pressable accessibilityRole="button" style={styles.clearButton} onPress={() => {
            const next = { ...fieldAnswers }; delete next[prompt.id]; onChange(next);
          }}><Text style={styles.linkText}>Clear match</Text></Pressable>}
          {!locked && expanded && <View style={styles.matchOptions}>
            {interaction.options.map(option => {
              const used = !interaction.reuseOptions && Object.entries(fieldAnswers).some(([id, value]) => id !== prompt.id && value === option.id);
              return <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ disabled: used, selected: selectedId === option.id }} disabled={used}
                onPress={() => { onChange({ ...fieldAnswers, [prompt.id]: option.id }); setActiveMatch(null); }}
                style={({ pressed }) => [styles.matchOption, used && styles.disabled, selectedId === option.id && styles.selectedOption, pressed && styles.pressed]}
              ><Text style={styles.body}>{option.text}{used ? ' (already matched)' : ''}</Text></Pressable>;
            })}
          </View>}
          {submitted && <Text style={[styles.feedback, !correct && styles.wrongText]}>{correct ? 'Correct.' : `Correct match: ${correctOption?.text ?? 'Unavailable'}`}</Text>}
        </View>;
      })}
    </View>;
  }

  function renderOrdering() {
    if (interaction.kind !== 'ordering') return null;
    const order = selectedIds.length === interaction.items.length ? selectedIds : interaction.items.map(item => item.id);
    const move = (index: number, direction: number) => {
      const next = [...order]; const other = index + direction;
      if (other < 0 || other >= next.length || locked) return;
      [next[index], next[other]] = [next[other], next[index]];
      onChange(next);
    };
    return <View style={styles.stack}>
      <Text style={styles.hint}>Use Up and Down to arrange the sentences.</Text>
      {order.map((id, index) => {
        const item = interaction.items.find(candidate => candidate.id === id);
        const correct = submitted && interaction.correctOrder[index] === id;
        return <View key={id} style={[styles.orderItem, submitted && (correct ? styles.correctOption : styles.wrongOption)]}>
          <View style={styles.orderText}><Text style={styles.orderNumber}>{index + 1}</Text><Text style={[styles.body, styles.flex]}>{item?.text}</Text></View>
          {!submitted && <View style={styles.orderControls}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Move sentence ${index + 1} up`} disabled={locked || index === 0} onPress={() => move(index, -1)} style={[styles.orderButton, (locked || index === 0) && styles.disabled]}><Text style={styles.linkText}>Up</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Move sentence ${index + 1} down`} disabled={locked || index === order.length - 1} onPress={() => move(index, 1)} style={[styles.orderButton, (locked || index === order.length - 1) && styles.disabled]}><Text style={styles.linkText}>Down</Text></Pressable>
          </View>}
        </View>;
      })}
      {submitted && <View style={styles.answerBox}>
        <Text style={styles.subheading}>Correct order</Text>
        {interaction.correctOrder.map((id, index) => <Text key={id} style={styles.body}>{index + 1}. {interaction.items.find(item => item.id === id)?.text}</Text>)}
      </View>}
    </View>;
  }

  const successful = result && result.score === result.maxScore;
  return <View style={styles.root} onLayout={event => setPanelWidth(event.nativeEvent.layout.width)}>
    <View style={styles.topline}>
      <Text style={styles.typeLabel}>{readableType(question.type)}</Text>
      <Text style={styles.originLabel}>{question.origin === 'original' ? 'Original practice' : question.origin === 'past-paper' ? 'Past paper' : 'Official sample'}</Text>
    </View>
    <Text accessibilityRole="header" style={styles.title}>{question.title}</Text>
    {question.exam && <Text style={styles.hint}>{question.exam.name}{question.exam.year ? ` (${question.exam.year})` : ''}: {question.exam.reference}</Text>}
    {passage ? <View style={styles.passage}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPassage }} onPress={() => setShowPassage(!showPassage)} style={styles.passageToggle}>
        <Text style={[styles.subheading, styles.flex]}>{passage.title}</Text>
        <Text style={styles.linkText}>{showPassage ? 'Hide text' : 'Read text'}</Text>
      </Pressable>
      {showPassage && <View style={styles.passageBody}>
        {passage.paragraphs.map((paragraph, index) => <View key={paragraph.id} style={[styles.paragraph, submitted && question.evidenceParagraphIds.includes(paragraph.id) && styles.evidence]}>
          <Text style={styles.paragraphLabel}>Paragraph {index + 1}</Text>
          <Text selectable style={styles.reading}>{paragraph.text}</Text>
          {submitted && question.evidenceParagraphIds.includes(paragraph.id) && <Text style={styles.feedback}>Evidence for this answer</Text>}
        </View>)}
      </View>}
    </View> : question.passageId ? <Text accessibilityRole="alert" style={styles.error}>The reading text is unavailable. Import the content pack containing this passage before answering.</Text> : null}
    <Text style={styles.instructions}>{question.instructions}</Text>
    <Text selectable style={styles.prompt}>{readablePrompt(question.prompt)}</Text>
    {renderChoices()}
    {renderTextInteraction()}
    {renderMatching()}
    {renderOrdering()}
    {submitError ? <Text accessibilityRole="alert" style={styles.error}>{submitError}</Text> : null}
    {submitted ? <View style={[styles.result, successful ? styles.correctOption : styles.resultNeutral]} accessibilityLiveRegion="polite">
      <Text accessibilityRole="header" style={styles.subheading}>{result ? `${result.score} / ${result.maxScore} correct` : 'Answer review'}</Text>
      <Text selectable style={styles.body}>{question.explanation}</Text>
      {onWord && question.senseIds.length > 0 && <View style={styles.wordLinks}>{question.senseIds.map((id, index) => <Pressable key={id} accessibilityRole="button" onPress={() => onWord(id)} style={styles.secondaryButton}><Text style={styles.linkText}>Study word {index + 1}</Text></Pressable>)}</View>}
    </View> : <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !ready || locked || Boolean(question.passageId && !passage), busy: submitting }}
      disabled={!ready || locked || Boolean(question.passageId && !passage)}
      onPress={submit}
      testID="check-answer"
      style={({ pressed }) => [styles.primaryButton, (!ready || locked || Boolean(question.passageId && !passage)) && styles.disabled, pressed && styles.pressed]}
    ><Text style={styles.primaryButtonText}>{submitting ? 'Saving answer…' : 'Check answer'}</Text></Pressable>}
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={onNote} style={styles.secondaryButton}><Text style={styles.linkText}>Add a note</Text></Pressable>
      {submitted && onNext && <Pressable accessibilityRole="button" onPress={onNext} style={[styles.primaryButton, styles.nextButton]}><Text style={styles.primaryButtonText}>Next question</Text></Pressable>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 18, paddingBottom: 28, width: '100%' },
  flex: { flex: 1, minWidth: 0 },
  stack: { gap: 12 },
  topline: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  typeLabel: { color: color.teal, fontSize: 14, fontWeight: '700' },
  originLabel: { color: color.muted, fontSize: 13 },
  title: { fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' }), fontSize: 28, lineHeight: 36, color: color.ink },
  subheading: { color: color.ink, fontSize: 18, fontWeight: '700', lineHeight: 25 },
  body: { color: color.body, fontSize: 16, lineHeight: 25 },
  hint: { color: color.muted, fontSize: 13, lineHeight: 20 },
  instructions: { color: color.muted, fontSize: 15, lineHeight: 23 },
  prompt: { color: color.ink, fontSize: 19, fontWeight: '600', lineHeight: 29 },
  passage: { backgroundColor: color.pale, borderRadius: 14, overflow: 'hidden' },
  passageToggle: { padding: 16, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 },
  passageBody: { paddingHorizontal: 8, paddingBottom: 12 },
  paragraph: { padding: 12, gap: 7, borderRadius: 6 },
  paragraphLabel: { color: color.muted, fontSize: 12, fontWeight: '600' },
  reading: { color: color.body, fontSize: 17, lineHeight: 29 },
  evidence: { backgroundColor: '#DCEFE6', borderLeftWidth: 3, borderLeftColor: color.teal },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: color.white, padding: 15, borderWidth: 1, borderColor: color.border, borderRadius: 10, minHeight: 56 },
  selectedOption: { borderColor: color.teal, backgroundColor: '#EFF8F5' },
  correctOption: { borderColor: color.teal, backgroundColor: color.correct },
  wrongOption: { borderColor: '#DDA99E', backgroundColor: color.wrong },
  optionMarker: { borderWidth: 1, borderColor: color.border, borderRadius: 16, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  selectedMarker: { backgroundColor: color.teal, borderColor: color.teal },
  optionLetter: { color: color.muted, fontSize: 13, fontWeight: '700' },
  selectedLetter: { color: color.white },
  optionText: { color: color.body, fontSize: 16, lineHeight: 25 },
  optionExplanation: { color: color.muted, fontSize: 14, lineHeight: 22, paddingTop: 7, paddingHorizontal: 12 },
  fieldGroup: { gap: 7, width: '100%' },
  fieldLabel: { color: color.body, fontSize: 15, lineHeight: 23, fontWeight: '600' },
  input: { backgroundColor: color.white, color: color.ink, borderWidth: 1, borderColor: color.border, borderRadius: 8, paddingHorizontal: 13, paddingVertical: 12, fontSize: 17, minHeight: 50, width: '100%' },
  correctInput: { borderColor: color.teal, backgroundColor: color.correct },
  wrongInput: { borderColor: '#DDA99E', backgroundColor: color.wrong },
  feedback: { color: color.teal, fontSize: 13, lineHeight: 20, marginTop: 3 },
  wrongText: { color: color.red },
  tableContainer: { flexGrow: 1, paddingBottom: 8 },
  tableGroup: { gap: 8 },
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: color.border, minWidth: '100%' },
  tableRow: { flexDirection: 'row', alignItems: 'stretch' },
  tableHeading: { backgroundColor: color.pale },
  tableCell: { padding: 13, gap: 10, borderRightWidth: 1, borderBottomWidth: 1, borderColor: color.border },
  flow: { alignSelf: 'stretch', gap: 0 },
  flowStep: { backgroundColor: color.pale, borderRadius: 10, padding: 16, gap: 10 },
  flowArrow: { textAlign: 'center', color: color.teal, fontSize: 24, lineHeight: 38 },
  diagram: { width: '100%', backgroundColor: color.pale, position: 'relative', overflow: 'visible' },
  diagramLabel: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: -14 }, { translateY: -14 }], borderWidth: 2, borderColor: color.white },
  diagramLabelText: { color: color.white, fontSize: 13, fontWeight: '700' },
  matchGroup: { gap: 8, paddingBottom: 10 },
  matchPicker: { borderWidth: 1, borderColor: color.border, borderRadius: 8, minHeight: 52, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: color.white },
  matchToggle: { color: color.teal, fontSize: 22, fontWeight: '500' },
  matchOptions: { borderWidth: 1, borderColor: color.border, borderRadius: 8, overflow: 'hidden' },
  matchOption: { minHeight: 48, padding: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.border, backgroundColor: color.white },
  clearButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  orderItem: { padding: 14, gap: 8, borderWidth: 1, borderColor: color.border, borderRadius: 10, backgroundColor: color.white },
  orderText: { flexDirection: 'row', gap: 12 },
  orderNumber: { color: color.teal, fontSize: 16, fontWeight: '700', lineHeight: 25 },
  orderControls: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  orderButton: { minHeight: 44, minWidth: 64, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, backgroundColor: color.pale, borderRadius: 7 },
  answerBox: { padding: 16, gap: 12, backgroundColor: color.pale, borderRadius: 10 },
  result: { padding: 18, gap: 10, borderRadius: 12, borderWidth: 1 },
  resultNeutral: { backgroundColor: color.pale, borderColor: color.border },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  primaryButton: { minHeight: 52, paddingVertical: 14, paddingHorizontal: 22, borderRadius: 9, backgroundColor: color.teal, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: color.white, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  secondaryButton: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: color.border, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  linkText: { color: color.teal, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  nextButton: { flexGrow: 1 },
  wordLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
  error: { color: color.red, fontSize: 15, lineHeight: 23, backgroundColor: color.wrong, padding: 13, borderRadius: 8 },
});

export default QuestionPanel;
