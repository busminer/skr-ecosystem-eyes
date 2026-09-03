import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { API_BASE_URL, fetchEcosystemState } from '../api';
import type { EcosystemState } from '../types';
import { t } from '../i18n';
import { compact, shortAddress } from '../format';
import { usePref } from '../prefs';
import { playCue } from '../sound';
import { colors, font, gold, radius, spacing, type } from '../theme';
import { Eyebrow, Panel } from './kit';

// The live floor of the vault. Every line here is a finalized transaction that
// actually happened: nothing is invented to fill the silence, and when the
// chain is quiet the screen is quiet too.
//
// Almost all real traffic is one and two SKR dust, so dust streams past as a
// thin line while the day's biggest move stays pinned at the top. The stream
// gives the feeling of a live chain; the pinned block gives the meaning.

const POLL_MS = 6_000;
const HEADLINE_POLL_MS = 90_000;
const FEED_LIMIT = 60;
// How many event ids the screen keeps in mind before it starts forgetting.
const SEEN_LIMIT = 600;
const HAPTIC_GAP_MS = 260;
// A large move announces itself, but never more than once every few seconds,
// however busy the chain gets.
const SURGE_GAP_MS = 6_000;
// Whole SKR on purpose: the server parses `min` as an integer and refuses a
// fraction, so a threshold like 0.5 would silently return nothing.
const BIG_EVENT = 100_000;
// From here up a stake earns a label in the vault and a bird in the feed.
const LABEL_EVENT = 1_000;
const BIRD_GAP_MS = 4_000;
// Big moves earn a card, but only the two most recent ones. Any older large
// event folds into a single summary line so the feed never becomes a wall.
const BIG_CARDS_OPEN = 2;
const HEADLINE_MINIMUM = 50_000;
const DAY_SECONDS = 86_400;

// The chips say what kind of move, and each carries the day's total, so the
// shape of the day is readable before anything is tapped.
const KINDS = [
  { key: 'all', label: 'All' },
  { key: 'stake', label: 'Stakes' },
  { key: 'unstake', label: 'Exits' },
  { key: 'withdraw', label: 'Withdrew' },
] as const;

type KindKey = typeof KINDS[number]['key'];

const SIZES = [
  { label: 'ALL', min: 0 },
  { label: '1K+', min: 1_000 },
  { label: '100K+', min: 100_000 },
] as const;

type FlowEvent = {
  id: string;
  signature: string;
  slot: number;
  blockTime: number;
  type: string;
  wallet: string;
  // The Seeker ID behind the address, when the server has one for it. Almost
  // every wallet in this feed has one, because the app only reaches Seekers.
  name?: string | null;
  amount: number | null;
};

const TONE: Record<string, string> = {
  stake: colors.positive,
  unstake: colors.negative,
  withdraw: colors.pending,
  cancel_unstake: colors.accent,
};

const VERB: Record<string, string> = {
  stake: 'staked',
  unstake: 'asked out',
  withdraw: 'withdrew',
  cancel_unstake: 'cancelled exit',
};

function ago(blockTime: number, now: number): string {
  const seconds = Math.max(0, now - blockTime);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < DAY_SECONDS) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / DAY_SECONDS)}d`;
}

// The feed is polled every six seconds, so a request that hangs would pile the
// next one on top of it. It gets a deadline shorter than the gap between polls
// it would otherwise block.
const EVENTS_TIMEOUT_MS = 15_000;

async function fetchEvents(minimum: number, limit: number): Promise<FlowEvent[]> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), EVENTS_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/api/events?limit=${limit}&min=${minimum}`, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json() as { items?: FlowEvent[] };
    return payload.items ?? [];
  } finally {
    clearTimeout(deadline);
  }
}

// A person, not an address. The short address stays as the fallback for the
// rare wallet with no Seeker ID — and for anybody watching this feed from
// outside the Seeker world.
function who(event: FlowEvent): string {
  return event.name ? `${event.name}.skr` : shortAddress(event.wallet);
}

// The pinned block. Within a day it is today's biggest move; if the day was
// quiet it says so and shows the last big one instead of pretending.

