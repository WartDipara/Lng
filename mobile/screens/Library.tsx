import { backupFormat, validateBackup } from '../../src/backup.ts';
import { useTheme } from '../theme';
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, Chip, Field, Heading, useUI } from '../components/UI';
import type { ScreenProps } from '../routes';
import { pickJson, exportJson } from '../storage/documents';
import { yieldToUI } from '../../src/serial-queue.ts';
import { validatePack } from '../../src/validation.ts';
import type { ContentPack } from '../../src/types.ts';
import type { Backup } from '../engine';

export function LibraryScreen({ engine, refresh, notify }: ScreenProps) {
  const ui = useUI();
  const { colors: c, mode, setMode, error: themeError } = useTheme();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [packs, setPacks] = useState<ContentPack[]>([]);
  const [summary, setSummary] = useState('');
  const [backup, setBackup] = useState<Backup>();
  const [limit, setLimit] = useState(String(engine.user.settings.dailyNewLimit));
  const [selectedTags, setSelectedTags] = useState(engine.user.settings.selectedTags.join(', '));
  const [packageList, setPackageList] = useState(false);
  async function selectFiles() {
    setBusy(true);
    setProgress('Opening files…');
    try {
      const files = await pickJson();
      if (!files.length) return;
      const values = files.map((f) => ({ name: f.name, value: JSON.parse(f.text) }));
      if (values.length === 1 && values[0].value?.format === backupFormat) {
        const candidate = values[0].value;
        validateBackup(candidate);
        setBackup(candidate);
        setPacks([]);
        return;
      }
      const remaining = values.map((v) => {
        try {
          validatePack(v.value);
          return v.value as ContentPack;
        } catch (e) {
          throw new Error(
            `${v.name}: ${(e as Error).message}. Select a content pack, not its index file.`,
          );
        }
      });
      const {
        packs: ordered,
        counts: { added, updated, skipped },
      } = await engine.previewBatch(remaining, async (completed) => {
        setProgress(`Checking ${completed} of ${values.length} files…`);
        await yieldToUI();
      });
      setPacks(ordered);
      setBackup(undefined);
      setSummary(
        `${added} new entries, ${updated} updates, ${skipped} unchanged. Your notes and progress will stay saved.`,
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  async function apply() {
    setBusy(true);
    try {
      for (let i = 0; i < packs.length; i++) {
        setProgress(`Importing ${i + 1} of ${packs.length}…`);
        await yieldToUI();
        await engine.import(packs[i]);
      }
      setPacks([]);
      refresh();
      notify('Content imported. It is ready to use offline.');
    } catch (e) {
      notify(`${(e as Error).message} Completed packages remain saved; retrying is safe.`);
      refresh();
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  async function restore() {
    if (!backup) return;
    setBusy(true);
    setProgress('Restoring your notebook and progress…');
    try {
      await engine.restore(backup);
      setBackup(undefined);
      refresh();
      setLimit(String(engine.user.settings.dailyNewLimit));
      setSelectedTags(engine.user.settings.selectedTags.join(', '));
      notify('Backup restored.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  async function exportBackup() {
    setBusy(true);
    try {
      await exportJson(
        `english-in-practice-${new Date().toISOString().slice(0, 10)}.json`,
        await engine.backup(),
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function settings() {
    const daily = Number(limit);
    if (!Number.isInteger(daily) || daily < 0 || daily > 200) {
      notify('Choose a daily new-word target from 0 to 200.');
      return;
    }
    try {
      await engine.updateUser((user) => ({
        ...user,
        settings: {
          dailyNewLimit: daily,
          selectedTags: [
            ...new Set(
              selectedTags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ],
        },
      }));
      refresh();
      notify('Learning preferences saved.');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      <Heading title="Your offline library" subtitle="Everything you need, kept on your device." />
      <Card>
        <Text style={ui.h2}>{engine.wordCount.toLocaleString()} vocabulary entries</Text>
        <Text style={ui.body}>
          {engine.questions.length.toLocaleString()} practice tasks • {engine.readyCount} learning
          cards
        </Text>
        <Text style={ui.small}>
          The full dictionary contains reference meanings. Learning cards have simpler explanations
          and examples.
        </Text>
      </Card>
      <Card>
        <Text style={ui.h2}>Add more to learn</Text>
        <Text style={ui.body}>
          Choose new JSON content packs. You can select several files together; older required packs
          are imported first.
        </Text>
        <Button title="Import JSON files" onPress={selectFiles} busy={busy} />
        {progress && (
          <Text accessibilityLiveRegion="polite" style={ui.small}>
            {progress}
          </Text>
        )}
        {packs.length > 0 && (
          <>
            <Text style={ui.body}>{summary}</Text>
            <View style={ui.row}>
              <Button title="Import these packs" onPress={apply} disabled={busy} />
              <Button
                title="Cancel import"
                secondary
                onPress={() => setPacks([])}
                disabled={busy}
              />
            </View>
          </>
        )}
        {backup && (
          <>
            <Text style={ui.body}>
              Restore {backup.user.notes.length} notes and {backup.user.attempts.length} attempts?
              This replaces your current notebook and progress. Export your current backup first if
              you want to keep both.
            </Text>
            <View style={ui.row}>
              <Button title="Restore backup" onPress={restore} disabled={busy} />
              <Button
                title="Keep current data"
                secondary
                onPress={() => setBackup(undefined)}
                disabled={busy}
              />
            </View>
          </>
        )}
      </Card>
      <Card>
        <Text style={ui.h2}>Take your notebook with you</Text>
        <Text style={ui.body}>
          Export your notes, mistakes, review schedule and imported packs. Restore them here on
          another device.
        </Text>
        <Button title="Export backup" secondary onPress={exportBackup} disabled={busy} />
      </Card>
      <Card>
        <Text style={ui.h2}>Appearance</Text>
        <View style={ui.row}>
          {(['system', 'light', 'dark'] as const).map((value) => (
            <Chip
              key={value}
              label={value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}
              selected={mode === value}
              onPress={() => setMode(value)}
            />
          ))}
        </View>
        {!!themeError && <Text style={ui.small}>{themeError}</Text>}
      </Card>
      <Card>
        <Text style={ui.h2}>Your learning rhythm</Text>
        <Field
          label="New meanings per day"
          value={limit}
          onChangeText={setLimit}
          keyboardType="number-pad"
        />
        <Field
          label="Review tags (leave empty for all)"
          value={selectedTags}
          onChangeText={setSelectedTags}
          placeholder="advanced, work"
        />
        <Text style={ui.small}>
          Tags filter new cards and due reviews. Use tags shown on your vocabulary or practice
          tasks.
        </Text>
        <Button title="Save preferences" onPress={settings} />
      </Card>
      <Button
        title={packageList ? 'Hide content sources' : 'View content sources'}
        secondary
        onPress={() => setPackageList(!packageList)}
      />
      {packageList && <Sources engine={engine} />}
      <Text style={ui.small}>
        No account or connection is needed for learning. Nothing is uploaded. Uninstalling the app
        removes local data; export a backup before changing phones.
      </Text>
    </ScrollView>
  );
}
function Sources({ engine }: Pick<ScreenProps, 'engine'>) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const [sources, setSources] = useState<{ title: string; license: string; url: string }[]>([]);
  const [notice, setNotice] = useState('');
  const [notices, setNotices] = useState<{ title: string; text: string }[]>([]);
  const [error, setError] = useState('');
  React.useEffect(() => {
    let active = true;
    Promise.all(
      Object.keys(engine.catalog.entities.sources).map((id) => engine.entity('sources', id)),
    )
      .then((items) => active && setSources(items.filter((item) => item !== null)))
      .catch((error) => active && setError(error.message));
    engine
      .notices()
      .then((items) => active && setNotices(items))
      .catch((error) => active && setError(error.message));
    return () => {
      active = false;
    };
  }, []);
  return (
    <Card>
      <Text style={ui.h2}>Sources and attribution</Text>
      {sources.map((s) => (
        <View key={s.url} style={{ gap: 4, marginBottom: 14 }}>
          <Text style={ui.body}>{s.title}</Text>
          <Text style={ui.small}>{s.license}</Text>
          <Text selectable style={ui.small}>
            {s.url}
          </Text>
        </View>
      ))}
      <Text style={ui.small}>
        Dictionary reference content incorporates Princeton WordNet and Open English WordNet.
        Original practice tasks are not official exam papers.
      </Text>
      {!!error && <Text style={ui.small}>{error}</Text>}
      {notices.map((n) => (
        <View key={n.title} style={{ gap: 8 }}>
          <Button
            title={n.title}
            secondary
            onPress={() => setNotice(notice === n.title ? '' : n.title)}
          />
          {notice === n.title && (
            <Text selectable style={ui.small}>
              {n.text}
            </Text>
          )}
        </View>
      ))}
    </Card>
  );
}
