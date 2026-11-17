import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, Chip, Empty, Field, Heading, useUI } from '../components/UI';
import type { ScreenProps, Route } from '../routes';
import { id } from '../engine';

export function NotebookScreen({ engine, navigate }: ScreenProps) {
  const ui = useUI();
  const [query, setQuery] = useState('');
  const notes = [...engine.user.notes]
    .filter((n) =>
      `${n.title} ${n.body} ${n.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <FlatList
      data={notes}
      keyExtractor={(n) => n.id}
      contentContainerStyle={ui.page}
      ListHeaderComponent={
        <View style={{ gap: 16, marginBottom: 12 }}>
          <Heading title="Your notebook" subtitle="Put the language into your own words." />
          <Button title="Write a note" onPress={() => navigate({ name: 'note' })} />
          <Field
            label="Search notes and tags"
            value={query}
            onChangeText={setQuery}
            placeholder="A phrase, thought, or example"
          />
        </View>
      }
      ListEmptyComponent={
        <Empty
          title="A place for what you notice"
          text="Write your own sentences, collect useful phrases, or add a note directly from a word or practice task."
        />
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.title}`}
          onPress={() => navigate({ name: 'note', note: item })}
          style={{ marginBottom: 14 }}
        >
          <Card>
            <Text style={ui.h2}>{item.title}</Text>
            <Text style={ui.body} numberOfLines={3}>
              {item.body || 'No text yet'}
            </Text>
            <View style={ui.row}>
              {item.tags.map((t) => (
                <Chip key={t} label={t} />
              ))}
            </View>
            <Text style={ui.small}>
              {new Date(item.updatedAt).toLocaleDateString('en', {
                month: 'short',
                day: 'numeric',
              })}
              {item.target
                ? ' • Linked to ' + (item.target.kind === 'sense' ? 'a word' : 'practice')
                : ''}
            </Text>
          </Card>
        </Pressable>
      )}
    />
  );
}

