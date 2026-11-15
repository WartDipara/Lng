import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StudyEngine } from './mobile/engine';
import { io } from './mobile/storage/io';
import { bundle } from './mobile/storage/bundle';
import type { MainTab, Route, ScreenProps } from './mobile/routes';
import { TodayScreen, ReviewsScreen, inScope } from './mobile/screens/Today';
import { WordsScreen, WordDetail } from './mobile/screens/Words';
import { PracticeScreen, QuestionScreen } from './mobile/screens/Practice';
import { NotebookScreen, NoteEditor, MistakesScreen } from './mobile/screens/Notebook';
import { LibraryScreen } from './mobile/screens/Library';
import { Button, Card, ui } from './mobile/components/UI';
import { colors as c } from './mobile/theme';
import { dueReviews, newSensesToday } from './src/learning.ts';
import { latest } from './src/catalog.ts';
import type { Target } from './src/types.ts';

const tabs: { name: MainTab; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { name: 'today', label: 'Today', icon: 'sunny-outline' }, { name: 'words', label: 'Words', icon: 'book-outline' },
  { name: 'practice', label: 'Practice', icon: 'create-outline' }, { name: 'notebook', label: 'Notebook', icon: 'journal-outline' }, { name: 'library', label: 'Library', icon: 'folder-open-outline' },
];
export default function App() { return <SafeAreaProvider><StudyApp /></SafeAreaProvider>; }
function StudyApp() {
  const [engine] = useState(() => new StudyEngine(io, bundle));
  const [loaded, setLoaded] = useState(false); const [bootError, setBootError] = useState('');
  const [route, setRoute] = useState<Route>({ name: 'today' }); const [tab, setTab] = useState<MainTab>('today');
  const [, setVersion] = useState(0); const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Route>(); const dirty = useRef(false);
  const history = useRef<Route[]>([]); const session = useRef<Target[]>([]);
  const refresh = () => setVersion(v => v + 1);
  async function initialize() { setBootError(''); try { await engine.initialize(); setLoaded(true); if (engine.recovered) setMessage('Recovered your last intact saved data.'); } catch (e) { setBootError((e as Error).message); } }
  useEffect(() => { initialize(); }, []);
  function go(next: Route, forced = false) {
    if (dirty.current && !forced) { setPending(next); return; }
    history.current.push(route); setRoute(next);
    if (tabs.some(t => t.name === next.name)) { setTab(next.name as MainTab); session.current = []; }
  }
  function back() {
    const previous = history.current[history.current.length - 1] ?? { name: tab };
    if (dirty.current) { setPending(previous); return; }
    history.current.pop(); setRoute(previous);
  }
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => {
    if (route.name === 'today' && !history.current.length) return false;
    back(); return true;
  }); return () => sub.remove(); }, [route, tab]);
  async function openTarget(target: Target) {
    try {
      if (target.kind === 'question') go({ name: 'question', id: target.id, revision: target.revision });
      else { const found = await engine.sense(target.id, target.revision); if (!found) throw new Error('This meaning is unavailable. Import its original content pack.'); go({ name: 'word', id: found.word.id, revision: found.word.revision, senseId: target.id, study: true }); }
    } catch (e) { setMessage((e as Error).message); }
  }
  async function start(targets: Target[]) {
    if (!targets.length) { setMessage('You are caught up in this range. Browse words or change your learning preferences in Library.'); return; }
    session.current = targets; await openTarget(targets[0]);
  }
  function startNew() {
    const seen = new Set(engine.user.attempts.filter(a => a.target.kind === 'sense').map(a => a.target.id));
    const allowance = Math.max(0, engine.user.settings.dailyNewLimit - newSensesToday(engine.user));
    const targets = engine.words.flatMap(w => w.ready.map(sid => ({ kind: 'sense' as const, id: sid, revision: latest(engine.catalog.entities.vocabulary[w.id])!.revision }))).filter(t => !seen.has(t.id) && inScope(engine, t));
    start(targets.slice(0, allowance));
  }
  function startDue() { start(dueReviews(engine.user).filter(r => engine.targetExists(r.target) && inScope(engine, r.target)).map(r => r.target)); }
  async function next() {
    session.current = session.current.slice(1);
    if (session.current.length) await openTarget(session.current[0]);
    else { go({ name: 'today' }); setMessage('Session complete. Your progress is saved.'); }
  }
  const props: ScreenProps = { engine, refresh, navigate: go, notify: setMessage, openTarget };
  const key = 'id' in route ? `${route.name}:${route.id}:${route.revision ?? 'latest'}${route.name === 'word' ? `:${route.senseId ?? ''}:${route.study ?? false}` : ''}` : route.name === 'note' ? `note:${route.note?.id ?? 'new'}` : route.name;
  let screen: React.ReactNode;
  if (!loaded) screen = <View style={{ flex: 1, justifyContent: 'center', padding: 32, gap: 20, alignItems: 'center' }}><Text style={ui.title}>English in Practice</Text>{bootError ? <><Text style={ui.body}>{bootError}</Text><Button title="Try again" onPress={initialize} /></> : <><ActivityIndicator size="large" color={c.teal} /><Text style={ui.body}>Opening your offline library…</Text></>}</View>;
  else if (route.name === 'today') screen = <TodayScreen {...props} startNew={startNew} startDue={startDue} />;
  else if (route.name === 'words') screen = <WordsScreen {...props} />;
  else if (route.name === 'word') screen = <WordDetail key={key} {...props} route={route} onNext={session.current.length ? next : undefined} />;
  else if (route.name === 'practice') screen = <PracticeScreen {...props} />;
  else if (route.name === 'question') screen = <QuestionScreen key={key} {...props} route={route} onNext={session.current.length ? next : undefined} />;
  else if (route.name === 'notebook') screen = <NotebookScreen {...props} />;
  else if (route.name === 'note') screen = <NoteEditor key={key} {...props} route={route} onDirtyChange={v => { dirty.current = v; }} onSaved={() => { dirty.current = false; go({ name: 'notebook' }, true); }} />;
  else if (route.name === 'mistakes') screen = <MistakesScreen {...props} />;
  else if (route.name === 'reviews') screen = <ReviewsScreen {...props} />;
  else screen = <LibraryScreen {...props} />;
  const isMain = tabs.some(t => t.name === route.name);
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}><StatusBar style="dark" />
    <View style={styles.header}>{loaded && !isMain ? <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={back} style={styles.back}><Ionicons name="chevron-back" size={23} color={c.ink} /><Text style={ui.body}>Back</Text></Pressable> : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><View style={styles.mark}><Text style={{ color: 'white', fontWeight: '700', fontSize: 19 }}>e</Text></View><Text style={{ color: c.ink, fontSize: 16, fontWeight: '600' }}>English in Practice</Text></View>}<Text style={ui.small}>Offline</Text></View>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{screen}</KeyboardAvoidingView>
    {loaded && <View style={styles.tabs}>{tabs.map(t => <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === t.name }} accessibilityLabel={t.label} key={t.name} onPress={() => go({ name: t.name })} style={styles.tab}><Ionicons name={t.icon} size={22} color={tab === t.name ? c.teal : c.muted} /><Text style={{ fontSize: 11, color: tab === t.name ? c.teal : c.muted, fontWeight: tab === t.name ? '700' : '400' }}>{t.label}</Text></Pressable>)}</View>}
    <Modal visible={!!message} transparent animationType="none" onRequestClose={() => setMessage('')}><View style={styles.scrim}><Card style={{ width: '100%', maxWidth: 460 }}><Text accessibilityLiveRegion="polite" style={ui.body}>{message}</Text><Button title="Got it" onPress={() => setMessage('')} /></Card></View></Modal>
    <Modal visible={!!pending} transparent animationType="none" onRequestClose={() => setPending(undefined)}><View style={styles.scrim}><Card style={{ width: '100%', maxWidth: 460 }}><Text style={ui.h2}>Keep your draft?</Text><Text style={ui.body}>This note has unsaved changes.</Text><Button title="Keep editing" onPress={() => setPending(undefined)} /><Button title="Discard changes" secondary danger onPress={() => { const destination = pending!; dirty.current = false; setPending(undefined); go(destination, true); }} /></Card></View></Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  header: { minHeight: 60, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: c.line },
  mark: { width: 28, height: 30, borderRadius: 7, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 4 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.line, backgroundColor: 'white', paddingVertical: 7 },
  tab: { flex: 1, minHeight: 50, justifyContent: 'center', alignItems: 'center', gap: 5 },
  scrim: { flex: 1, backgroundColor: 'rgba(23,50,77,0.42)', justifyContent: 'center', alignItems: 'center', padding: 24 },
});
