import { SerialQueue } from '../src/serial-queue.ts';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { io } from './storage/io';

export const lightColors = {
  success: '#238636',
  onSuccess: '#FFFFFF',
  activityLow: '#9BE9A8',
  activityMedium: '#40C463',
  activityHigh: '#216E39',
  paper: '#FFFFFF',
  background: '#F5F7F8',
  ink: '#183645',
  text: '#304855',
  muted: '#657A86',
  teal: '#117B72',
  paleTeal: '#E5F3EE',
  blue: '#EAF0F4',
  line: '#D9E3E8',
  red: '#AD3547',
  paleRed: '#FBECEF',
  onAccent: '#FFFFFF',
  scrim: 'rgba(10,25,35,0.56)',
  hero: '#173D47',
  heroText: '#F1FAF8',
};
export type Colors = typeof lightColors;
export const darkColors: Colors = {
  success: '#3FB950',
  onSuccess: '#102A16',
  activityLow: '#0E4429',
  activityMedium: '#26A641',
  activityHigh: '#39D353',
  paper: '#1B262D',
  background: '#11191F',
  ink: '#EDF3F0',
  text: '#CAD5D7',
  muted: '#9AAEB6',
  teal: '#79D9C3',
  paleTeal: '#203E39',
  blue: '#24343E',
  line: '#354650',
  red: '#FFA6B1',
  paleRed: '#402A34',
  onAccent: '#103D35',
  scrim: 'rgba(0,0,0,0.72)',
  hero: '#203B40',
  heroText: '#ECFAF7',
};
export type ThemeMode = 'system' | 'light' | 'dark';
interface ThemeValue {
  colors: Colors;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  error: string;
}
const ThemeContext = createContext<ThemeValue>({
  colors: lightColors,
  isDark: false,
  mode: 'system',
  setMode: () => {},
  error: '',
});
export const useTheme = () => useContext(ThemeContext);
export function ThemeProvider({ children }: React.PropsWithChildren) {
  const system = useColorScheme();
  const [mode, setValue] = useState<ThemeMode>('system');
  const [error, setError] = useState('');
  const revision = useRef(0);
  const [saves] = useState(() => new SerialQueue());
  useEffect(() => {
    let active = true;
    io.read('appearance.json')
      .then((text) => {
        if (!active || revision.current || !text) return;
        const value = JSON.parse(text).mode;
        if (['system', 'light', 'dark'].includes(value)) setValue(value);
      })
      .catch(
        () =>
          active && setError('Appearance could not be loaded. Choose a theme to save it again.'),
      );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web') Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }, [mode]);
  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');
  const value = useMemo<ThemeValue>(
    () => ({
      colors: isDark ? darkColors : lightColors,
      isDark,
      mode,
      error,
      setMode(next) {
        revision.current++;
        setValue(next);
        setError('');
        void saves
          .run(() => io.write('appearance.json', JSON.stringify({ mode: next })))
          .catch(() => setError('Appearance changed, but could not be saved. Try again.'));
      },
    }),
    [isDark, mode, error],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
