import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, PanResponder, Platform, Text, View } from 'react-native';
import { Button, useUI } from './UI';
import { useTheme } from '../theme';

/** Feedback stays visible until the learner presses Next or swipes left. */
export function LearningWindow({
  children,
  token,
  feedback,
  correct,
  onAdvance,
}: {
  children: React.ReactNode;
  token: string;
  feedback?: string;
  correct?: boolean;
  onAdvance: () => void | Promise<void>;
}) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const offset = useRef(new Animated.Value(0)).current;
  const [reduced, setReduced] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const advancing = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => alive.current && setReduced(value));
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive.current = false;
      motion.remove();
      offset.stopAnimation();
    };
  }, [offset]);
  useEffect(() => {
    setError('');
    offset.setValue(0);
  }, [token, offset]);
  async function advance() {
    if (!feedback || advancing.current) return;
    advancing.current = true;
    setBusy(true);
    setError('');
    try {
      await new Promise<void>((resolve) =>
        Animated.timing(offset, {
          toValue: reduced ? 0 : -32,
          duration: reduced ? 0 : 180,
          useNativeDriver: Platform.OS !== 'web',
        }).start(() => resolve()),
      );
      if (!alive.current) return;
      await onAdvance();
      if (alive.current) {
        offset.setValue(reduced ? 0 : 32);
        Animated.timing(offset, {
          toValue: 0,
          duration: reduced ? 0 : 180,
          useNativeDriver: Platform.OS !== 'web',
        }).start();
      }
    } catch (failure) {
      if (alive.current) {
        offset.setValue(0);
        setError((failure as Error).message);
      }
    } finally {
      advancing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const gesture = PanResponder.create({
    onMoveShouldSetPanResponder: (_, state) =>
      !!feedback &&
      !advancing.current &&
      state.dx < -24 &&
      Math.abs(state.dx) > Math.abs(state.dy) * 1.5,
    onPanResponderRelease: (_, state) => {
      if (state.dx < -64 && Math.abs(state.dx) > Math.abs(state.dy) * 1.5) void advance();
    },
  });
  const accent = correct === undefined ? c.ink : correct ? c.teal : c.red;
  return (
    <View style={{ flex: 1, overflow: 'hidden' }} {...gesture.panHandlers}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: offset }] }}>
        {children}
      </Animated.View>
      {!!feedback && (
        <View
          style={[
            ui.page,
            { paddingVertical: 12, gap: 8, borderTopWidth: 2, borderTopColor: accent },
          ]}
        >
          <Text accessibilityLiveRegion="polite" style={[ui.h2, { color: accent }]}>
            {correct === undefined ? '' : correct ? '✓ ' : '✕ '}
            {feedback}
          </Text>
          <Text style={ui.small}>Tap Next or swipe left when you are ready.</Text>
          {!!error && (
            <Text accessibilityRole="alert" style={ui.body}>
              {error}
            </Text>
          )}
          <Button title={error ? 'Retry next' : 'Next'} busy={busy} onPress={advance} />
        </View>
      )}
    </View>
  );
}