function Headline({ event, now, title }: { event: FlowEvent; now: number; title?: string }) {
  const tone = TONE[event.type] ?? colors.muted;
  const today = now - event.blockTime <= DAY_SECONDS;
  return (
    <Panel style={[styles.headline, { borderColor: tone }]} tone={tone}>
      <View style={styles.headlineTop}>
        <Eyebrow tone={tone}>{title ?? (today ? t('Biggest seen today') : t('Last big move'))}</Eyebrow>
        <Text style={styles.headlineTime}>{t('{age} ago', { age: ago(event.blockTime, now) })}</Text>
      </View>
      <View style={styles.headlineRow}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.headlineAmount}>
          {event.amount != null ? compact(event.amount) : '—'}
        </Text>
        <Text style={styles.headlineUnit}>SKR</Text>
        <Text style={[styles.headlineKind, { color: tone }]}>{t(VERB[event.type] ?? event.type).toUpperCase()}</Text>
      </View>
      <View style={styles.headlineFoot}>
        <Text numberOfLines={1} style={styles.wallet}>{who(event)}</Text>
        <Text style={styles.slot}>{t('slot {slot}', { slot: event.slot.toLocaleString('en-US') })}</Text>
      </View>
    </Panel>
  );
}

function BigEvent({ event, now, onPress }: { event: FlowEvent; now: number; onPress?: () => void }) {
  const tone = TONE[event.type] ?? colors.muted;
  return (
    <Animated.View entering={FadeInDown.duration(280)} layout={Layout.duration(220)} onTouchEnd={onPress}>
      <Panel style={styles.card} tone={tone}>
        <View style={styles.cardTop}>
          <Text style={[styles.kind, { color: tone }]}>{t(VERB[event.type] ?? event.type).toUpperCase()}</Text>
          <Text style={styles.time}>{t('{age} ago', { age: ago(event.blockTime, now) })}</Text>
        </View>
        <View style={styles.amountRow}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.amount}>
            {event.amount != null ? compact(event.amount) : t('amount unavailable')}
          </Text>
          {event.amount != null ? <Text style={styles.unit}>SKR</Text> : null}
        </View>
        <View style={styles.cardFoot}>
          <Text numberOfLines={1} style={styles.wallet}>{who(event)}</Text>
          <Text style={styles.slot}>{t('slot {slot}', { slot: event.slot.toLocaleString('en-US') })}</Text>
        </View>
      </Panel>
    </Animated.View>
  );
}

function FoldedBig({ count, total, expanded, onPress }: { count: number; total: number; expanded: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.folded, pressed && styles.foldedPressed]}>
      <View style={styles.foldedMark} />
      <Text style={styles.foldedText}>
        {expanded ? t('Fold the older large moves') : count === 1 ? t('1 more large move') : t('{count} more large moves', { count })}
      </Text>
      <Text style={styles.foldedTotal}>{expanded ? '' : `${compact(total)} SKR`}</Text>
      <Text style={styles.foldedChevron}>{expanded ? '×' : '+'}</Text>
    </Pressable>
  );
}

function SmallEvent({ event, now, onPress }: { event: FlowEvent; now: number; onPress?: () => void }) {
  const tone = TONE[event.type] ?? colors.muted;
  return (
    <Animated.View entering={FadeInDown.duration(220)} layout={Layout.duration(200)} style={styles.row} onTouchEnd={onPress}>
      {/* The stripe down the left edge is the whole colour of the card. Filling
          the card itself would turn a quiet feed into a traffic light. */}
      <View style={[styles.rowStripe, { backgroundColor: tone }]} />
      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={styles.rowAmount}>{event.amount != null ? compact(event.amount) : '—'}</Text>
        <Text style={styles.rowUnit}>SKR</Text>
        <Text numberOfLines={1} style={styles.rowWallet}>{who(event)}</Text>
        <Text style={[styles.rowKind, { color: tone }]}>{t(VERB[event.type] ?? event.type).toUpperCase()}</Text>
        <Text style={styles.rowTime}>{ago(event.blockTime, now)}</Text>
      </View>
    </Animated.View>
  );
}

