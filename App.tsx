import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Haptics from 'expo-haptics';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Geist_900Black } from '@expo-google-fonts/geist';
import { GeistMono_400Regular, GeistMono_600SemiBold, GeistMono_700Bold, GeistMono_900Black } from '@expo-google-fonts/geist-mono';
// Sora is the face of the shareable card and nothing else. It loads here with
// the rest so the card never waits for a font at the moment somebody taps share.
import { Sora_400Regular, Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fetchEcosystemState } from './src/api';
import { langReady, t, useLang } from './src/i18n';
import { configureNotifications } from './src/notifications';
import { hydratePrefs } from './src/prefs';
import { prepareSound } from './src/sound';
import { useEventCues } from './src/lab/cues';
import { colors, font, spacing, type } from './src/theme';
import type { Freshness, FreshnessDetail } from './src/types';
import { AlertsLab } from './src/lab/AlertsLab';
import { FlowLab } from './src/lab/FlowLab';
import { Mark } from './src/lab/kit';
import { Splash } from './src/lab/Splash';
import { MyLab } from './src/lab/MyLab';
import { PulseLab } from './src/lab/PulseLab';

type Tab = 'pulse' | 'flow' | 'me' | 'alerts';

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'pulse', label: 'Vault' },
  { key: 'flow', label: 'Flow' },
  { key: 'me', label: 'Me' },
  { key: 'alerts', label: 'Alerts' },
];

const freshnessTone = { fresh: colors.positive, aging: colors.pending, stale: colors.pending, unavailable: colors.negative } as const;
// How far the eye in the header opens for each answer. The lids are the
// indicator now; the word beside them is only the age.
const freshnessOpen = { fresh: 1, aging: 0.62, stale: 0.22, unavailable: 0 } as const;

// The badge answers "how current is what I am looking at", so it has to follow
// the tab. The vault metrics, the event stream and the queue scan each run on
// their own clock, and the queue is by far the slowest: reading its word over
// the whole app made every screen look stale while the numbers on it were
// seconds old.
// The header's height is also the scene's top inset on Vault, so nothing is drawn under the wordmark.
const TOP_BAR = 46;

const TAB_SOURCE: Record<Tab, keyof Pick<FreshnessDetail, 'metrics' | 'events' | 'queue' | 'overall'>> = {
  pulse: 'metrics',
  flow: 'events',
  me: 'metrics',
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

// The row of tabs, and the one thing standing between it and the system.
//
// A phone on gesture navigation gives back a thin strip, and a fixed 12 was
// enough for it. A phone on three-button navigation takes about four times
// that, and the system's own back, home and recents sat straight on top of our
// labels — the app looked like a single page with no way out of it. The bar now
// asks the phone how much room it is actually leaving and takes the larger of
// the two answers.
function TabBar({ tab, onSelect }: { tab: Tab; onSelect: (next: Tab) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.nav, { paddingBottom: Math.max(spacing.md, insets.bottom + spacing.xs) }]}>
      {tabs.map((item) => {
        const active = item.key === tab;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}
          >
            <View style={[styles.navBar, active && styles.navBarActive]} />
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.navLabel, active && styles.navLabelActive]}>{t(item.label)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('pulse');
  // On Vault the header floats over the sky; once the page scrolls it gets its ground back.
  const [vaultAtTop, setVaultAtTop] = useState(true);
  const [detail, setDetail] = useState<FreshnessDetail | null>(null);
  const [stamps, setStamps] = useState<{ metrics: number | null; events: number | null; queue: number | null }>({ metrics: null, events: null, queue: null });
  const [opening, setOpening] = useState(true);
  const [langLoaded, setLangLoaded] = useState(false);
  // Nothing on screen may be drawn in the wrong language and then swapped, so
  // the saved choice is read before the first frame, beside the fonts.
  useLang();
  // Sounds and buzzes for the vault's moves belong to the app, not to a tab.
  useEventCues();
  const appState = useRef(AppState.currentState);
  const reading = useRef(false);
  const finishOpening = useCallback(() => setOpening(false), []);
  const [fontsLoaded] = useFonts({
    Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Geist_900Black,
    GeistMono_400Regular, GeistMono_600SemiBold, GeistMono_700Bold, GeistMono_900Black,
    Sora_400Regular, Sora_600SemiBold, Sora_700Bold,
  });

  useEffect(() => { void hydratePrefs(); void configureNotifications(); void prepareSound(); }, []);
  useEffect(() => { void langReady.then(() => setLangLoaded(true)); }, []);
  // Nothing else hides the native splash, so the first painted frame does it.
  useEffect(() => { if (fontsLoaded) void SplashScreen.hideAsync().catch(() => undefined); }, [fontsLoaded]);
  useEffect(() => {
    const unavailable: FreshnessDetail = { overall: 'unavailable', metrics: 'unavailable', events: 'unavailable', queue: 'unavailable' };
    // One read serves both the word and the clock it is measured against.
    const read = () => {
      // A phone in a pocket must not keep asking the server for news. Flow has
      // said this since it was written; the bar at the top had not, so a
      // backgrounded app went on pulling the whole state every 30 seconds.
      if (appState.current !== 'active') return Promise.resolve();
      // A read that has not come back yet is not helped by starting another
      // one beside it. Two answers in flight can also land out of order and
      // let the older one overwrite the newer.
      if (reading.current) return Promise.resolve();
      reading.current = true;
      return fetchEcosystemState().then((state) => {
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
      }).catch(() => setDetail(unavailable)).finally(() => { reading.current = false; });
    };
    void read();
    const timer = setInterval(() => void read(), 30_000);
    // Coming back to the app should not mean waiting out the rest of a poll
    // that was skipped while it was away.
    const subscription = AppState.addEventListener('change', (next) => {
      appState.current = next;
      if (next === 'active') void read();
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);

  const select = useCallback((next: Tab) => {
    setTab((current) => {
      if (current !== next) void Haptics.selectionAsync();
      return next;
    });
  }, []);

  if (!fontsLoaded || !langLoaded) return <View style={styles.boot} />;

  const source = TAB_SOURCE[tab];
  const freshness: Freshness | null = detail ? detail[source] : null;
  const tone = freshness ? freshnessTone[freshness] : colors.faint;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={[styles.topBar, tab === 'pulse' && { zIndex: 3, backgroundColor: vaultAtTop ? 'transparent' : colors.bg }]}>
          <Mark size={22} open={freshness ? freshnessOpen[freshness] : 1} />
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.wordmark}>SKR EYES</Text>
          <View style={styles.status}>
            <View style={[styles.statusDot, { backgroundColor: tone }]} />
            <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.statusText, { color: tone }]}>{t(freshness ?? 'syncing').toUpperCase()}</Text>
            {source === 'overall' ? null : <Age stamp={stamps[source]} />}
          </View>
        </View>

        <Animated.View key={tab} entering={FadeIn.duration(180)} style={[styles.body, tab === 'pulse' && { marginTop: -TOP_BAR }]}>
          {tab === 'pulse' ? <PulseLab frozen={freshness === 'stale' || freshness === 'unavailable'} topInset={TOP_BAR} onAtTop={setVaultAtTop} /> : null}
          {tab === 'flow' ? <FlowLab active={tab === 'flow'} /> : null}
          {tab === 'me' ? <MyLab /> : null}
          {tab === 'alerts' ? <AlertsLab /> : null}
        </Animated.View>

        {opening ? <Splash onDone={finishOpening} /> : null}

        <TabBar tab={tab} onSelect={select} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: { height: TOP_BAR, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
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
