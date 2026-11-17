import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUI } from './UI';
import { useTheme } from '../theme';

export function MenuRow({
  title,
  detail,
  icon,
  onPress,
}: {
  title: string;
  detail?: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}) {
  const ui = useUI();
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 64,
        paddingVertical: 14,
        gap: 14,
        borderBottomWidth: 1,
        borderColor: c.line,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={22} color={c.teal} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ ...ui.body, fontWeight: '600' }}>{title}</Text>
        {detail && <Text style={ui.small}>{detail}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={17} color={c.muted} />
    </Pressable>
  );
}