export function NoteEditor({
  engine,
  refresh,
  notify,
  route,
  openTarget,
  onDirtyChange,
  onSaved,
}: ScreenProps & {
  route: Extract<Route, { name: 'note' }>;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const ui = useUI();
  const [title, setTitle] = useState(route.note?.title ?? '');
  const [body, setBody] = useState(route.note?.body ?? '');
  const [tags, setTags] = useState(route.note?.tags.join(', ') ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const target = route.note?.target ?? route.target;
  const dirty =
    title !== (route.note?.title ?? '') ||
    body !== (route.note?.body ?? '') ||
    tags !== (route.note?.tags.join(', ') ?? '');
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty]);
  useEffect(() => () => onDirtyChange(false), []);
  async function save() {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      await engine.note({
        id: route.note?.id ?? id('note'),
        title: title.trim(),
        body,
        tags: [
          ...new Set(
            tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ],
        createdAt: route.note?.createdAt ?? now,
        updatedAt: now,
        ...(target ? { target } : {}),
      });
      refresh();
      onDirtyChange(false);
      onSaved();
      notify('Note saved on this device.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!route.note) return;
    setBusy(true);
    try {
      await engine.deleteNote(route.note.id);
      refresh();
      onDirtyChange(false);
      onSaved();
      notify('Note deleted.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      <Heading
        title={route.note ? 'Edit your note' : 'A new page'}
        subtitle="Your sentences, your explanations, your progress."
      />
      {target && (
        <Button
          title={
            engine.targetExists(target) ? 'Open linked content' : 'Linked content is unavailable'
          }
          secondary
          disabled={!engine.targetExists(target)}
          onPress={() => openTarget(target)}
        />
      )}
      <Field
        label="Note title"
        value={title}
        onChangeText={setTitle}
        placeholder="What I learned about…"
      />
      <Field
        label="Your notes"
        multiline
        value={body}
        onChangeText={setBody}
        placeholder="Try a sentence. Explain a difference. Keep a useful example."
        style={{ minHeight: 280, lineHeight: 26 }}
      />
      <Field
        label="Tags, separated by commas"
        value={tags}
        onChangeText={setTags}
        placeholder="collocations, work, writing"
        autoCapitalize="none"
      />
      <Button title="Save note" onPress={save} disabled={!title.trim()} busy={busy} />
      {route.note &&
        (!confirmDelete ? (
          <Button title="Delete note" secondary danger onPress={() => setConfirmDelete(true)} />
        ) : (
          <Card>
            <Text style={ui.body}>Delete this note? Its linked practice history will remain.</Text>
            <View style={ui.row}>
              <Button title="Keep note" secondary onPress={() => setConfirmDelete(false)} />
              <Button title="Delete permanently" danger onPress={remove} busy={busy} />
            </View>
          </Card>
        ))}
    </ScrollView>
  );
}

export function MistakesScreen({ engine, openTarget, notify, refresh }: ScreenProps) {
  const ui = useUI();
  const [showMastered, setShowMastered] = useState(false);
  const [kind, setKind] = useState('all');
  const rows = [...engine.user.mistakes]
    .filter((m) => (showMastered || !m.mastered) && (kind === 'all' || m.target.kind === kind))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <FlatList
      data={rows}
      keyExtractor={(m) => `${m.target.id}:${m.target.revision}`}
      contentContainerStyle={ui.page}
      ListHeaderComponent={
        <View style={{ gap: 16, marginBottom: 12 }}>
          <Heading
            title="Mistake notebook"
            subtitle="A wrong answer is a useful place to begin again."
          />
          <View style={ui.row}>
            <Chip label="All" selected={kind === 'all'} onPress={() => setKind('all')} />
            <Chip label="Words" selected={kind === 'sense'} onPress={() => setKind('sense')} />
            <Chip
              label="Practice"
              selected={kind === 'question'}
              onPress={() => setKind('question')}
            />
            <Chip
              label="Include mastered"
              selected={showMastered}
              onPress={() => setShowMastered(!showMastered)}
            />
          </View>
        </View>
      }
      ListEmptyComponent={
        <Empty
          title="Nothing to revisit here"
          text="Incorrect answers and spelling attempts appear here automatically. Your notes and past attempts stay saved after you get a question right."
        />
      }
      renderItem={({ item }) => (
        <MistakeCard
          engine={engine}
          item={item}
          open={() => openTarget(item.target)}
          mark={async () => {
            try {
              await engine.mastery(item.target, !item.mastered);
              refresh();
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        />
      )}
    />
  );
}
function MistakeCard({
  engine,
  item,
  open,
  mark,
}: {
  engine: ScreenProps['engine'];
  item: ScreenProps['engine']['user']['mistakes'][number];
  open: () => void;
  mark: () => void;
}) {
  const ui = useUI();
  const [title, setTitle] = useState('Opening saved content…');
  const attempts = engine.user.attempts.filter((a) => item.attemptIds.includes(a.id));
  useEffect(() => {
    let active = true;
    (async () => {
      const value =
        item.target.kind === 'question'
          ? (await engine.question(item.target.id, item.target.revision))?.title
          : (await engine.sense(item.target.id, item.target.revision))?.word.headword;
      if (active) setTitle(value ?? 'Content unavailable');
    })().catch(() => active && setTitle('Content unavailable'));
    return () => {
      active = false;
    };
  }, [item.target.id, item.target.revision]);
  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={ui.small}>
        {item.target.kind === 'question' ? 'Use of English' : 'Vocabulary'}
        {item.mastered ? ' • Mastered' : ''}
      </Text>
      <Text style={ui.h2}>{title}</Text>
      <Text style={ui.body}>
        {attempts.length} attempt{attempts.length === 1 ? '' : 's'} to learn from
      </Text>
      {attempts.slice(-3).map((a) => (
        <Text key={a.id} style={ui.small}>
          {new Date(a.createdAt).toLocaleDateString('en')} —{' '}
          {a.kind === 'spelling' || a.kind === 'recall'
            ? a.answer && typeof a.answer === 'object' && 'outcome' in a.answer
              ? `${'text' in a.answer ? a.answer.text : ''} · ${a.answer.outcome}`
              : String(a.answer)
            : `${a.score}/${a.maxScore}`}
        </Text>
      ))}
      <View style={ui.row}>
        <Button title="Try again" disabled={!engine.targetExists(item.target)} onPress={open} />
        <Button
          title={item.mastered ? 'Mark for practice' : 'Mark mastered'}
          secondary
          onPress={mark}
        />
      </View>
    </Card>
  );
}
