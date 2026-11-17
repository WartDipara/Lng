import { highlightParts } from '../highlight';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useTheme, type Colors } from '../theme';

export const makeUI = (c: Colors) =>
  StyleSheet.create({
    page: {
      padding: 20,
      paddingBottom: 32,
      gap: 18,
      width: '100%',
      maxWidth: 620,
      alignSelf: 'center',
    },
    title: {
      color: c.ink,
      fontSize: 30,
      lineHeight: 37,
      fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    },
    subtitle: { color: c.muted, fontSize: 14, lineHeight: 21 },
    h2: { color: c.ink, fontSize: 19, lineHeight: 26, fontWeight: '600' },
    body: { color: c.text, fontSize: 16, lineHeight: 25 },
    small: { color: c.muted, fontSize: 13, lineHeight: 20 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    card: {
      backgroundColor: c.paper,
      borderRadius: 20,
      padding: 18,
      gap: 12,
      borderWidth: 1,
      borderColor: c.line,
    },
    divider: { height: 1, backgroundColor: c.line, marginVertical: 6 },
    input: {
      minHeight: 50,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 14,
      backgroundColor: c.paper,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: c.ink,
      fontSize: 16,
    },
  });
export function useUI() {
  const { colors } = useTheme();
  return useMemo(() => makeUI(colors), [colors]);
}
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => active && setReduced(value));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  const ui = useUI();
  return (
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={ui.title}>
        {title}
      </Text>
      {subtitle && <Text style={ui.subtitle}>{subtitle}</Text>}
    </View>
  );
}
export function Card({ children, style }: React.PropsWithChildren<{ style?: ViewStyle }>) {
  const ui = useUI();
  return <View style={[ui.card, style]}>{children}</View>;
}
export function Button({
  title,
  onPress,
  secondary,
  danger,
  disabled,
  busy,
  testID,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  const { colors: c } = useTheme();
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (value: number) => {
    scale.stopAnimation();
    if (reduced) scale.setValue(1);
    else Animated.timing(scale, { toValue: value, duration: 90, useNativeDriver: true }).start();
  };
  const filled = !secondary;
  const foreground = filled ? (danger ? c.paper : c.onAccent) : danger ? c.red : c.ink;
  return (
    <Animated.View style={{ transform: [{ scale }], flexShrink: 1 }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || busy, busy }}
        disabled={disabled || busy}
        onPress={onPress}
        onPressIn={() => animate(0.97)}
        onPressOut={() => animate(1)}
        style={({ pressed }) => ({
          minHeight: 50,
          paddingHorizontal: 17,
          paddingVertical: 13,
          borderRadius: 15,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled || busy ? 0.45 : pressed ? 0.8 : 1,
          backgroundColor: filled ? (danger ? c.red : c.teal) : c.blue,
        })}
      >
        {busy && <ActivityIndicator color={foreground} size="small" />}
        <Text style={{ fontSize: 15, fontWeight: '600', textAlign: 'center', color: foreground }}>
          {title}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ selected }}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        minHeight: onPress ? 48 : 28,
        paddingVertical: onPress ? 11 : 4,
        paddingHorizontal: 14,
        borderRadius: 24,
        backgroundColor: selected ? c.teal : c.blue,
        opacity: pressed ? 0.75 : 1,
        justifyContent: 'center',
      })}
    >
      <Text style={{ color: selected ? c.onAccent : c.ink, fontSize: 13, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const ui = useUI();
  const { colors: c, isDark } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 7 }}>
      <Text style={ui.small}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        selectionColor={c.teal}
        keyboardAppearance={isDark ? 'dark' : 'light'}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          ui.input,
          focused && { borderColor: c.teal, borderWidth: 2 },
          props.multiline && { minHeight: 120, textAlignVertical: 'top' },
          props.style,
        ]}
      />
    </View>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  const ui = useUI();
  return (
    <Card>
      <Text style={ui.h2}>{title}</Text>
      <Text style={ui.body}>{text}</Text>
    </Card>
  );
}
export function Reveal({ visible, children }: React.PropsWithChildren<{ visible: boolean }>) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    opacity.stopAnimation();
    if (reduced) opacity.setValue(visible ? 1 : 0);
    else
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: 160,
        useNativeDriver: true,
      }).start();
  }, [visible, reduced]);
  return visible ? <Animated.View style={{ opacity, gap: 12 }}>{children}</Animated.View> : null;
}
export function Disclosure({
  title,
  children,
  initiallyOpen = false,
}: React.PropsWithChildren<{ title: string; initiallyOpen?: boolean }>) {
  const [open, setOpen] = useState(initiallyOpen);
  const ui = useUI();
  const { colors: c } = useTheme();
  return (
    <View style={{ borderTopWidth: 1, borderColor: c.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => ({
          minHeight: 52,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={[ui.body, { flex: 1, fontWeight: '600' }]}>{title}</Text>
        <Text style={{ color: c.teal, fontSize: 23 }}>{open ? '−' : '+'}</Text>
      </Pressable>
      <Reveal visible={open}>
        <View style={{ paddingBottom: 16, gap: 12 }}>{children}</View>
      </Reveal>
    </View>
  );
}
export function Feedback({
  kind,
  children,
}: React.PropsWithChildren<{ kind: 'success' | 'error' | 'info' }>) {
  const { colors: c } = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        padding: 15,
        borderRadius: 14,
        backgroundColor: kind === 'error' ? c.paleRed : kind === 'success' ? c.paleTeal : c.blue,
        gap: 8,
      }}
    >
      {children}
    </View>
  );
}

export function HighlightText({
  text,
  terms,
  style,
}: {
  text: string;
  terms: string[];
  style?: StyleProp<TextStyle>;
}) {
  const parts = useMemo(() => highlightParts(text, terms), [text, terms]);
  return (
    <Text style={style}>
      {parts.map((part, index) =>
        part.highlighted ? (
          <Text key={index} style={{ fontWeight: '700', textDecorationLine: 'underline' }}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}
