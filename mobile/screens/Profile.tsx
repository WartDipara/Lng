import release from '../../config/release.json';
import React, { useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Button, Card, Heading, useUI } from '../components/UI';
import { useTheme } from '../theme';
import { activityDays, localDateKey, sessionSummary } from '../../src/practice-session.ts';
import type { ScreenProps } from '../routes';

export function ProfileScreen({ engine, navigate, notify }: ScreenProps) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const sessions = (engine.user.practiceSessions ?? [])
    .filter((s) => s.submittedAt)
    .sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!));
  const totals = sessions.reduce(
    (sum, s) => {
      const r = sessionSummary(s);
      return { correct: sum.correct + r.correct, total: sum.total + r.total };
    },
    { correct: 0, total: 0 },
  );
  const sessionAttemptIds = new Set(
    sessions.flatMap((s) => s.items.flatMap((i) => (i.attemptId ? [i.attemptId] : []))),
  );
  const individual = engine.user.attempts.filter(
    (a) => a.kind === 'question' && !sessionAttemptIds.has(a.id),
  );
  const days = activityDays(engine.user);
  const [shown, setShown] = useState(10);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() - 84);
  const today = new Date();
  const todayKey = localDateKey(today);
  const chartSessions = sessions.slice(-30);
  return (
    <ScrollView contentContainerStyle={ui.page}>
      <Heading title="My progress" subtitle="Your learning, saved on this device." />
      <Card>
        <Text style={ui.h2}>{engine.user.profile?.name ?? 'My learning'}</Text>
        <Text selectable style={ui.small}>
          Local ID: {engine.user.profile?.id}
        </Text>
        <Text style={ui.small}>
          No account or password required. Your local identity is included in exported backups.
        </Text>
      </Card>
      <View style={ui.row}>
        <Card style={{ flex: 1 }}>
          <Text style={ui.title}>{sessions.length}</Text>
          <Text style={ui.small}>Practice sets</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={ui.title}>
            {totals.total ? `${Math.round((totals.correct / totals.total) * 100)}%` : '—'}
          </Text>
          <Text style={ui.small}>Overall accuracy</Text>
        </Card>
      </View>
      <Text style={ui.body}>
        {totals.correct} fully correct / {totals.total} questions in submitted sets. Unanswered
        questions are included. Individual practice and word reviews appear in activity below.
      </Text>
      {!!individual.length && (
        <Card>
          <Text style={ui.h2}>Individual question practice</Text>
          <Text style={ui.body}>
            {individual.filter((a) => a.score === a.maxScore).length}/{individual.length} attempts
            fully correct (
            {Math.round(
              (individual.filter((a) => a.score === a.maxScore).length / individual.length) * 100,
            )}
            %). These include earlier practice before sets were introduced.
          </Text>
        </Card>
      )}
      <Card>
        <Text style={ui.h2}>Accuracy over time</Text>
        <Text style={ui.small}>
          Each point is one submitted set, oldest to newest (last 30). Different sets may have
          different difficulty.
        </Text>
        <AccuracyChart values={chartSessions.map((s) => sessionSummary(s).accuracy)} />
        {chartSessions.length > 0 && (
          <Text style={ui.small}>
            {new Date(chartSessions[0].submittedAt!).toLocaleDateString('en')} →{' '}
            {new Date(chartSessions[chartSessions.length - 1].submittedAt!).toLocaleDateString(
              'en',
            )}
          </Text>
        )}
      </Card>
      <Card>
        <Text style={ui.h2}>Learning activity</Text>
        <Text style={ui.small}>{days.size} active days · last 13 weeks shown · Sun–Sat</Text>
        <View style={{ flexDirection: 'row', gap: 4, justifyContent: 'space-between' }}>
          {Array.from({ length: 13 }, (_, week) => (
            <View key={week} style={{ gap: 4 }}>
              {Array.from({ length: 7 }, (_, weekday) => {
                const date = new Date(start);
                date.setDate(start.getDate() + week * 7 + weekday);
                const key = localDateKey(date);
                const n = days.get(key) ?? 0;
                return (
                  <View
                    key={key}
                    accessible
                    accessibilityLabel={`${key}: ${n} learning activities`}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      opacity: key > todayKey ? 0 : 1,
                      backgroundColor:
                        n === 0
                          ? c.line
                          : n < 3
                            ? c.activityLow
                            : n < 8
                              ? c.activityMedium
                              : c.activityHigh,
                    }}
                  />
                );
              })}
            </View>
          ))}
        </View>
        <Text style={ui.small}>
          Gray: no activity · Increasing shade: 1–2, 3–7, 8+ answers. Dates use your device’s local
          time.
        </Text>
      </Card>
      <Heading title="Practice history" subtitle="Open a set to revisit every answer." />
      {!sessions.length && (
        <Text style={ui.body}>Complete your first set to start your chart.</Text>
      )}
      {[...sessions]
        .reverse()
        .slice(0, shown)
        .map((s) => {
          const result = sessionSummary(s);
          return (
            <Card key={s.id}>
              <Text style={ui.h2}>
                {result.accuracy}% · {result.correct}/{result.total} correct
              </Text>
              <Text style={ui.small}>
                {new Date(s.submittedAt!).toLocaleString('en')} · {result.unanswered} unanswered
              </Text>
              <Button
                title="Review this set"
                secondary
                onPress={() => navigate({ name: 'practice-session', id: s.id })}
              />
            </Card>
          );
        })}
      {shown < sessions.length && (
        <Button title="Show older sets" secondary onPress={() => setShown(shown + 10)} />
      )}
      <Card>
        <Text style={ui.h2}>Library & backups</Text>
        <Text style={ui.body}>
          Export a backup before changing phones or uninstalling. It includes your identity, drafts,
          results, notes and imported content.
        </Text>
        <Button title="Open library and backups" onPress={() => navigate({ name: 'library' })} />
      </Card>
      <Card>
        <Text style={ui.h2}>App updates</Text>
        <Text style={ui.small}>
          Installed version: {Constants.expoConfig?.version ?? 'unknown'}
        </Text>
        <Text style={ui.body}>
          Download the newer APK from our GitHub Releases and install it over this app. Keep the
          current app installed. If Android rejects the update, keep your data and export a backup;
          do not uninstall to work around the error.
        </Text>
        <Text style={ui.small}>
          Clearing app storage or uninstalling removes local records. Restore an exported backup to
          recover them. Opening GitHub needs internet; learning does not.
        </Text>
        <Button
          title="Open GitHub Releases"
          secondary
          onPress={() => {
            Linking.openURL(`https://github.com/${release.repository}/releases/latest`).catch((e) =>
              notify(e.message),
            );
          }}
        />
      </Card>
    </ScrollView>
  );
}

