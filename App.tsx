import { PracticeSessionScreen } from './mobile/screens/PracticeSession';
import { ProfileScreen } from './mobile/screens/Profile';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StudyEngine } from './mobile/engine';
import { io } from './mobile/storage/io';
import { bundle } from './mobile/storage/bundle';
import type { MainTab, Route, ScreenProps } from './mobile/routes';
import { TodayScreen, ReviewsScreen } from './mobile/screens/Today';
import { WordsScreen, WordDetail } from './mobile/screens/Words';
import { PracticeScreen, QuestionScreen } from './mobile/screens/Practice';
import { NotebookScreen, NoteEditor, MistakesScreen } from './mobile/screens/Notebook';
import { LibraryScreen } from './mobile/screens/Library';
import { Button, Card, useUI } from './mobile/components/UI';
import { ThemeProvider, useTheme, type Colors } from './mobile/theme';
import { newStudyTargets, dueStudyTargets } from './mobile/study-selection.ts';
import { useNavigation } from './mobile/hooks/use-navigation.ts';
import { useStartup } from './mobile/hooks/use-startup.ts';
import { isMainTab } from './mobile/navigation.ts';
import type { Target } from './src/types.ts';

const tabs: {
  name: MainTab;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { name: 'today', label: 'Today', icon: 'sunny-outline' },
  { name: 'words', label: 'Words', icon: 'book-outline' },
  { name: 'practice', label: 'Practice', icon: 'create-outline' },
  { name: 'notebook', label: 'Notebook', icon: 'journal-outline' },
  { name: 'profile', label: 'Profile', icon: 'person-outline' },
];
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StudyApp />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
function StudyApp() {
  const { colors: c, isDark, setMode } = useTheme();
  const ui = useUI();
  const styles = useMemo(() => createStyles(c), [c]);
  const [engine] = useState(() => new StudyEngine(io, bundle));
  const navigation = useNavigation();
  const { route, tab, pending, back, setDirty } = navigation;
  const [, setVersion] = useState(0);
  const [message, setMessage] = useState('');
  const session = useRef<Target[]>([]);
  const refresh = () => setVersion((value) => value + 1);
  const { loaded, bootError, bootProgress, bootSeconds, diagnostics, initialize } = useStartup(
    engine,
    io,
    setMessage,
  );
  function go(next: Route, forced = false) {
    navigation.go(next, forced);
  }
  useEffect(() => {
    if (isMainTab(route)) session.current = [];
  }, [route]);
  async function openTarget(target: Target) {
    try {
      if (target.kind === 'question')
        go({ name: 'question', id: target.id, revision: target.revision });
      else {
        const found = await engine.sense(target.id, target.revision);
        if (!found)
          throw new Error('This meaning is unavailable. Import its original content pack.');
        go({
          name: 'word',
          id: found.word.id,
          revision: found.word.revision,
          senseId: target.id,
          study: true,
        });
      }
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function start(targets: Target[]) {
    if (!targets.length) {
      setMessage(
        'You are caught up in this range. Browse words or change your learning preferences in Library.',
      );
      return;
    }
    session.current = targets;
    await openTarget(targets[0]);
  }
  function startNew() {
    void start(newStudyTargets(engine));
  }
  function startDue() {
    void start(dueStudyTargets(engine));
  }
  async function next() {
    session.current = session.current.slice(1);
    if (session.current.length) await openTarget(session.current[0]);
    else {
      go({ name: 'today' });
      setMessage('Session complete. Your progress is saved.');
    }
  }
  const props: ScreenProps = { engine, refresh, navigate: go, notify: setMessage, openTarget };
  const key =
    'id' in route
      ? `${route.name}:${route.id}:${'revision' in route ? (route.revision ?? 'latest') : ''}${route.name === 'word' ? `:${route.senseId ?? ''}:${route.study ?? false}` : ''}`
      : route.name === 'note'
        ? `note:${route.note?.id ?? 'new'}`
        : route.name;
  let screen: React.ReactNode;
  if (!loaded)
    screen = (
      <View
        style={{ flex: 1, justifyContent: 'center', padding: 32, gap: 20, alignItems: 'center' }}
      >
        <Text style={ui.title}>English in Practice</Text>
        {bootError ? (
          <>
            <Text style={ui.body}>{bootError}</Text>
            <Button title="Try again" onPress={initialize} />
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={c.teal} />
            <Text style={ui.body}>Opening your offline library…</Text>
          </>
        )}
        <Text accessibilityLiveRegion="polite" style={ui.body}>
          {bootProgress.phase}
        </Text>
        <Text style={ui.small}>
          {bootProgress.completed.toLocaleString('en')} / {bootProgress.total.toLocaleString('en')}{' '}
          · {bootSeconds}s
        </Text>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: bootProgress.total, now: bootProgress.completed }}
          style={{ width: '100%', height: 7, borderRadius: 4, backgroundColor: c.line }}
        >
          <View
            style={{
              width: `${Math.min(100, (bootProgress.completed / Math.max(1, bootProgress.total)) * 100)}%`,
              height: 7,
              borderRadius: 4,
              backgroundColor: c.teal,
            }}
          />
        </View>
        {(!!bootError || bootSeconds >= 30) && (
          <>
            <Text style={ui.small}>
              Taking longer than expected? Share these startup details to help identify the slow
              step.
            </Text>
            <Button
              title="Share startup details"
              secondary
              onPress={() =>
                Share.share({ message: diagnostics() }).catch((e) => setMessage(e.message))
              }
            />
          </>
        )}
      </View>
    );
  else if (route.name === 'today')
    screen = <TodayScreen {...props} startNew={startNew} startDue={startDue} />;
  else if (route.name === 'words') screen = <WordsScreen {...props} />;
  else if (route.name === 'word')
    screen = (
      <WordDetail
        key={key}
        {...props}
        route={route}
        onNext={session.current.length ? next : undefined}
      />
    );
  else if (route.name === 'practice') screen = <PracticeScreen {...props} />;
  else if (route.name === 'question')
    screen = (
      <QuestionScreen
        key={key}
        {...props}
        route={route}
        onNext={session.current.length ? next : undefined}
      />
    );
  else if (route.name === 'practice-session')
    screen = (
      <PracticeSessionScreen key={key} {...props} sessionId={route.id} onDirtyChange={setDirty} />
    );
  else if (route.name === 'profile') screen = <ProfileScreen {...props} />;
  else if (route.name === 'notebook') screen = <NotebookScreen {...props} />;
  else if (route.name === 'note')
    screen = (
      <NoteEditor
        key={key}
        {...props}
        route={route}
        onDirtyChange={setDirty}
        onSaved={() => {
          setDirty(false);
          go({ name: 'notebook' }, true);
        }}
      />
    );
  else if (route.name === 'mistakes') screen = <MistakesScreen {...props} />;
  else if (route.name === 'reviews') screen = <ReviewsScreen {...props} />;
  else screen = <LibraryScreen {...props} />;
  const isMain = tabs.some((t) => t.name === route.name);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        {loaded && !isMain ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={back}
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={23} color={c.ink} />
            <Text style={ui.body}>Back</Text>
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={styles.mark}>
              <Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 19 }}>e</Text>
            </View>
            <Text style={{ color: c.ink, fontSize: 16, fontWeight: '600' }}>
              English in Practice
            </Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          onPress={() => setMode(isDark ? 'light' : 'dark')}
          style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={22} color={c.ink} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {screen}
      </KeyboardAvoidingView>
      {loaded && (
        <View style={styles.tabs}>
          {tabs.map((t) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.name }}
              accessibilityLabel={t.label}
              key={t.name}
              onPress={() => go({ name: t.name })}
              style={styles.tab}
            >
              <Ionicons name={t.icon} size={22} color={tab === t.name ? c.teal : c.muted} />
              <Text
                style={{
                  fontSize: 11,
                  color: tab === t.name ? c.teal : c.muted,
                  fontWeight: tab === t.name ? '700' : '400',
                }}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Modal
        visible={!!message}
        transparent
        animationType="none"
        onRequestClose={() => setMessage('')}
      >
        <View style={styles.scrim}>
          <Card style={{ width: '100%', maxWidth: 460 }}>
            <Text accessibilityLiveRegion="polite" style={ui.body}>
              {message}
            </Text>
            <Button title="Got it" onPress={() => setMessage('')} />
          </Card>
        </View>
      </Modal>
      <Modal
        visible={!!pending}
        transparent
        animationType="none"
        onRequestClose={navigation.cancel}
      >
        <View style={styles.scrim}>
          <Card style={{ width: '100%', maxWidth: 460 }}>
            <Text style={ui.h2}>Keep your draft?</Text>
            <Text style={ui.body}>Some changes have not been saved yet.</Text>
            <Button title="Keep editing" onPress={navigation.cancel} />
            <Button title="Discard changes" secondary danger onPress={navigation.discard} />
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
const createStyles = (c: Colors) =>
  StyleSheet.create({
    header: {
      minHeight: 60,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.paper,
      borderBottomWidth: 1,
      borderBottomColor: c.line,
    },
    mark: {
      width: 28,
      height: 30,
      borderRadius: 7,
      backgroundColor: c.teal,
      alignItems: 'center',
      justifyContent: 'center',
    },
    back: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 4 },
    tabs: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: c.line,
      backgroundColor: c.paper,
      paddingVertical: 7,
    },
    tab: { flex: 1, minHeight: 50, justifyContent: 'center', alignItems: 'center', gap: 5 },
    scrim: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
  });
