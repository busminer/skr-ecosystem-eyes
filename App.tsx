import { useCallback, useEffect, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Haptics from 'expo-haptics';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Geist_900Black } from '@expo-google-fonts/geist';
import { GeistMono_400Regular, GeistMono_600SemiBold, GeistMono_700Bold, GeistMono_900Black } from '@expo-google-fonts/geist-mono';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fetchEcosystemState } from './src/api';
import { configureNotifications } from './src/notifications';
import { prepareSound } from './src/sound';
import { colors, font, spacing, type } from './src/theme';
import type { Freshness, FreshnessDetail } from './src/types';
import { AlertsLab } from './src/lab/AlertsLab';
import { FlowLab } from './src/lab/FlowLab';
import { Mark } from './src/lab/kit';
import { Splash } from './src/lab/Splash';
import { MyLab } from './src/lab/MyLab';
import { PulseLab } from './src/lab/PulseLab';
import { QueueLab } from './src/lab/QueueLab';

type Tab = 'pulse' | 'flow' | 'me' | 'queue' | 'alerts';

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'pulse', label: 'Pulse' },
  { key: 'flow', label: 'Flow' },
  { key: 'me', label: 'Me' },
  { key: 'queue', label: 'Queue' },
  { key: 'alerts', label: 'Alerts' },
];

const freshnessTone = { fresh: colors.positive, aging: colors.pending, stale: colors.pending, unavailable: colors.negative } as const;

// The badge answers "how current is what I am looking at", so it has to follow
// the tab. The vault metrics, the event stream and the queue scan each run on
// their own clock, and the queue is by far the slowest: reading its word over
// the whole app made every screen look stale while the numbers on it were
// seconds old.
const TAB_SOURCE: Record<Tab, keyof Pick<FreshnessDetail, 'metrics' | 'events' | 'queue' | 'overall'>> = {
  pulse: 'metrics',
  flow: 'events',
  me: 'metrics',
  queue: 'queue',
  alerts: 'overall',
};

// The age is measured from the moment the source itself last spoke, not from
// the moment we asked, so the badge cannot claim a number fresher than it is
// between two polls.
function shortAge(stamp: number | null | undefined): string | null {
  if (!stamp) return null;
  const seconds = Math.max(0, Math.floor(Date.now() / 1_000) - stamp);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3_600)}h`;
}

// The age has to count up on its own. The state poll speaks once every 30
// seconds, and the bar is redrawn only when it answers — so between answers the
// number sat still, and the next thing that happened to redraw the bar, usually
// a tab switch, made it jump. The ticker lives in here and not in App so that
// one second does not redraw every screen behind it.
function Age({ stamp }: { stamp: number | null | undefined }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((count) => count + 1), 1_000);
    return () => clearInterval(timer);
  }, []);
  const text = shortAge(stamp);
  return text ? <Text style={styles.statusAge}>{text}</Text> : null;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('pulse');
  const [detail, setDetail] = useState<FreshnessDetail | null>(null);
  const [stamps, setStamps] = useState<{ metrics: number | null; events: number | null; queue: number | null }>({ metrics: null, events: null, queue: null });
  const [opening, setOpening] = useState(true);
  const finishOpening = useCallback(() => setOpening(false), []);
  const [fontsLoaded] = useFonts({
    Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Geist_900Black,
    GeistMono_400Regular, GeistMono_600SemiBold, GeistMono_700Bold, GeistMono_900Black,
  });

  useEffect(() => { void configureNotifications(); void prepareSound(); }, []);
  // Nothing else hides the native splash, so the first painted frame does it.
  useEffect(() => { if (fontsLoaded) void SplashScreen.hideAsync().catch(() => undefined); }, [fontsLoaded]);
  useEffect(() => {
    const unavailable: FreshnessDetail = { overall: 'unavailable', metrics: 'unavailable', events: 'unavailable', queue: 'unavailable' };
    // One read serves both the word and the clock it is measured against.
    const read = () => fetchEcosystemState().then((state) => {
      // An older server sends only the one word; then every tab shares it.
      setDetail(state.status.freshnessDetail ?? {
        overall: state.status.freshness,
        metrics: state.status.freshness,
        events: state.status.freshness,
        queue: state.status.freshness,
      });
      setStamps({
        metrics: state.status.lastMetricsAt,
        events: state.status.lastEventAt ?? null,
        queue: state.status.lastQueueScanAt,
      });
    }).catch(() => setDetail(unavailable));
    void read();
    const timer = setInterval(() => void read(), 30_000);
    return () => clearInterval(timer);
  }, []);

  const select = useCallback((next: Tab) => {
    setTab((current) => {
      if (current !== next) void Haptics.selectionAsync();
      return next;
    });
  }, []);

  if (!fontsLoaded) return <View style={styles.boot} />;

  const source = TAB_SOURCE[tab];
  const freshness: Freshness | null = detail ? detail[source] : null;
  const tone = freshness ? freshnessTone[freshness] : colors.faint;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.topBar}>
          <Mark size={22} />
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.wordmark}>SKR EYES</Text>
          <View style={styles.status}>
            <View style={[styles.statusDot, { backgroundColor: tone }]} />
            <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.statusText, { color: tone }]}>{(freshness ?? 'syncing').toUpperCase()}</Text>
            {source === 'overall' ? null : <Age stamp={stamps[source]} />}
          </View>
        </View>

        <Animated.View key={tab} entering={FadeIn.duration(180)} style={styles.body}>
          {tab === 'pulse' ? <PulseLab onOpenQueue={() => select('queue')} /> : null}
          {tab === 'flow' ? <FlowLab active={tab === 'flow'} /> : null}
          {tab === 'me' ? <MyLab /> : null}
          {tab === 'queue' ? <QueueLab /> : null}
          {tab === 'alerts' ? <AlertsLab /> : null}
        </Animated.View>

        {opening ? <Splash onDone={finishOpening} /> : null}

        <View style={styles.nav}>
          {tabs.map((item) => {
            const active = item.key === tab;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                key={item.key}
                onPress={() => select(item.key)}
                style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}
              >
                <View style={[styles.navBar, active && styles.navBarActive]} />
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: { height: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  wordmark: { color: colors.text, fontFamily: font.black, fontSize: 12, letterSpacing: 1.6, flexShrink: 1 },
  status: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: font.semibold, ...type.eyebrow },
  statusAge: { color: colors.faint, fontFamily: font.mono, fontSize: 10.5, letterSpacing: 0.2 },
  body: { flex: 1 },
  nav: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg, paddingBottom: spacing.md, paddingTop: spacing.sm },
  navItem: { flex: 1, alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  navPressed: { opacity: 0.7 },
  navBar: { width: 22, height: 2, borderRadius: 1, backgroundColor: 'transparent' },
  navBarActive: { backgroundColor: colors.accent },
  navLabel: { color: colors.muted, fontFamily: font.semibold, fontSize: 13 },
  navLabelActive: { color: colors.text },
});