export function FlowLab({ active }: { active: boolean }) {
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [big, setBig] = useState<FlowEvent | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  const [live, setLive] = useState(false);
  const [haptics, setHaptics] = usePref('buzz', true);
  const [sound, setSound] = usePref('sound', true);
  const [kind, setKind] = useState<KindKey>('all');
  const [minimum, setMinimum] = useState(0);
  const [receipt, setReceipt] = useState<FlowEvent | null>(null);
  const [day, setDay] = useState<EcosystemState['analytics']['windows'][string] | null>(null);
  const [headlines, setHeadlines] = useState<FlowEvent[]>([]);
  const headRail = useRef<ScrollView>(null);
  const headIndex = useRef(0);
  const headHeld = useRef(false);
  const { width } = useWindowDimensions();
  const headWidth = Math.min(width - spacing.lg * 2 - 24, 300);
  const [arrivals, setArrivals] = useState(0);
  const [openOlder, setOpenOlder] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const lastHaptic = useRef(0);
  const lastSurge = useRef(0);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => { appState.current = next; });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1_000)), 1_000);
    return () => clearInterval(timer);
  }, []);


  const pull = useCallback(async (fresh: boolean) => {
    // A phone in a pocket must not keep asking the server for news.
    if (!fresh && appState.current !== 'active') return;
    try {
      const items = await fetchEvents(minimum, 25);
      setLive(true);
      if (fresh) {
        seen.current = new Set(items.map((item) => item.id));
        setEvents(items.slice(0, FEED_LIMIT));
        return;
      }
      const arrived = items.filter((item) => item.id && !seen.current.has(item.id));
      if (arrived.length === 0) return;
      arrived.forEach((item) => seen.current.add(item.id));
      // Left open for an evening the screen would otherwise remember every
      // event it ever saw. Only the recent past can repeat inside one page of
      // the feed, so anything older than a few pages is safe to forget.
      if (seen.current.size > SEEN_LIMIT) {
        seen.current = new Set([...seen.current].slice(-FEED_LIMIT * 2));
      }
      setEvents((current) => [...arrived, ...current].slice(0, FEED_LIMIT));
      setArrivals((current) => current + arrived.length);
      // One tap per batch, never a machine-gun. A large move gets its own
      // answer: two firm knocks and the vault chime, so a person watching the
      // feed feels it land without having to read.
      const stamp = Date.now();
      if (appState.current !== 'active') return;
      const heavy = arrived.some((item) => (item.amount ?? 0) >= BIG_EVENT);

      // A large exit and a large stake are opposite news, so they no longer
      // share a bell: the exit lands as a tudum, the stake as the vault bell.
      // A labelled stake below that sings once, like a bird.
      const heavyExit = arrived.some((item) => (item.amount ?? 0) >= BIG_EVENT && (item.type === 'unstake' || item.type === 'withdraw'));
      const labelled = arrived.some((item) => (item.amount ?? 0) >= LABEL_EVENT && item.type === 'stake');
      if (heavy && stamp - lastSurge.current > SURGE_GAP_MS) {
        lastSurge.current = stamp;
        lastHaptic.current = stamp;
        if (haptics) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
          setTimeout(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined); }, 160);
        }
        if (sound) playCue(heavyExit ? 'tudum' : 'surge', 0.6);
      } else if (labelled && stamp - lastSurge.current > BIRD_GAP_MS) {
        lastSurge.current = stamp;
        if (haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        if (sound) playCue('bird', 0.35);
      } else if (haptics && stamp - lastHaptic.current > HAPTIC_GAP_MS) {
        lastHaptic.current = stamp;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }
    } catch {
      setLive(false);
    }
  }, [haptics, minimum, sound]);

  // The pinned block asks the server for large events only, so it is not
  // limited to whatever happens to be in the last page of the feed.
  const pullHeadline = useCallback(async () => {
    if (appState.current !== 'active') return;
    try {
      const items = await fetchEvents(HEADLINE_MINIMUM, 20);
      if (items.length === 0) return;
      const stamp = Math.floor(Date.now() / 1_000);
      const withinDay = items.filter((item) => stamp - item.blockTime <= DAY_SECONDS);
      const pool = withinDay.length > 0 ? withinDay : items;
      setBig(pool.reduce((peak, item) => ((item.amount ?? 0) > (peak.amount ?? 0) ? item : peak)));
      const best = (type: string) => pool.filter((item) => item.type === type).reduce<FlowEvent | null>((peak, item) => (!peak || (item.amount ?? 0) > (peak.amount ?? 0) ? item : peak), null);
      setHeadlines([best('stake'), best('unstake'), best('withdraw')].filter((item): item is FlowEvent => Boolean(item)));
    } catch {
      // The pinned block keeps its last honest answer.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void pull(true);
    const timer = setInterval(() => void pull(false), POLL_MS);
    return () => clearInterval(timer);
  }, [active, pull]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const readDay = () => fetchEcosystemState().then((state) => { if (alive) setDay(state.analytics?.windows?.['24h'] ?? null); }).catch(() => undefined);
    void readDay();
    const dayTimer = setInterval(() => { if (AppState.currentState === 'active') void readDay(); }, 300_000);
    return () => { alive = false; clearInterval(dayTimer); };
  }, [active]);

  // The headline cards turn themselves over, like the facts on the vault.
  useEffect(() => {
    if (!active || headlines.length < 1) return;
    const timer = setInterval(() => {
      if (headHeld.current || AppState.currentState !== 'active') return;
      headIndex.current = (headIndex.current + 1) % (headlines.length + 1);
      headRail.current?.scrollTo({ x: headIndex.current * (headWidth + spacing.md), animated: true });
    }, 3_600);
    return () => clearInterval(timer);
  }, [active, headlines.length, headWidth]);

  useEffect(() => {
    if (!active) return;
    void pullHeadline();
    const timer = setInterval(() => void pullHeadline(), HEADLINE_POLL_MS);
    return () => clearInterval(timer);
  }, [active, pullHeadline]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <View style={styles.headCopy}>
          <Eyebrow tone={live ? colors.positive : colors.pending}>{live ? t('Live from the vault') : t('Reconnecting')}</Eyebrow>
          <Text style={styles.title}>{arrivals > 0 ? t('{count} landed while you watched', { count: arrivals }) : t('Watching the chain')}</Text>
        </View>
        <View style={styles.headSwitches}>
          <Pressable accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => { void Haptics.selectionAsync(); setHaptics(!haptics); }} style={styles.hapticToggle}>
            <Text style={[styles.hapticLabel, haptics && styles.hapticOn]}>{haptics ? t('BUZZ ON') : t('BUZZ OFF')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => { void Haptics.selectionAsync(); const next = !sound; setSound(next); if (next) playCue('surge', 0.6); }}
            style={styles.hapticToggle}
          >
            <Text style={[styles.hapticLabel, sound && styles.hapticOn]}>{sound ? t('SOUND ON') : t('SOUND OFF')}</Text>
          </Pressable>
        </View>
      </View>

      {big ? (
        <ScrollView
          ref={headRail}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={headWidth + spacing.md}
          decelerationRate="fast"
          onScrollBeginDrag={() => { headHeld.current = true; }}
          contentContainerStyle={styles.headRail}
          style={styles.headRailWrap}
        >
          <View style={{ width: headWidth }}><Headline event={big} now={now} /></View>
          {headlines.map((item) => (
            <View key={item.id} style={{ width: headWidth }}><Headline event={item} now={now} title={item.type === 'stake' ? t('Biggest stake today') : item.type === 'unstake' ? t('Biggest exit today') : t('Biggest withdrawal today')} /></View>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.filters}>
        {KINDS.map((option) => {
          const on = option.key === kind;
          const total = day && option.key !== 'all' ? (option.key === 'stake' ? day.staked : option.key === 'unstake' ? day.unstaked : day.withdrawn) : null;
          const tone = option.key === 'stake' ? colors.positive : option.key === 'unstake' ? colors.negative : option.key === 'withdraw' ? colors.pending : colors.accent;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
              key={option.key}
              onPress={() => { void Haptics.selectionAsync(); setKind(option.key); }}
              style={[styles.chip, on && { borderColor: tone }]}
            >
              <Text numberOfLines={1} style={[styles.chipLabel, on && styles.chipLabelOn]}>{t(option.label)}</Text>
              {total != null ? <Text numberOfLines={1} style={[styles.chipTotal, { color: tone }]}>{compact(total)}</Text> : <Text style={styles.chipTotal}>{t('24h')}</Text>}
            </Pressable>
          );
        })}
      </View>

      {/* The size filter, exactly as it was: everything, a thousand and up,
          a hundred thousand and up. The chips above say what kind, this row
          says how big. */}
      <View style={styles.sizes}>
        {SIZES.map((option) => {
          const on = option.min === minimum;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              key={option.label}
              onPress={() => { void Haptics.selectionAsync(); setMinimum(option.min); }}
              style={[styles.filter, on && styles.filterOn]}
            >
              <Text style={[styles.filterLabel, on && styles.filterLabelOn]}>{option.label}</Text>
            </Pressable>
          );
        })}
        <Text style={styles.filterNote}>{minimum > 0 ? t('only {amount} SKR and up', { amount: compact(minimum) }) : t('everything, dust included')}</Text>
      </View>

      {receipt ? (
        <Panel style={styles.receipt} tone={TONE[receipt.type] ?? colors.muted}>
          <View style={styles.cardTop}>
            <Eyebrow tone={TONE[receipt.type] ?? colors.muted}>{t('Receipt')}</Eyebrow>
            <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setReceipt(null)}><Text style={styles.close}>×</Text></Pressable>
          </View>
          <Text style={styles.receiptTitle}>{receipt.amount != null ? compact(receipt.amount) : '—'} SKR {t(VERB[receipt.type] ?? receipt.type)}</Text>
          <Text style={styles.wallet}>{who(receipt)}</Text>
          <Text style={styles.receiptMono}>{`signature  ${shortAddress(receipt.signature)}\nslot       ${receipt.slot.toLocaleString('en-US')}\nblock time ${new Date(receipt.blockTime * 1000).toLocaleString()}\ncommitment finalized`}</Text>
          <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(`https://solscan.io/tx/${receipt.signature}`)} style={styles.receiptLink}>
            <Text style={styles.receiptLinkText}>{t('Open on Solscan')}</Text>
          </Pressable>
        </Panel>
      ) : null}

      {events.length === 0 ? (
        <Panel style={styles.empty}>
          <Text style={styles.emptyText}>{t('Waiting for the next finalized event of this size.')}</Text>
        </Panel>
      ) : null}

      <View style={styles.feed}>
        {(() => {
          const bigIds = events.filter((event) => (kind === 'all' || event.type === kind) && (event.amount ?? 0) >= BIG_EVENT).map((event) => event.id);
          const foldedIds = new Set(bigIds.slice(BIG_CARDS_OPEN));
          const foldedTotal = events
            .filter((event) => foldedIds.has(event.id))
            .reduce((sum, event) => sum + (event.amount ?? 0), 0);
          let foldRendered = false;
          const nodes: React.ReactNode[] = [];

          for (const event of events) {
            if (kind !== 'all' && event.type !== kind) continue;
            const isBig = (event.amount ?? 0) >= BIG_EVENT;
            if (isBig && foldedIds.has(event.id) && !openOlder) {
              if (!foldRendered) {
                foldRendered = true;
                nodes.push(
                  <FoldedBig
                    key="folded"
                    count={foldedIds.size}
                    total={foldedTotal}
                    expanded={false}
                    onPress={() => { void Haptics.selectionAsync(); setOpenOlder(true); }}
                  />,
                );
              }
              continue;
            }
            nodes.push(isBig
              ? <BigEvent key={event.id} event={event} now={now} onPress={() => { void Haptics.selectionAsync(); setReceipt(event); }} />
              : <SmallEvent key={event.id} event={event} now={now} onPress={() => { void Haptics.selectionAsync(); setReceipt(event); }} />);
          }

          if (openOlder && foldedIds.size > 0) {
            nodes.push(
              <FoldedBig
                key="folded-close"
                count={foldedIds.size}
                total={foldedTotal}
                expanded
                onPress={() => { void Haptics.selectionAsync(); setOpenOlder(false); }}
              />,
            );
          }
          return nodes;
        })()}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 130, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  headCopy: { flex: 1 },
  title: { color: colors.text, fontFamily: font.semibold, fontSize: 17, marginTop: spacing.xs },
  headSwitches: { alignItems: 'flex-end', gap: spacing.xs },
  hapticToggle: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5 },
  hapticLabel: { color: colors.faint, fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.8 },
  hapticOn: { color: colors.accent },
  headline: { padding: spacing.md, gap: spacing.sm },
  headlineTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headlineTime: { color: colors.muted, fontFamily: font.regular, ...type.micro },
  headlineRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  headlineAmount: { color: colors.text, fontFamily: font.black, fontVariant: ['tabular-nums'], fontSize: 30, letterSpacing: -1 },
  headlineUnit: { color: colors.muted, fontFamily: font.semibold, fontSize: 12 },
  headlineKind: { marginLeft: 'auto', fontFamily: font.bold, fontSize: 11, letterSpacing: 1 },
  headlineFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sizes: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  receipt: { padding: spacing.md, gap: spacing.xs },
  close: { color: colors.faint, fontSize: 20, lineHeight: 22 },
  receiptTitle: { color: colors.text, fontFamily: font.bold, fontSize: 18 },
  receiptMono: { color: colors.muted, fontFamily: font.mono, ...type.micro, marginTop: spacing.xs },
  receiptLink: { marginTop: spacing.sm, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  receiptLinkText: { color: colors.text, fontFamily: font.semibold, fontSize: 12 },
  headRailWrap: { marginHorizontal: -spacing.lg },
  headRail: { gap: spacing.md, paddingHorizontal: spacing.lg },
  filters: { flexDirection: 'row', alignItems: 'stretch', gap: 6 },
  chip: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.panel, paddingHorizontal: 8, paddingVertical: 6, minWidth: 0 },
  chipBig: { flex: 0, minWidth: 54 },
  chipLabel: { color: colors.muted, fontFamily: font.bold, fontSize: 10.5, letterSpacing: 0 },
  chipLabelOn: { color: colors.text },
  chipTotal: { color: colors.faint, fontFamily: font.mono, fontSize: 9.5, marginTop: 2 },
  filter: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  filterOn: { borderColor: colors.accentDim, backgroundColor: colors.panelHi },
  filterLabel: { color: colors.faint, fontFamily: font.semibold, fontSize: 11.5, letterSpacing: 0.6 },
  filterLabelOn: { color: colors.accent },
  filterNote: { marginLeft: 'auto', color: colors.faint, fontFamily: font.regular, ...type.micro },
  feed: { gap: spacing.sm },
  card: { padding: spacing.md, gap: spacing.sm, marginVertical: spacing.xs },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1 },
  time: { color: colors.faint, fontFamily: font.regular, ...type.micro },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  amount: { color: colors.text, fontFamily: font.bold, fontVariant: ['tabular-nums'], fontSize: 26, letterSpacing: -0.8 },
  unit: { color: colors.muted, fontFamily: font.medium, fontSize: 12 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wallet: { fontFamily: font.semibold, fontSize: 13.5, ...gold },
  slot: { color: colors.faint, fontFamily: font.mono, ...type.micro },
  row: { flexDirection: 'row', backgroundColor: colors.panel, borderRadius: radius.inner, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', marginBottom: 5 },
  rowStripe: { width: 3 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 5, paddingVertical: 8, paddingHorizontal: spacing.md },
  rowAmount: { color: colors.text, fontFamily: font.bold, fontSize: 15, fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  rowUnit: { color: colors.muted, fontFamily: font.medium, fontSize: 10.5 },
  rowKind: { fontFamily: font.bold, fontSize: 9.5, letterSpacing: 0.8 },
  rowWallet: { flex: 1, fontFamily: font.semibold, fontSize: 12.5, marginLeft: 4, ...gold },
  rowTime: { width: 38, textAlign: 'right', color: colors.faint, fontFamily: font.regular, ...type.micro },
  folded: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.card, backgroundColor: colors.panel, marginVertical: spacing.xs },
  foldedPressed: { opacity: 0.85 },
  foldedMark: { width: 3, height: 18, borderRadius: 2, backgroundColor: colors.metal },
  foldedText: { color: colors.text, fontFamily: font.semibold, fontSize: 13 },
  foldedTotal: { marginLeft: 'auto', color: colors.muted, fontFamily: font.semibold, fontSize: 13, fontVariant: ['tabular-nums'] },
  foldedChevron: { color: colors.accent, fontFamily: font.bold, fontSize: 16, width: 16, textAlign: 'center' },
  empty: { padding: spacing.lg },
  emptyText: { color: colors.muted, fontFamily: font.regular, ...type.body },
});
