import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Button, Card, Heading, useUI } from '../components/UI';
import { updater, type UpdateProgress } from '../updates/native';
import { checkAppUpdate, type AppUpdate } from '../../src/app-update.ts';
import { useTheme } from '../theme';

type Phase =
  | 'idle'
  | 'available'
  | 'checking'
  | 'downloading'
  | 'cancelling'
  | 'ready'
  | 'permission'
  | 'installing'
  | 'installer'
  | 'current'
  | 'error';
export function AppUpdatesScreen() {
  const ui = useUI();
  const { colors: c } = useTheme();
  const [phase, setPhase] = useState<Phase>('idle');
  const [update, setUpdate] = useState<AppUpdate>();
  const [progress, setProgress] = useState<UpdateProgress>({ received: 0, total: 0 });
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const active = useRef(true);
  const locked = useRef(false);
  const abort = useRef<AbortController | undefined>(undefined);
  const operation = useRef(0);
  const [installed] = useState(() => updater?.installed());
  useEffect(() => {
    active.current = true;
    const subscription = updater?.addListener(
      'progress',
      (value) => active.current && setProgress(value),
    );
    return () => {
      active.current = false;
      operation.current++;
      abort.current?.abort();
      updater?.cancel();
      subscription?.remove();
    };
  }, []);
  async function install() {
    if (!updater || locked.current) return;
    locked.current = true;
    setError('');
    try {
      if (!updater.canInstall()) {
        setPhase('permission');
        return;
      }
      setPhase('installing');
      await updater.install();
      if (active.current) setPhase('installer');
    } catch (failure) {
      if (active.current) {
        setError((failure as Error).message);
        setPhase('available');
      }
    } finally {
      locked.current = false;
      if (active.current) setPhase((value) => (value === 'cancelling' ? 'idle' : value));
    }
  }
  async function check() {
    if (!updater || !installed || locked.current) return;
    locked.current = true;
    const current = ++operation.current;
    const controller = new AbortController();
    abort.current = controller;
    setPhase('checking');
    setError('');
    setUpdate(undefined);
    setProgress({ received: 0, total: 0 });
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const candidate = await checkAppUpdate(installed, controller.signal);
      clearTimeout(timer);
      if (!active.current || current !== operation.current) return;
      if (!candidate) {
        setPhase('current');
        return;
      }
      setUpdate(candidate);
      setPhase('available');
      setConfirm(true);
    } catch (failure) {
      if (active.current && current === operation.current) {
        setError(
          controller.signal.aborted
            ? 'The update check timed out. Check your connection and retry.'
            : (failure as Error).message,
        );
        setPhase('error');
      }
    } finally {
      clearTimeout(timer);
      locked.current = false;
      if (active.current) setPhase((value) => (value === 'cancelling' ? 'idle' : value));
    }
  }
  async function download() {
    if (!updater || !update || locked.current) return;
    locked.current = true;
    const current = ++operation.current;
    setConfirm(false);
    setPhase('downloading');
    setError('');
    try {
      await updater.download(update.url, update.sha256, update.size, update.versionCode);
      if (!active.current || current !== operation.current) return;
      setPhase('ready');
      locked.current = false;
      await install();
    } catch (failure) {
      if (active.current && current === operation.current) {
        setError((failure as Error).message);
        setPhase('available');
      }
    } finally {
      locked.current = false;
      if (active.current) setPhase((value) => (value === 'cancelling' ? 'idle' : value));
    }
  }
  function cancel() {
    operation.current++;
    abort.current?.abort();
    updater?.cancel();
    // Keep the lock until the native operation has stopped and cleaned its partial file.
    setPhase('cancelling');
    setError('');
  }
  const busy = ['checking', 'downloading', 'installing', 'cancelling'].includes(phase);
  const percent = progress.total
    ? Math.min(100, Math.floor((progress.received / progress.total) * 100))
    : 0;
  return (
    <ScrollView contentContainerStyle={ui.page}>
      <Heading title="App updates" subtitle="Keep your learning up to date." />
      <Card>
        <Text style={ui.h2}>
          Version {installed?.version ?? Constants.expoConfig?.version ?? 'unknown'}
        </Text>
        <Text style={ui.body}>
          Check for a newer version. You choose whether to download an update. Android will ask you
          to confirm installation.
        </Text>
        {!updater && (
          <Text style={ui.small}>
            {Platform.OS === 'android'
              ? 'Install a build with in-app updates to use this feature.'
              : 'Update installation is available in the Android app.'}
          </Text>
        )}
        {phase === 'cancelling' && (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            Cancelling…
          </Text>
        )}
        {phase === 'current' && (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            You are up to date.
          </Text>
        )}
        {phase === 'checking' && (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            Checking for updates…
          </Text>
        )}
        {update && (
          <Text style={ui.body}>
            Update {update.version} · {(update.size / 1048576).toFixed(1)} MB
          </Text>
        )}
        {phase === 'downloading' && (
          <View style={{ gap: 10 }}>
            <Text accessibilityLiveRegion="polite" style={ui.body}>
              {percent === 100 ? 'Verifying update…' : `Downloading update… ${percent}%`}
            </Text>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: percent }}
              style={{ height: 6, backgroundColor: c.line }}
            >
              <View style={{ height: 6, width: `${percent}%`, backgroundColor: c.teal }} />
            </View>
          </View>
        )}
        {phase === 'permission' && (
          <>
            <Text style={ui.body}>
              Allow updates from this app in Android settings, then return here to install.
            </Text>
            <Button
              title="Allow app updates"
              onPress={() => {
                try {
                  updater?.openInstallSettings();
                } catch (failure) {
                  setError((failure as Error).message);
                }
              }}
            />
          </>
        )}
        {phase === 'installer' && (
          <Text style={ui.body}>
            Confirm the update in Android. If you cancelled, you can open the installer again.
          </Text>
        )}
        {phase === 'installing' && (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            Opening Android installer…
          </Text>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={[ui.body, { color: c.red }]}>
            {error}
          </Text>
        )}
        {phase === 'available' ? (
          <Button title="Update available" onPress={() => setConfirm(true)} />
        ) : ['ready', 'permission', 'installer'].includes(phase) ? (
          <Button title="Install update" onPress={install} />
        ) : (
          <Button title="Check for update" onPress={check} busy={busy} disabled={!updater} />
        )}
        {['checking', 'downloading'].includes(phase) && (
          <Button
            title={phase === 'checking' ? 'Cancel check' : 'Cancel download'}
            secondary
            onPress={cancel}
          />
        )}
        <Text style={ui.small}>
          Updates need internet and may use mobile data. Your learning progress stays on this
          device. Keep this app installed.
        </Text>
      </Card>
      <Modal
        visible={confirm}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirm(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
            backgroundColor: c.scrim,
          }}
        >
          <Card style={{ width: '100%', maxWidth: 380 }}>
            <Text accessibilityRole="header" style={ui.h2}>
              Update available
            </Text>
            <Text style={ui.body}>
              Version {update?.version} is ready. Would you like to update now?
            </Text>
            <Text style={ui.small}>
              Download size: {((update?.size ?? 0) / 1048576).toFixed(1)} MB. Mobile data may be
              used.
            </Text>
            <Button title="Update now" onPress={download} />
            <Button title="Not now" secondary onPress={() => setConfirm(false)} />
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}
