import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { StudyEngine, BootProgress } from '../engine.ts';
import type { JsonIO } from '../storage/snapshot-store.ts';

export function useStartup(engine: StudyEngine, io: JsonIO, notify: (message: string) => void) {
  const [loaded, setLoaded] = useState(false);
  const [bootError, setBootError] = useState('');
  const [bootProgress, setBootProgress] = useState<BootProgress>({
    phase: 'Opening bundled library',
    completed: 0,
    total: 1,
  });
  const [bootSeconds, setBootSeconds] = useState(0);
  const bootStarted = useRef(Date.now());
  const bootBusy = useRef(false);
  const bootEvents = useRef<string[]>([]);
  function diagnostics(error = bootError) {
    return `English in Practice ${Constants.expoConfig?.version ?? 'unknown'}\n${Platform.OS} ${Platform.Version}\nStartup: ${Math.round((Date.now() - bootStarted.current) / 1000)}s\n${bootEvents.current.join('\n')}\n${error}`;
  }
  async function initialize() {
    if (bootBusy.current) return;
    bootBusy.current = true;
    bootStarted.current = Date.now();
    bootEvents.current = [];
    setBootSeconds(0);
    setBootError('');
    try {
      await engine.initialize((progress) => {
        setBootProgress(progress);
        bootEvents.current.push(
          `${Math.round((Date.now() - bootStarted.current) / 1000)}s ${progress.phase}: ${progress.completed}/${progress.total}`,
        );
        if (bootEvents.current.length > 12) bootEvents.current.shift();
      });
      setLoaded(true);
      void io.write('startup-diagnostics.json', diagnostics('')).catch(() => {});
      if (engine.recovered) notify('Recovered your last intact saved data.');
    } catch (e) {
      const error = (e as Error).message;
      setBootError(error);
      void io.write('startup-diagnostics.json', diagnostics(error)).catch(() => {});
    } finally {
      bootBusy.current = false;
    }
  }
  useEffect(() => {
    initialize();
  }, []);
  useEffect(() => {
    if (loaded || bootError) return;
    const timer = setInterval(
      () => setBootSeconds(Math.floor((Date.now() - bootStarted.current) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [loaded, bootError]);
  return { loaded, bootError, bootProgress, bootSeconds, diagnostics, initialize };
}
