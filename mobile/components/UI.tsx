import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { colors as c } from '../theme';

export const ui = StyleSheet.create({
  page: { padding: 22, paddingBottom: 40, gap: 20, width: '100%', maxWidth: 780, alignSelf: 'center' },
  title: { color: c.ink, fontSize: 32, lineHeight: 39, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  subtitle: { color: c.muted, fontSize: 15, lineHeight: 23 },
  h2: { color: c.ink, fontSize: 20, lineHeight: 28, fontWeight: '600' },
  body: { color: c.text, fontSize: 16, lineHeight: 25 },
  small: { color: c.muted, fontSize: 13, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  card: { backgroundColor: c.paper, borderRadius: 16, padding: 20, gap: 12, borderWidth: 1, borderColor: c.line },
  divider: { height: 1, backgroundColor: c.line, marginVertical: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: c.line, borderRadius: 10, backgroundColor: c.paper, paddingHorizontal: 14, paddingVertical: 12, color: c.ink, fontSize: 16 },
});
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) { return <View style={{ gap: 8 }}><Text accessibilityRole="header" style={ui.title}>{title}</Text>{subtitle && <Text style={ui.subtitle}>{subtitle}</Text>}</View>; }
export function Card({ children, style }: React.PropsWithChildren<{ style?: ViewStyle }>) { return <View style={[ui.card, style]}>{children}</View>; }
export function Button({ title, onPress, secondary, danger, disabled, busy, testID }: { title: string; onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean; busy?: boolean; testID?: string }) {
  const filled = !secondary;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 46, paddingHorizontal: 17, paddingVertical: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: disabled || busy ? 0.45 : pressed ? 0.75 : 1, backgroundColor: filled ? danger ? c.red : c.teal : c.blue })}>
    {busy && <ActivityIndicator color={filled ? 'white' : c.teal} size="small" />}<Text style={{ fontSize: 15, fontWeight: '600', color: filled ? 'white' : danger ? c.red : c.ink }}>{title}</Text>
  </Pressable>;
}
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityState={{ selected }} onPress={onPress} disabled={!onPress} style={{ minHeight: onPress ? 44 : 28, paddingVertical: onPress ? 11 : 4, paddingHorizontal: 12, borderRadius: 22, backgroundColor: selected ? c.ink : c.blue, justifyContent: 'center' }}><Text style={{ color: selected ? 'white' : c.ink, fontSize: 12, fontWeight: '600' }}>{label}</Text></Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) { return <View style={{ gap: 7 }}><Text style={ui.small}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={c.muted} {...props} style={[ui.input, props.multiline && { minHeight: 120, textAlignVertical: 'top' }, props.style]} /></View>; }
export function Empty({ title, text }: { title: string; text: string }) { return <Card><Text style={ui.h2}>{title}</Text><Text style={ui.body}>{text}</Text></Card>; }
