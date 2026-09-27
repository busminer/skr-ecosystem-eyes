import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { t } from '../i18n';
import { integer, shortAddress } from '../format';
import { prefValue } from '../prefs';
import { useReducedMotion } from '../useReducedMotion';
import { Button, Mark } from '../lab/kit';
import { colors, font, radius, spacing, type } from '../theme';
import { fetchEyeHealth, type EyePrices, type EyeStatus } from './api';
import { EYE_FINGER_ENABLED } from './config';
import { cooldownHours, leftAtPrice, rentOf, sol, usd } from './money';

// The Eye, explained before it is bought, by showing rather than telling.
//
// Five pages, one idea each, each with a picture that moves the way the
// thing itself will: the Eye opening with its number under it; the road every
// move walks (finger, wallet, network, Eye) lit one stop at a time with a
// line saying what happens at that stop; the eight-hour dial that a Blink
// lives on; the Iris, with one Eye climbing ring by ring toward the pupil as
// its streak grows. The last page is the person's own: what this wallet and
// this phone already have, what the next Eye's number is, what it costs to
// the lamport, where the price steps up, and the one button that starts it.
//
// It is shown once, the first time the Eyes tab is opened by someone without
// an Eye, and again whenever they ask ("How it works"). Every picture is
// still for a person who asked the phone for less motion.
//
// Nothing here is promised that the app does not do: the card does not grow
// new rings, so no page says it does; the streak moves the Eye on the Iris,
// and that is what the fourth page shows.

const PAGES = 5;

