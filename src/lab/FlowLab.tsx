import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { API_BASE_URL, fetchEcosystemState } from '../api';
import type { EcosystemState } from '../types';
import { t } from '../i18n';
import { useReducedMotion } from '../useReducedMotion';
import { compact, shortAddress } from '../format';
import { usePref } from '../prefs';
import { playCue } from '../sound';
import { Carousel } from './Carousel';
import { colors, font, gold, numeric, radius, spacing, type } from '../theme';
import { Button, Eyebrow, Inset, Panel } from './kit';

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
const STICKY_SECONDS = 15 * 60;
// How many event ids the screen keeps in mind before it starts forgetting.
const SEEN_LIMIT = 600;
const HAPTIC_GAP_MS = 260;
// A large move announces itself, but never more than once every few seconds,
// however busy the chain gets.
const SURGE_GAP_MS = 6_000;
// Whole SKR on purpose: the server parses `min` as an integer and refuses a
// fraction, so a threshold like 0.5 would silently return nothing.
const BIG_EVENT = 100_000;
// From here up a stake earns a label in the vault and its own sound in the feed.
const LABEL_EVENT = 1_000;
const STAKE_GAP_MS = 4_000;
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

// `type` asks the server for one kind only. Exits are a few dozen a day among
// thousands of one-SKR stakes, so filtering the last page on the phone found
// none of them and the chip looked broken.
async function fetchEvents(minimum: number, limit: number, type?: string): Promise<FlowEvent[]> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), EVENTS_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/api/events?limit=${limit}&min=${minimum}${type ? `&type=${type}` : ''}`, { headers: { accept: 'application/json' }, signal: controller.signal });
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

// A large move, drawn once.
//
// The pinned block and a large move in the feed were the same card written out
// twice: the same top row, the same figure, the same foot, and eight pairs of
// near-identical styles behind them. `pinned` is the only real difference —
// the pinned one names which record it is holding and sits still inside the
// carousel, the feed one arrives with the motion of the feed and opens a
// receipt when it is touched.
//
// The tone stays, on both: a coloured edge on a panel means "this one is
// putting its hand up", and a move that is a stake, an exit or a withdrawal is
// exactly that — the state is the event.
function EventCard({ event, now, pinned = false, title, onPress }: { event: FlowEvent; now: number; pinned?: boolean; title?: string; onPress?: () => void }) {
  const tone = TONE[event.type] ?? colors.muted;
  const verb = t(VERB[event.type] ?? event.type).toUpperCase();
  const card = (
    <Panel style={[styles.card, pinned && styles.cardPinned]} tone={tone}>
      <View style={styles.cardTop}>
        {pinned
          ? <Eyebrow tone={tone}>{title ?? (now - event.blockTime <= DAY_SECONDS ? t('Biggest seen today') : t('Last big move'))}</Eyebrow>
          : <Text style={[styles.kind, { color: tone }]}>{verb}</Text>}
        <Text style={styles.time}>{t('{age} ago', { age: ago(event.blockTime, now) })}</Text>
      </View>
      <View style={styles.amountRow}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.amount, pinned && styles.amountPinned]}>
          {event.amount != null ? compact(event.amount) : pinned ? '—' : t('amount unavailable')}
        </Text>
        {pinned || event.amount != null ? <Text style={styles.unit}>SKR</Text> : null}
        {pinned ? <Text style={[styles.kind, styles.kindTail, { color: tone }]}>{verb}</Text> : null}
      </View>
      <View style={styles.cardFoot}>
        <Text numberOfLines={1} style={styles.wallet}>{who(event)}</Text>
        <Text style={styles.slot}>{t('slot {slot}', { slot: event.slot.toLocaleString('en-US') })}</Text>
      </View>
    </Panel>
  );
  if (pinned) return card;
  return <Animated.View entering={FadeInDown.duration(280)} layout={Layout.duration(220)} onTouchEnd={onPress}>{card}</Animated.View>;
}

function FoldedBig({ count, total, expanded, onPress }: { count: number; total: number; expanded: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.foldedWrap, pressed && styles.foldedPressed]}>
      <Panel style={styles.folded}>
        <View style={styles.foldedMark} />
        <Text style={styles.foldedText}>
          {expanded ? t('Fold the older large moves') : count === 1 ? t('1 more large move') : t('{count} more large moves', { count })}
        </Text>
        <Text style={styles.foldedTotal}>{expanded ? '' : `${compact(total)} SKR`}</Text>
        <Text style={styles.foldedChevron}>{expanded ? '×' : '+'}</Text>
      </Panel>
    </Pressable>
  );
}

// Dust, which is nearly all of the traffic.
//
// This was five texts on one baseline with five points between them: the
// figure, SKR, the name, the verb and the age. On a 360-wide phone — and
// sooner than that at a large system font — the name and the verb are the two
// that give, so the two things a person actually reads were the first to be
// squeezed. Two lines now: the number and when, then who and what. Nothing
// competes for the same space, and nothing here is below 11 px.
function SmallEvent({ event, now, onPress }: { event: FlowEvent; now: number; onPress?: () => void }) {
  const tone = TONE[event.type] ?? colors.muted;
  return (
    <Animated.View entering={FadeInDown.duration(220)} layout={Layout.duration(200)} style={styles.row} onTouchEnd={onPress}>
      {/* The stripe down the left edge is the whole colour of the card. Filling
          the card itself would turn a quiet feed into a traffic light. */}
      <View style={[styles.rowStripe, { backgroundColor: tone }]} />
      <View style={styles.rowBody}>
        <View style={styles.rowLine}>
          <Text numberOfLines={1} style={styles.rowAmount}>{event.amount != null ? compact(event.amount) : '—'}</Text>
          <Text style={styles.rowUnit}>SKR</Text>
          <Text style={styles.rowTime}>{ago(event.blockTime, now)}</Text>
        </View>
        <View style={styles.rowLine}>
          <Text numberOfLines={1} style={styles.rowWallet}>{who(event)}</Text>
          <Text style={[styles.rowKind, { color: tone }]}>{t(VERB[event.type] ?? event.type).toUpperCase()}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

export function FlowLab({ active }: { active: boolean }) {
  const reducedMotion = useReducedMotion();
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
  const { width } = useWindowDimensions();
  const headWidth = width - spacing.lg * 2;
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


  const generation = useRef(0);
  const inFlight = useRef(false);
  const pull = useCallback(async (fresh: boolean) => {
    // A phone in a pocket must not keep asking the server for news.
    if (!fresh && appState.current !== 'active') return;
    // An answer for a filter the person has since left is thrown away, or a
    // slow page of dust would land under a chip that promised none.
    const ticket = generation.current;
    if (inFlight.current && !fresh) return;
    inFlight.current = true;
    try {
      const items = await fetchEvents(minimum, 25, kind === 'all' ? undefined : kind);
      if (ticket !== generation.current) return;
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
      // Forty-odd moves a minute, nearly all of them dust, used to push a
      // large move off the bottom of the list within two minutes. A large move
      // now keeps its place for a quarter of an hour, in order, past the cap.
      setEvents((current) => {
        const merged = [...arrived, ...current];
        const floor = Math.floor(Date.now() / 1_000) - STICKY_SECONDS;
        return merged.filter((item, index) => index < FEED_LIMIT || ((item.amount ?? 0) >= BIG_EVENT && item.blockTime >= floor));
      });
      setArrivals((current) => current + arrived.length);
      // One tap per batch, never a machine-gun. A large move gets its own
      // answer: two firm knocks and the vault chime, so a person watching the
      // feed feels it land without having to read.
      const stamp = Date.now();
      if (appState.current !== 'active') return;
      // The sounds for these moves come from the app itself now (src/lab/cues.ts),
      // so they are heard on any tab. The feed keeps only its light tap.
      if (haptics && stamp - lastHaptic.current > HAPTIC_GAP_MS) {
        lastHaptic.current = stamp;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }
    } catch {
      if (ticket === generation.current) setLive(false);
    } finally {
      inFlight.current = false;
    }
  }, [haptics, kind, minimum]);

  // The pinned block asks the server for large events only, so it is not
  // limited to whatever happens to be in the last page of the feed.
  const pullHeadline = useCallback(async () => {
    if (appState.current !== 'active') return;
    try {
      // Two hundred is the server's page limit; a busy day has a hundred-odd
      // moves this size, so the whole day fits and the peak is the day's peak.
      const items = await fetchEvents(HEADLINE_MINIMUM, 200);
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
    generation.current += 1;
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
        {/* Two settings, not two filters. They used to be bordered pills, the
            same shape as the kind chips three lines below them, so the eye read
            five controls of one family where there are two families. A setting
            loses the box and keeps a light: the dot is lit when it is on. */}
        <View style={styles.headSwitches}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: haptics }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => { void Haptics.selectionAsync(); setHaptics(!haptics); }} style={styles.toggle}>
            <View style={[styles.toggleDot, haptics && styles.toggleDotOn]} />
            <Text style={[styles.toggleLabel, haptics && styles.toggleLabelOn]}>{haptics ? t('BUZZ ON') : t('BUZZ OFF')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: sound }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => { void Haptics.selectionAsync(); const next = !sound; setSound(next); if (next) playCue('surge', 0.6); }}
            style={styles.toggle}
          >
            <View style={[styles.toggleDot, sound && styles.toggleDotOn]} />
            <Text style={[styles.toggleLabel, sound && styles.toggleLabelOn]}>{sound ? t('SOUND ON') : t('SOUND OFF')}</Text>
          </Pressable>
        </View>
      </View>

      {big ? (
        <Carousel width={headWidth} auto={!reducedMotion}>
          <EventCard event={big} now={now} pinned />
          {headlines.filter((item) => item.id !== big.id).map((item) => (
            <EventCard key={item.id} event={item} now={now} pinned title={item.type === 'stake' ? t('Biggest stake today') : item.type === 'unstake' ? t('Biggest exit today') : t('Biggest withdrawal today')} />
          ))}
        </Carousel>
      ) : null}

      {/* Four kinds of move, and the day's total under each. The colour of a
          kind used to sit permanently on its number, so four state colours were
          burning at the top of the screen before anything had happened. The
          number is the day's shape; the colour now appears only on the chip
          that is chosen, as the edge of a panel putting its hand up. */}
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
              style={styles.chipWrap}
            >
              <Panel style={styles.chip} tone={on ? tone : undefined}>
                <Text numberOfLines={1} style={[styles.chipLabel, on && styles.chipLabelOn]}>{t(option.label)}</Text>
                <Text numberOfLines={1} style={styles.chipTotal}>{total != null ? compact(total) : t('24h')}</Text>
              </Panel>
            </Pressable>
          );
        })}
      </View>

      {receipt ? (
        <Panel style={styles.receipt} tone={TONE[receipt.type] ?? colors.muted}>
          <View style={styles.cardTop}>
            <Eyebrow tone={TONE[receipt.type] ?? colors.muted}>{t('Receipt')}</Eyebrow>
            <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setReceipt(null)}><Text style={styles.close}>×</Text></Pressable>
          </View>
          <Text style={styles.receiptTitle}>{receipt.amount != null ? compact(receipt.amount) : '—'} SKR {t(VERB[receipt.type] ?? receipt.type)}</Text>
          <Text style={styles.wallet}>{who(receipt)}</Text>
          {/* The chain's own words, recessed into the receipt rather than drawn
              as a second panel inside the first. */}
          <Inset style={styles.receiptProof}>
            <Text style={styles.receiptMono}>{`signature  ${shortAddress(receipt.signature)}\nslot       ${receipt.slot.toLocaleString('en-US')}\nblock time ${new Date(receipt.blockTime * 1000).toLocaleString()}\ncommitment finalized`}</Text>
          </Inset>
          <View style={styles.receiptAction}>
            <Button label={t('Open on Solscan')} ghost onPress={() => void Linking.openURL(`https://solscan.io/tx/${receipt.signature}`)} />
          </View>
        </Panel>
      ) : null}

      {/* How big, and what that leaves — one line, and the line the feed is
          already carrying. Three pills of the same build as the kind chips made
          a second row of buttons that said nothing about kind at all; a
          recessed switch beside the feed's own sentence says it is a setting of
          the feed below, not another filter above. */}
      <View style={styles.feedHead}>
        <Text style={styles.feedNote}>{minimum > 0 ? t('only {amount} SKR and up', { amount: compact(minimum) }) : t('everything, dust included')}</Text>
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
                style={[styles.size, on && styles.sizeOn]}
              >
                <Text style={[styles.sizeLabel, on && styles.sizeLabelOn]}>{t(option.label)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

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
              ? <EventCard key={event.id} event={event} now={now} onPress={() => { void Haptics.selectionAsync(); setReceipt(event); }} />
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
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 130, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  headCopy: { flex: 1 },
  title: { color: colors.text, fontFamily: font.semibold, fontSize: 17, marginTop: spacing.xs },
  headSwitches: { alignItems: 'flex-end', gap: 6 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
  toggleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dim },
  toggleDotOn: { backgroundColor: colors.accent },
  toggleLabel: { color: colors.muted, fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.8 },
  toggleLabelOn: { color: colors.text },
  receipt: { padding: spacing.md, gap: spacing.xs },
  close: { color: colors.muted, fontSize: 20, lineHeight: 22 },
  receiptTitle: { color: colors.text, fontFamily: font.bold, fontSize: 18 },
  receiptProof: { marginTop: spacing.sm },
  receiptMono: { color: colors.muted, fontFamily: font.mono, ...type.micro },
  receiptAction: { alignSelf: 'flex-start', marginTop: spacing.xs },
  filters: { flexDirection: 'row', alignItems: 'stretch', gap: 6 },
  chipWrap: { flex: 1, minWidth: 0 },
  // A chip is pressed, so it keeps the button radius rather than the card's.
  chip: { flex: 1, borderRadius: radius.button, paddingHorizontal: 6, paddingVertical: 7, minWidth: 0 },
  chipLabel: { color: colors.muted, fontFamily: font.bold, fontSize: 11.5 },
  chipLabelOn: { color: colors.text },
  chipTotal: { color: colors.muted, fontFamily: font.mono, fontSize: 11, marginTop: 2, ...numeric },
  feedHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  feedNote: { flex: 1, color: colors.muted, fontFamily: font.regular, ...type.micro },
  sizes: { flexDirection: 'row', gap: 2, backgroundColor: colors.inset, borderRadius: radius.pill, padding: 3 },
  size: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  sizeOn: { backgroundColor: colors.accentWash },
  sizeLabel: { color: colors.muted, fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.4 },
  sizeLabelOn: { color: colors.accent },
  feed: { gap: spacing.sm },
  card: { padding: spacing.md, gap: spacing.sm, marginVertical: spacing.xs },
  cardPinned: { marginVertical: 0 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1 },
  kindTail: { marginLeft: 'auto' },
  time: { color: colors.muted, fontFamily: font.regular, ...type.micro },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  amount: { color: colors.text, fontFamily: font.bold, fontSize: 26, letterSpacing: -0.8, ...numeric },
  amountPinned: { fontFamily: font.black, fontSize: 30, letterSpacing: -1 },
  unit: { color: colors.muted, fontFamily: font.medium, fontSize: 12 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wallet: { fontFamily: font.semibold, fontSize: 13.5, ...gold },
  slot: { color: colors.muted, fontFamily: font.mono, ...type.micro },
  // The feed already puts eight points between its children; the row used to
  // add five of its own on top of that.
  row: { flexDirection: 'row', backgroundColor: colors.panel, borderRadius: radius.inner, overflow: 'hidden' },
  rowStripe: { width: 3 },
  rowBody: { flex: 1, gap: 1, paddingVertical: 7, paddingHorizontal: spacing.md },
  rowLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  rowAmount: { color: colors.text, fontFamily: font.bold, fontSize: 15, letterSpacing: -0.3, ...numeric },
  rowUnit: { color: colors.muted, fontFamily: font.medium, fontSize: 11 },
  rowKind: { marginLeft: 'auto', fontFamily: font.bold, fontSize: 11, letterSpacing: 0.8 },
  rowWallet: { flexShrink: 1, fontFamily: font.semibold, fontSize: 12.5, ...gold },
  rowTime: { marginLeft: 'auto', color: colors.muted, fontFamily: font.regular, ...type.micro },
  foldedWrap: { marginVertical: spacing.xs },
  folded: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  foldedPressed: { opacity: 0.85 },
  foldedMark: { width: 3, height: 18, borderRadius: 2, backgroundColor: colors.metal },
  foldedText: { color: colors.text, fontFamily: font.semibold, fontSize: 13, flexShrink: 1 },
  foldedTotal: { marginLeft: 'auto', color: colors.muted, fontFamily: font.semibold, fontSize: 13, ...numeric },
  foldedChevron: { color: colors.muted, fontFamily: font.bold, fontSize: 16, width: 16, textAlign: 'center' },
  empty: { padding: spacing.lg },
  emptyText: { color: colors.muted, fontFamily: font.regular, ...type.body },
});