function AccuracyChart({ values }: { values: number[] }) {
  const ui = useUI();
  const { colors: c } = useTheme();
  const [width, setWidth] = useState(240);
  if (!values.length) return <Text style={ui.small}>No submitted sets yet.</Text>;
  const point = (i: number) => ({
    x: 8 + ((width - 16) * i) / Math.max(1, values.length - 1),
    y: 12 + (100 - values[i]) * 1.2,
  });
  return (
    <View>
      <Text style={ui.small}>100%</Text>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityLabel={`Set accuracies, oldest first: ${values.map((v) => `${v}%`).join(', ')}`}
        style={{ height: 144, borderBottomWidth: 1, borderColor: c.line }}
      >
        {values.slice(1).map((_, i) => {
          const a = point(i);
          const b = point(i + 1);
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          return (
            <View
              key={`line${i}`}
              style={{
                position: 'absolute',
                left: (a.x + b.x - length) / 2,
                top: (a.y + b.y) / 2 - 1,
                width: length,
                height: 2,
                backgroundColor: c.teal,
                transform: [{ rotate: `${Math.atan2(b.y - a.y, b.x - a.x)}rad` }],
              }}
            />
          );
        })}
        {values.map((_, i) => {
          const p = point(i);
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: p.x - 3,
                top: p.y - 3,
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: c.teal,
              }}
            />
          );
        })}
      </View>
      <Text style={ui.small}>0%</Text>
    </View>
  );
}