// The lids, as a number from 0 (shut) to 1 (open), moved on the JS thread in
// short bursts. The Mark draws its lids from that number; a burst is a third
// of a second, so the redraws cost nothing worth measuring.
function useLids(start: number) {
  const [value, setValue] = useState(start);
  const current = useRef(start);
  const raf = useRef<number | null>(null);
  const stop = useCallback(() => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);
  const run = useCallback((steps: Array<{ to: number; ms: number }>) => {
    stop();
    let index = 0;
    let from = current.current;
    let started = 0;
    const tick = (time: number) => {
      const step = steps[index];
      if (!step) { raf.current = null; return; }
      if (!started) started = time;
      const k = step.ms <= 0 ? 1 : Math.min(1, (time - started) / step.ms);
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const next = from + (step.to - from) * eased;
      current.current = next;
      setValue(next);
      if (k >= 1) { index += 1; from = step.to; started = 0; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [stop]);
  const set = useCallback((to: number) => { stop(); current.current = to; setValue(to); }, [stop]);
  useEffect(() => stop, [stop]);
  return { value, run, set };
}

// Shut fast, a beat, open a little slower: the way the Eye itself blinks.
const BLINK = [{ to: 0.02, ms: 120 }, { to: 0.02, ms: 60 }, { to: 1, ms: 190 }];

function buzz() {
  if (prefValue('buzz', true)) void Haptics.selectionAsync().catch(() => undefined);
}

// ---------------------------------------------------------------- pictures --

// Page one: the Eye opens, and its number comes up under it.
function EyeBirth({ active, reduced, serial, size }: { active: boolean; reduced: boolean; serial: string | null; size: number }) {
  const lids = useLids(reduced ? 1 : 0);
  const { run, set } = lids;
  useEffect(() => {
    if (reduced) { set(1); return; }
    if (!active) { set(0); return; }
    set(0);
    const first = setTimeout(() => run([{ to: 1, ms: 950 }]), 380);
    const loop = setInterval(() => run(BLINK), 4_200);
    return () => { clearTimeout(first); clearInterval(loop); };
  }, [active, reduced, run, set]);
  const half = size / 2;
  return (
    <View style={{ width: size, alignItems: 'center' }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          {[0.98, 0.8, 0.62].map((k, index) => (
            <Circle key={k} cx={half} cy={half} r={half * k - 1} fill="none" stroke={colors.line} strokeWidth={1} opacity={0.9 - index * 0.2} />
          ))}
          <Circle cx={half} cy={half} r={half * 0.62 - 1} fill="none" stroke={colors.accent} strokeWidth={1.2} opacity={0.18 + 0.4 * lids.value} />
        </Svg>
        <Mark size={size * 0.74} open={lids.value} />
      </View>
      <Text style={[styles.serial, { opacity: serial ? Math.max(0, (lids.value - 0.6) / 0.4) : 0 }]}>{serial ?? ' '}</Text>
    </View>
  );
}

// The four stops of every move, drawn small.
function RoadIcon({ name, tone, open }: { name: 'finger' | 'wallet' | 'network' | 'eye'; tone: string; open: number }) {
  if (name === 'eye') return <Mark size={34} tone={tone} open={open} />;
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      {name === 'finger' ? (
        <G fill="none" stroke={tone} strokeWidth={1.7} strokeLinecap="round">
          <Path d="M5.2 10.8a8 8 0 0 1 15.6 0" />
          <Path d="M8.2 21.2c-1-2-1.5-4.2-1.5-6.7a6.3 6.3 0 0 1 12.6 0c0 1.3-.1 2.5-.3 3.6" />
          <Path d="M11.1 23c-1.2-2.5-1.7-5-1.7-7.9a3.6 3.6 0 0 1 7.2 0c0 2.2-.3 4.2-1 6" />
          <Path d="M13 14.8c0 3.2.6 6 1.9 8.4" />
        </G>
      ) : name === 'wallet' ? (
        <G fill="none" stroke={tone} strokeWidth={1.7} strokeLinejoin="round">
          <Path d="M6 8.2 17.5 4.6l1.3 3.6" />
          <Rect x={3} y={8.2} width={20} height={13.6} rx={3} />
          <Path d="M23 12.6h-5.2a2.4 2.4 0 0 0 0 4.8H23" />
        </G>
      ) : (
        <G fill="none" stroke={tone} strokeWidth={1.7} strokeLinejoin="round">
          <Rect x={1.8} y={9.8} width={6.4} height={6.4} rx={1.5} />
          <Rect x={9.8} y={9.8} width={6.4} height={6.4} rx={1.5} />
          <Rect x={17.8} y={9.8} width={6.4} height={6.4} rx={1.5} />
          <Path d="M8.2 13h1.6M16.2 13h1.6" strokeLinecap="round" />
        </G>
      )}
    </Svg>
  );
}

const ROAD = ['finger', 'wallet', 'network', 'eye'] as const;

// Page two: the road. A light walks the four stops, and the line under them
// says what happens at the stop it is on.
function Road({ active, reduced, width, finger }: { active: boolean; reduced: boolean; width: number; finger: boolean }) {
  const stops = finger ? ROAD : ROAD.slice(1);
  const last = stops.length - 1;
  const [at, setAt] = useState(reduced ? last : -1);
  const lids = useLids(reduced ? 1 : 0.06);
  const { run, set } = lids;
  useEffect(() => {
    if (reduced) { setAt(last); set(1); return; }
    if (!active) { setAt(-1); set(0.06); return; }
    let step = -1;
    setAt(-1);
    set(0.06);
    const timer = setInterval(() => {
      step = step >= last + 2 ? -1 : step + 1;
      if (step === -1) set(0.06);
      if (step === last) run([{ to: 1, ms: 700 }]);
      setAt(Math.min(step, last));
    }, 950);
    return () => clearInterval(timer);
  }, [active, reduced, last, run, set]);

  const captions: Record<(typeof ROAD)[number], string> = {
    finger: t('Your fingerprint signs'),
    wallet: t('Your wallet approves and pays'),
    network: t('The network writes it down'),
    eye: t('Your Eye opens'),
  };
  const labels: Record<(typeof ROAD)[number], string> = { finger: t('Finger'), wallet: t('Wallet'), network: t('Network'), eye: t('Eye') };
  const node = Math.min(64, Math.floor((width - spacing.lg * 2) / (stops.length + 0.9)));
  return (
    <View style={{ width: width - spacing.lg * 2, alignItems: 'center', gap: spacing.lg }}>
      <View style={styles.road}>
        {stops.map((name, index) => {
          const done = at > index;
          const here = at === index;
          const tone = here ? colors.accent : done ? colors.positive : colors.dim;
          return (
            <View key={name} style={styles.roadStop}>
              <View style={styles.roadRow}>
                {index > 0 ? <View style={[styles.roadLine, { backgroundColor: at >= index ? colors.positive : colors.line }]} /> : <View style={styles.roadLineGap} />}
                <View style={[styles.roadNode, { width: node, height: node, borderRadius: node / 2, borderColor: tone, backgroundColor: here ? 'rgba(86, 224, 255, 0.10)' : colors.inset }]}>
                  <RoadIcon name={name} tone={tone} open={name === 'eye' ? lids.value : 1} />
                </View>
                {index < last ? <View style={[styles.roadLine, { backgroundColor: at > index ? colors.positive : colors.line }]} /> : <View style={styles.roadLineGap} />}
              </View>
              <Text numberOfLines={1} style={[styles.roadLabel, { color: here ? colors.text : done ? colors.positive : colors.faint }]}>{labels[name]}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.roadCaption}>{at >= 0 && stops[at] ? captions[stops[at]] : ' '}</Text>
    </View>
  );
}

// An arc of the dial, from one angle to another, in degrees clockwise from
// twelve o'clock.
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy + r * Math.sin(rad)).toFixed(2)}`;
  };
  const large = to - from > 180 ? 1 : 0;
  return `M ${point(from)} A ${r} ${r} 0 ${large} 1 ${point(to)}`;
}

// Page three: the day as a dial of three eight-hour stretches. A hand walks
// round; at the end of each stretch the Eye in the middle blinks and the next
// stretch lights.
function BlinkDial({ active, reduced, size, slots }: { active: boolean; reduced: boolean; size: number; slots: number }) {
  const lids = useLids(1);
  const { run, set } = lids;
  const [slot, setSlot] = useState(0);
  const turn = useSharedValue(0);
  const per = 360 / slots;
  useEffect(() => {
    set(1);
    setSlot(0);
    turn.value = 0;
    if (reduced || !active) return;
    let ticks = 0;
    const SLOT_MS = 1_700;
    turn.value = withTiming(per, { duration: SLOT_MS, easing: Easing.linear });
    const timer = setInterval(() => {
      ticks += 1;
      run(BLINK);
      setSlot(ticks % slots);
      turn.value = withTiming((ticks + 1) * per, { duration: SLOT_MS, easing: Easing.linear });
    }, SLOT_MS);
    return () => clearInterval(timer);
  }, [active, reduced, per, slots, run, set, turn]);
  const hand = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const half = size / 2;
  const r = half - 10;
  const gap = 7;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={half} cy={half} r={r - 14} fill="none" stroke={colors.line} strokeWidth={1} />
        {Array.from({ length: slots }, (_, index) => (
          <Path
            key={index}
            d={arc(half, half, r, index * per + gap / 2, (index + 1) * per - gap / 2)}
            fill="none"
            stroke={index === slot ? colors.accent : colors.line}
            strokeWidth={index === slot ? 7 : 5}
            strokeLinecap="round"
          />
        ))}
      </Svg>
      {reduced ? null : (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, hand]}>
          <View style={[styles.handDot, { left: half - 5, top: 10 - 5 }]} />
        </Animated.View>
      )}
      <Mark size={size * 0.46} open={lids.value} />
    </View>
  );
}

// The Iris's ring thresholds, outermost first: the streak an Eye needs to
// stand on each ring (src/iris.mjs in the service). Ring 0 is Perfect.
const RING_STREAK = [30, 21, 14, 10, 7, 5, 3, 2, 1];

// A handful of other Eyes on the rings, placed the same way every time.
function crowd(count: number) {
  let seed = 7;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length: count }, () => {
    const roll = next();
    const ring = roll < 0.34 ? 8 : roll < 0.55 ? 7 : roll < 0.7 ? 6 : roll < 0.8 ? 5 : roll < 0.88 ? 4 : roll < 0.93 ? 3 : roll < 0.96 ? 2 : roll < 0.985 ? 1 : 0;
    return { ring, angle: next() * 360, lit: next() < 0.55 };
  });
}

// Page four: the Iris, and one Eye climbing it. Every day in a row moves it
// a ring closer to the pupil; at thirty it is Perfect, and gold.
function IrisClimb({ active, reduced, size }: { active: boolean; reduced: boolean; size: number }) {
  const half = size / 2;
  const pupil = size * 0.13;
  const outer = half - 4;
  const step = (outer - pupil) / 9;
  const radius = (ring: number) => pupil + (ring + 0.5) * step;
  const angle = -38;
  const at = (ring: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: half + radius(ring) * Math.cos(rad), y: half + radius(ring) * Math.sin(rad) };
  };
  const others = useMemo(() => crowd(46), []);
  const [ring, setRing] = useState(reduced ? 0 : 8);
  const x = useSharedValue(at(reduced ? 0 : 8).x);
  const y = useSharedValue(at(reduced ? 0 : 8).y);
  useEffect(() => {
    const place = (next: number, ms: number) => {
      setRing(next);
      const point = at(next);
      x.value = ms ? withTiming(point.x, { duration: ms, easing: Easing.out(Easing.cubic) }) : point.x;
      y.value = ms ? withTiming(point.y, { duration: ms, easing: Easing.out(Easing.cubic) }) : point.y;
    };
    if (reduced) { place(0, 0); return; }
    place(8, 0);
    if (!active) return;
    let current = 8;
    let hold = 0;
    const timer = setInterval(() => {
      if (current === 0) {
        hold += 1;
        if (hold < 3) return;
        hold = 0;
        current = 8;
        place(8, 0);
        return;
      }
      current -= 1;
      place(current, 420);
    }, 760);
    return () => clearInterval(timer);
    // `at` is derived from size alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduced, size, x, y]);
  const dot = useAnimatedStyle(() => ({ transform: [{ translateX: x.value - 7 }, { translateY: y.value - 7 }] }));
  const perfect = ring === 0;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={half} cy={half} r={outer} fill="#060B10" />
        <Circle cx={half} cy={half} r={pupil + step} fill="rgba(201, 169, 106, 0.10)" />
        {Array.from({ length: 10 }, (_, index) => (
          <Circle key={index} cx={half} cy={half} r={pupil + index * step} fill="none" stroke={index === 1 ? 'rgba(201, 169, 106, 0.45)' : colors.line} strokeWidth={1} />
        ))}
        {others.map((eye, index) => {
          const rad = ((eye.angle - 90) * Math.PI) / 180;
          const r = radius(eye.ring);
          return (
            <Circle
              key={index}
              cx={half + r * Math.cos(rad)}
              cy={half + r * Math.sin(rad)}
              r={2.6}
              fill={eye.ring === 0 ? colors.metal : eye.lit ? colors.positive : colors.dim}
              opacity={eye.lit ? 0.85 : 0.6}
            />
          );
        })}
        <Circle cx={half} cy={half} r={pupil} fill="#020304" stroke={colors.metal} strokeWidth={1.4} opacity={0.95} />
      </Svg>
      <Animated.View pointerEvents="none" style={[styles.youDot, { backgroundColor: perfect ? colors.metal : colors.accent, borderColor: perfect ? '#F6E2B3' : '#D8F8FF' }, dot]} />
      <View pointerEvents="none" style={[styles.youTag, { left: half + 6, top: 6 }]}>
        <Text style={[styles.youTagText, { color: perfect ? colors.metal : colors.accent }]}>
          {perfect ? t('Perfect Eye') : (RING_STREAK[ring] ?? 1) === 1 ? t('day 1') : t('{count} days in a row', { count: RING_STREAK[ring] ?? 1 })}
        </Text>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ ready --

function Check({ state, label, detail }: { state: 'yes' | 'no' | 'wait' | 'later'; label: string; detail?: string | null }) {
  const tone = state === 'yes' ? colors.positive : state === 'no' ? colors.negative : colors.faint;
  return (
    <View style={styles.check}>
      <View style={[styles.checkMark, { borderColor: tone, backgroundColor: state === 'yes' ? 'rgba(124, 240, 188, 0.12)' : 'transparent' }]}>
        {state === 'wait' ? <ActivityIndicator size="small" color={colors.faint} /> : (
          <Svg width={14} height={14} viewBox="0 0 14 14">
            {state === 'yes' ? <Path d="M3 7.4 5.8 10 11 4.2" fill="none" stroke={tone} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /> : null}
            {state === 'no' ? <Path d="M4 4l6 6M10 4l-6 6" fill="none" stroke={tone} strokeWidth={1.8} strokeLinecap="round" /> : null}
            {state === 'later' ? <Circle cx={7} cy={7} r={2} fill={tone} /> : null}
          </Svg>
        )}
      </View>
      <View style={styles.checkText}>
        <Text style={styles.checkLabel}>{label}</Text>
        {detail ? <Text style={styles.checkDetail}>{detail}</Text> : null}
      </View>
    </View>
  );
}

function Row({ label, value, strong = false, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.rowStrong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

// ------------------------------------------------------------------- pager --

export function EyeOnboarding({
  wallet,
  status,
  nextSerial,
  verified,
  connecting,
  connectError,
  onConnect,
  onOpen,
  onClose,
}: {
  wallet: string | null;
  status: EyeStatus | null;
  // The number the next Eye will carry, from the Iris's count; null while unknown.
  nextSerial: number | null;
  // Whether this phone has already been through the Seeker walk-through.
  verified: boolean;
  connecting: boolean;
  connectError: string | null;
  onConnect: () => void;
  // The last page's button: close this and start the open.
  onOpen: () => void;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  // Prices come with the wallet's status; before a wallet, from the service's health.
  const [health, setHealth] = useState<EyePrices | null>(null);
  useEffect(() => {
    let live = true;
    void fetchEyeHealth().then((answer) => { if (live && answer.prices) setHealth(answer.prices); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const prices: EyePrices | null = status?.prices ?? health;

  const go = useCallback((next: number) => {
    const target = Math.max(0, Math.min(PAGES - 1, next));
    pager.current?.scrollTo({ x: target * width, animated: !reduced });
    setPage(target);
    buzz();
  }, [width, reduced]);

  const onScrolled = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
    if (next !== page) { setPage(next); buzz(); }
  }, [width, page]);

  const art = Math.min(260, Math.round(width * 0.64));
  const serial = nextSerial != null ? `EYE #${String(nextSerial).padStart(4, '0')}` : null;
  const hours = cooldownHours(prices, status?.blink?.cooldownSeconds);
  const slots = Math.max(1, Math.round(24 / Math.max(1, hours)));
  const solUsd = prices?.solUsd ?? null;
  const blinkPrice = prices ? `${sol(prices.blinkLamports)} SOL${usd(prices.blinkLamports, solUsd) ? ` ≈ ${usd(prices.blinkLamports, solUsd)}` : ''}` : null;

  // The last page, worked out for this wallet.
  const gates = status?.gates ?? null;
  const hasEye = Boolean(status?.eye);
  const open = prices?.openLamports ?? null;
  const rent = rentOf(prices);
  const total = open != null ? open + rent : null;
  const left = leftAtPrice(prices, nextSerial);
  const tier = prices?.tier ?? null;
  const staked = gates?.staked;
  const blocked = Boolean(status && !hasEye && (gates?.staked === false || gates?.sgt === false));

  let action: { label: string; onPress?: () => void; disabled?: boolean };
  if (!wallet) action = { label: connecting ? t('Connecting…') : t('Connect Solana Mobile'), onPress: onConnect, disabled: connecting };
  else if (!status) action = { label: t('Reading your Eye…'), disabled: true };
  else if (hasEye) action = { label: t('See my Eye'), onPress: onClose };
  else if (gates?.staked === false) action = { label: t('Needs an active SKR position'), disabled: true };
  else if (gates?.sgt === false) action = { label: t('Needs a Seeker Genesis Token'), disabled: true };
  else action = { label: EYE_FINGER_ENABLED && !verified ? t('Verify my Seeker') : t('Open my Eye'), onPress: onOpen };

  const pages: Array<{ key: string; title: string; body: string; art: ReactElement }> = [
    {
      key: 'eye',
      title: t('This is your Eye'),
      body: t('One Eye per wallet, a collectible that lives on Solana. It is numbered in the order Eyes open, so an early number stays early for good.'),
      art: <EyeBirth active={page === 0} reduced={reduced} serial={serial} size={art} />,
    },
    {
      key: 'road',
      title: t('You open it yourself'),
      body: EYE_FINGER_ENABLED
        ? t('Four stops, each on screen as it happens: your fingerprint signs, your Seeker wallet approves and pays, the network writes it down, and the Eye opens.')
        : t('Three stops, each on screen as it happens: your Seeker wallet approves and pays, the network writes it down, and the Eye opens.'),
      art: <Road active={page === 1} reduced={reduced} width={width} finger={EYE_FINGER_ENABLED} />,
    },
    {
      key: 'blink',
      title: t('Blink every {hours} hours', { hours }),
      body: t('A Blink is a small record on Solana that you were here. The same road, one touch of the finger, and the Eye blinks.'),
      art: (
        <View style={styles.dialWrap}>
          <BlinkDial active={page === 2} reduced={reduced} size={Math.round(art * 0.86)} slots={slots} />
          {blinkPrice ? <Text style={styles.price}>{blinkPrice}</Text> : null}
          <Text style={styles.priceNote}>{t('per Blink, once every {hours} hours', { hours })}</Text>
        </View>
      ),
    },
    {
      key: 'iris',
      title: t('Your streak moves you in'),
      body: t('Every day with a Blink adds one to your streak, and your Eye moves a ring closer to the pupil of the Iris. At 30 days in a row it is a Perfect Eye. Miss a day and the streak starts again.'),
      art: <IrisClimb active={page === 3} reduced={reduced} size={Math.min(300, Math.round(width * 0.74))} />,
    },
  ];

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <View style={styles.bars}>
          {Array.from({ length: PAGES }, (_, index) => (
            <Pressable key={index} onPress={() => go(index)} style={styles.barHit} accessibilityRole="button" accessibilityLabel={`${index + 1} / ${PAGES}`}>
              <View style={[styles.bar, { backgroundColor: index <= page ? colors.accent : colors.line, opacity: index === page ? 1 : index < page ? 0.55 : 1 }]} />
            </Pressable>
          ))}
        </View>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
          <Text style={styles.skip}>{page < PAGES - 1 ? t('Skip') : t('Close')}</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrolled}
        style={styles.pager}
      >
        {pages.map((item) => (
          <ScrollView key={item.key} style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
            <View style={styles.art}>{item.art}</View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </ScrollView>
        ))}

        <ScrollView style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
          <View style={styles.readyHead}>
            <Mark size={44} open={hasEye ? 1 : 0.35} />
            <View style={{ flex: 1 }}>
              <Text style={styles.titleLeft}>{hasEye ? t('Your Eye is open') : t('Ready to open')}</Text>
              {serial && !hasEye ? <Text style={styles.serialLeft}>{t('Next: {serial}', { serial })}</Text> : null}
            </View>
          </View>

          <View style={styles.card}>
            <Check
              state={wallet ? 'yes' : 'later'}
              label={t('Wallet connected')}
              detail={wallet ? shortAddress(wallet) : t('Your Seeker wallet, read only; nothing is signed yet')}
            />
            <Check
              state={!wallet ? 'later' : !status ? 'wait' : gates?.sgt ? 'yes' : gates?.sgt === false ? 'no' : 'later'}
              label={t('Seeker Genesis Token')}
              detail={!wallet ? t('One Eye per Seeker') : gates?.sgt === false ? t('Not found in this wallet') : gates?.sgt ? t('Found in your wallet') : null}
            />
            <Check
              state={!wallet ? 'later' : !status ? 'wait' : staked ? 'yes' : staked === false ? 'no' : 'later'}
              label={t('Staked SKR')}
              detail={!wallet ? t('An active SKR position') : staked && gates?.activeStaked ? `${integer(Number(gates.activeStaked))} SKR` : staked === false ? t('No active SKR position') : null}
            />
            {EYE_FINGER_ENABLED ? (
              <Check
                state={verified ? 'yes' : 'later'}
                label={t('Fingerprint on this Seeker')}
                detail={verified ? t('Already verified on this phone.') : t('Checked in the next step')}
              />
            ) : null}
          </View>

          {open != null && total != null ? (
            <View style={styles.card}>
              <Row label={t('Opening')} value={`${sol(open)} SOL`} />
              <Row label={t('On-chain storage')} value={`≈ ${sol(rent)} SOL`} />
              <View style={styles.rule} />
              <Row label={t('Total')} value={`≈ ${sol(total)} SOL${usd(total, solUsd) ? ` · ${usd(total, solUsd)}` : ''}`} strong />
              {tier ? (
                <View style={styles.ladder}>
                  <View style={styles.rung}>
                    <View style={[styles.rungDot, { backgroundColor: colors.accent }]} />
                    <Text style={styles.rungText}>{t('Eyes #1 to #{last}', { last: integer(tier.serial) })}</Text>
                    <Text style={styles.rungPrice}>{`${sol(open)} SOL`}</Text>
                  </View>
                  {left != null ? <Text style={styles.rungNote}>{t('{count} left at this price', { count: integer(left) })}</Text> : null}
                  <View style={styles.rung}>
                    <View style={[styles.rungDot, { backgroundColor: colors.dim }]} />
                    <Text style={styles.rungText}>{t('From #{first}', { first: integer(tier.serial + 1) })}</Text>
                    <Text style={styles.rungPrice}>{`${sol(tier.afterLamports)} SOL`}</Text>
                  </View>
                </View>
              ) : null}
              {blinkPrice ? <Row label={t('Blink')} value={`${blinkPrice} · ${t('every {hours} hours', { hours })}`} /> : null}
            </View>
          ) : (
            <View style={styles.card}><ActivityIndicator size="small" color={colors.faint} /></View>
          )}

          <Text style={styles.fine}>{t('Fees go to the maker of SKR Eyes. No token is sold here.')}</Text>
          {connectError ? <Text style={styles.error}>{connectError}</Text> : null}
          {blocked ? <Text style={styles.fine}>{t('An Eye opens for a wallet on a Seeker with an active SKR position.')}</Text> : null}
        </ScrollView>
      </ScrollView>

      <View style={styles.bottom}>
        {page < PAGES - 1 ? (
          <Button label={t('Next')} onPress={() => go(page + 1)} hero />
        ) : (
          <Animated.View entering={reduced ? undefined : FadeIn.duration(200)} style={styles.bottomStack}>
            <Button label={action.label} onPress={action.onPress} disabled={action.disabled} hero />
            {!hasEye ? <Button label={t('Later')} onPress={onClose} quiet /> : null}
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  bars: { flex: 1, flexDirection: 'row', gap: 6 },
  barHit: { flex: 1, paddingVertical: 8 },
  bar: { height: 3, borderRadius: 2 },
  skip: { color: colors.muted, fontFamily: font.medium, ...type.small },
  pager: { flex: 1 },
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  art: { alignItems: 'center', justifyContent: 'center', minHeight: 300, marginBottom: spacing.sm },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.6, textAlign: 'center' },
  titleLeft: { color: colors.text, fontFamily: font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  body: { color: colors.muted, fontFamily: font.regular, ...type.body, textAlign: 'center', paddingHorizontal: spacing.sm },
  serial: { color: colors.metal, fontFamily: font.mono, fontSize: 15, letterSpacing: 1.6, marginTop: spacing.md },
  serialLeft: { color: colors.metal, fontFamily: font.mono, fontSize: 13, letterSpacing: 1.2, marginTop: 2 },
  road: { flexDirection: 'row', width: '100%' },
  roadStop: { flex: 1, alignItems: 'center', gap: spacing.sm },
  roadRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  roadLine: { flex: 1, height: 2, borderRadius: 1 },
  roadLineGap: { flex: 1 },
  roadNode: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  roadLabel: { fontFamily: font.semibold, ...type.micro, letterSpacing: 0.4 },
  roadCaption: { color: colors.text, fontFamily: font.semibold, fontSize: 16, lineHeight: 22, textAlign: 'center', minHeight: 22 },
  dialWrap: { alignItems: 'center', gap: spacing.xs },
  handDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: colors.text },
  price: { color: colors.text, fontFamily: font.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, marginTop: spacing.sm, fontVariant: ['tabular-nums'] },
  priceNote: { color: colors.faint, fontFamily: font.regular, ...type.small },
  youDot: { position: 'absolute', left: 0, top: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  youTag: { position: 'absolute' },
  youTagText: { fontFamily: font.semibold, ...type.small, fontVariant: ['tabular-nums'] },
  readyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  card: { backgroundColor: colors.panel, borderRadius: radius.card, borderWidth: 1, borderColor: '#111B24', padding: spacing.md, gap: spacing.md },
  check: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  checkMark: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkText: { flex: 1, gap: 2 },
  checkLabel: { color: colors.text, fontFamily: font.semibold, ...type.body },
  checkDetail: { color: colors.faint, fontFamily: font.regular, ...type.small, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  rowLabel: { color: colors.muted, fontFamily: font.regular, ...type.body },
  rowValue: { color: colors.text, fontFamily: font.medium, ...type.body, fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  rowStrong: { color: colors.text, fontFamily: font.bold },
  rule: { height: 1, backgroundColor: colors.line },
  ladder: { gap: 6, paddingTop: spacing.xs },
  rung: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rungDot: { width: 8, height: 8, borderRadius: 4 },
  rungText: { flex: 1, color: colors.muted, fontFamily: font.regular, ...type.small, fontVariant: ['tabular-nums'] },
  rungPrice: { color: colors.text, fontFamily: font.medium, ...type.small, fontVariant: ['tabular-nums'] },
  rungNote: { color: colors.accent, fontFamily: font.medium, ...type.micro, marginLeft: 16, fontVariant: ['tabular-nums'] },
  fine: { color: colors.faint, fontFamily: font.regular, ...type.small, textAlign: 'center', paddingHorizontal: spacing.sm },
  error: { color: colors.negative, fontFamily: font.medium, ...type.small, textAlign: 'center' },
  bottom: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderTopWidth: 1, borderTopColor: '#0C141C', backgroundColor: colors.bg },
  bottomStack: { gap: spacing.xs },
});
