import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { t } from '../i18n';
import { integer, shortAddress } from '../format';
import { prefValue } from '../prefs';
import { ritual, type Cue } from '../sound';
import { useReducedMotion } from '../useReducedMotion';
import { Button } from '../lab/kit';
import { colors, font, radius, spacing, type } from '../theme';
import { fetchEyeHealth, type EyePrices, type EyeStatus } from './api';
import { EYE_FINGER_ENABLED } from './config';
import { cooldownHours, leftAtPrice, rentOf, sol, usd } from './money';
import { PortalEye } from './PortalEye';

// The Eye, before it is bought: a small ritual rather than a tutorial.
//
// Night sky, the same as the NFT's (stars, a green-blue aurora low down, the
// sea catching it), and in the middle of every page the Eye itself, the
// portal cut from the collection card, alive: it wakes, it blinks, it waits.
// Five pages, one idea each, each told by the Eye doing the thing:
//
//   1. It wakes: two heartbeats, the lids part, its number rises under it.
//   2. It is opened by you: three lights round it, one per touch (finger,
//      wallet, network), each struck like glass, then the heartbeat and the
//      lids part. The line under it says what that light is.
//   3. It blinks every eight hours: a dial of three arcs round it, a hand
//      walking it, and at each arc's end the Eye blinks.
//   4. It is one of many: the Iris, every Eye a small eye on its ring, yours
//      stepping ring by ring to the pupil and turning gold at thirty days.
//   5. It is yours to open: what this wallet and this phone already have,
//      the number it will carry, the price to the lamport, the one button.
//
// Every action has its sound and its touch: a low fifth swells as a page
// arrives, glass for each light, two soft knocks before the lids part, the
// wake note as they do, the wink on a blink. Both follow the app's own
// switches for sound and vibration; a person who asked the phone for less
// motion gets the pages still.
//
// Nothing is promised that the app does not do: the card does not grow new
// rings, so no page says it does; the streak moves the Eye on the Iris.

const PAGES = 5;

// A sound with its touch, each only if the person has left it on.
const cue = (name: Cue, volume: number) => ritual(name, volume);

function tick() {
  if (prefValue('buzz', true)) void Haptics.selectionAsync().catch(() => undefined);
}

function thud() {
  if (prefValue('buzz', true)) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
}

// ------------------------------------------------------------------- sky --

// Placed the same way every time: a small hash, not Math.random.
function hash(n: number) {
  let x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const STARS = Array.from({ length: 110 }, (_, i) => ({ x: hash(i * 3 + 1), y: hash(i * 7 + 2) * 0.8, r: 0.5 + hash(i * 11 + 3) * 1.1, a: 0.2 + hash(i * 13 + 4) * 0.6 }));
const TWINKLES = Array.from({ length: 14 }, (_, i) => ({ x: hash(i * 17 + 5), y: hash(i * 19 + 6) * 0.72, r: 1.2 + hash(i * 23 + 7) * 1.2, d: 1_400 + hash(i * 29 + 8) * 2_200, o: hash(i * 31 + 9) * 2_000 }));

function Twinkle({ x, y, r, d, o, still }: { x: number; y: number; r: number; d: number; o: number; still: boolean }) {
  const glow = useSharedValue(0.25);
  useEffect(() => {
    if (still) { glow.value = 0.6; return; }
    glow.value = withDelay(o, withRepeat(withSequence(withTiming(1, { duration: d, easing: Easing.inOut(Easing.sin) }), withTiming(0.15, { duration: d, easing: Easing.inOut(Easing.sin) })), -1, false));
  }, [still, d, o, glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.value, transform: [{ scale: 0.7 + glow.value * 0.5 }] }));
  return <Animated.View pointerEvents="none" style={[styles.twinkle, { left: x - r * 2, top: y - r * 2, width: r * 4, height: r * 4, borderRadius: r * 2 }, style]} />;
}

// The NFT's night: stars, an aurora low down, the sea catching it.
function NightSky({ width, height, still }: { width: number; height: number; still: boolean }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="aurora1" cx="0.22" cy="0.8" rx="0.8" ry="0.28">
            <Stop offset="0" stopColor="#1FD6A8" stopOpacity="0.20" />
            <Stop offset="1" stopColor="#1FD6A8" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="aurora2" cx="0.85" cy="0.66" rx="0.6" ry="0.26">
            <Stop offset="0" stopColor="#2FA8FF" stopOpacity="0.16" />
            <Stop offset="1" stopColor="#2FA8FF" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="halo" cx="0.5" cy="0.34" rx="0.6" ry="0.3">
            <Stop offset="0" stopColor="#56E0FF" stopOpacity="0.10" />
            <Stop offset="1" stopColor="#56E0FF" stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0B2A33" stopOpacity="0" />
            <Stop offset="1" stopColor="#0B2A33" stopOpacity="0.55" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="#03060A" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#aurora1)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#aurora2)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#halo)" />
        {STARS.map((star, i) => <Circle key={i} cx={star.x * width} cy={star.y * height} r={star.r} fill="#D8F4FF" opacity={star.a} />)}
        <Rect x={0} y={height * 0.78} width={width} height={height * 0.22} fill="url(#sea)" />
      </Svg>
      {TWINKLES.map((star, i) => <Twinkle key={i} x={star.x * width} y={star.y * height} r={star.r} d={star.d} o={star.o} still={still} />)}
    </View>
  );
}

// A soft light that breathes behind the Eye.
function Breath({ size, still, tone = colors.accent }: { size: number; still: boolean; tone?: string }) {
  const k = useSharedValue(0.5);
  useEffect(() => {
    if (still) { k.value = 0.6; return; }
    k.value = withRepeat(withSequence(withTiming(1, { duration: 2_400, easing: Easing.inOut(Easing.sin) }), withTiming(0.35, { duration: 2_400, easing: Easing.inOut(Easing.sin) })), -1, false);
  }, [still, k]);
  const style = useAnimatedStyle(() => ({ opacity: 0.2 + k.value * 0.35, transform: [{ scale: 0.92 + k.value * 0.12 }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: tone, shadowColor: tone, shadowOpacity: 1, shadowRadius: size / 3, elevation: 0 }, styles.breath, style]} />;
}

// ---------------------------------------------------------------- pictures --

// Page one: it wakes. Two heartbeats, the lids part, the number rises.
function Awakening({ active, reduced, serial, size }: { active: boolean; reduced: boolean; serial: string | null; size: number }) {
  const [open, setOpen] = useState(reduced);
  const [blink, setBlink] = useState(0);
  const shown = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) { setOpen(true); shown.value = 1; return; }
    if (!active) { setOpen(false); shown.value = 0; return; }
    setOpen(false);
    shown.value = 0;
    const timers = [
      setTimeout(() => cue('heart', 0.55), 350),
      setTimeout(() => cue('heart', 0.45), 1_250),
      setTimeout(() => { setOpen(true); thud(); cue('wake', 0.42); shown.value = withDelay(700, withTiming(1, { duration: 700 })); }, 2_100),
    ];
    const loop = setInterval(() => setBlink((count) => count + 1), 4_800);
    return () => { timers.forEach(clearTimeout); clearInterval(loop); };
  }, [active, reduced, shown]);
  const tag = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 12 }] }));
  return (
    <View style={{ width: size, alignItems: 'center' }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Breath size={size * 0.9} still={reduced} />
        <PortalEye size={size} open={open} blink={blink} instant={reduced} />
      </View>
      <Animated.Text style={[styles.serial, tag]}>{serial ?? ' '}</Animated.Text>
    </View>
  );
}

// The three touches, drawn small.
function TouchIcon({ name, tone }: { name: 'finger' | 'wallet' | 'network'; tone: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 26 26">
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

// An arc round a centre, degrees clockwise from twelve o'clock.
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy + r * Math.sin(rad)).toFixed(2)}`;
  };
  const large = to - from > 180 ? 1 : 0;
  return `M ${point(from)} A ${r} ${r} 0 ${large} 1 ${point(to)}`;
}

const TOUCHES = ['finger', 'wallet', 'network'] as const;

// Page two: opened by you. Three lights round the Eye, one per touch; the
// line under it says what each is; then the heartbeat, and it opens.
function Orbit({ active, reduced, size, finger, onCaption }: { active: boolean; reduced: boolean; size: number; finger: boolean; onCaption: (text: string) => void }) {
  const stops = finger ? TOUCHES : TOUCHES.slice(1);
  const n = stops.length;
  const [at, setAt] = useState(reduced ? n : -1);
  const captions = useMemo<Record<(typeof TOUCHES)[number] | 'eye', string>>(() => ({
    finger: t('Your fingerprint signs'),
    wallet: t('Your wallet approves and pays'),
    network: t('Solana writes it down'),
    eye: t('Your Eye opens'),
  }), []);
  useEffect(() => {
    if (reduced) { setAt(n); onCaption(captions.eye); return; }
    if (!active) { setAt(-1); return; }
    let step = -1;
    setAt(-1);
    onCaption(' ');
    const timer = setInterval(() => {
      step += 1;
      if (step > n + 2) step = -1;
      if (step >= 0 && step < n) { cue('chime', 0.32); onCaption(captions[stops[step] ?? 'eye']); }
      if (step === n) { cue('heart', 0.5); }
      if (step === n + 1) { thud(); cue('wake', 0.38); onCaption(captions.eye); }
      if (step === -1) onCaption(' ');
      setAt(Math.min(step, n + 1));
    }, 1_050);
    return () => clearInterval(timer);
  }, [active, reduced, n, stops, captions, onCaption]);

  const half = size / 2;
  const R = size * 0.42;
  const node = Math.round(size * 0.2);
  const angles = stops.map((_, i) => (360 / n) * i);
  const open = at >= n + 1 || (reduced && at >= n);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={half} cy={half} r={R} fill="none" stroke={colors.line} strokeWidth={1.2} strokeDasharray="2 5" />
        {angles.map((from, i) => {
          const to = i + 1 < n ? (angles[i + 1] ?? 360) : 360;
          const lit = at > i;
          return <Path key={i} d={arc(half, half, R, from + 9, to - 9)} fill="none" stroke={lit ? colors.accent : 'transparent'} strokeWidth={2.4} strokeLinecap="round" opacity={0.85} />;
        })}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Breath size={size * 0.5} still={reduced} />
        <PortalEye size={Math.round(size * 0.56)} open={open} instant={reduced} />
      </View>
      {stops.map((name, i) => {
        const rad = (((angles[i] ?? 0) - 90) * Math.PI) / 180;
        const x = half + R * Math.cos(rad) - node / 2;
        const y = half + R * Math.sin(rad) - node / 2;
        const lit = at >= i;
        const here = at === i;
        const tone = here ? colors.accent : lit ? colors.positive : colors.dim;
        return (
          <View key={name} style={[styles.orb, { left: x, top: y, width: node, height: node, borderRadius: node / 2, borderColor: tone, backgroundColor: here ? 'rgba(86, 224, 255, 0.16)' : lit ? 'rgba(124, 240, 188, 0.08)' : 'rgba(7, 12, 18, 0.9)', shadowColor: tone, shadowOpacity: here ? 0.9 : 0, shadowRadius: 12 }]}>
            <TouchIcon name={name} tone={tone} />
          </View>
        );
      })}
    </View>
  );
}

// Page three: blink every eight hours. A dial of three arcs round the Eye, a
// hand walking it; at each arc's end the Eye blinks.
function BlinkDial({ active, reduced, size, slots }: { active: boolean; reduced: boolean; size: number; slots: number }) {
  const [blink, setBlink] = useState(0);
  const [slot, setSlot] = useState(0);
  const turn = useSharedValue(0);
  const per = 360 / slots;
  useEffect(() => {
    setSlot(0);
    turn.value = 0;
    if (reduced || !active) return;
    let ticks = 0;
    const SLOT_MS = 1_900;
    turn.value = withTiming(per, { duration: SLOT_MS, easing: Easing.linear });
    const timer = setInterval(() => {
      ticks += 1;
      setBlink(ticks);
      setSlot(ticks % slots);
      cue('wink', 0.32);
      turn.value = withTiming((ticks + 1) * per, { duration: SLOT_MS, easing: Easing.linear });
    }, SLOT_MS);
    return () => clearInterval(timer);
  }, [active, reduced, per, slots, turn]);
  const hand = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const half = size / 2;
  const r = half - 10;
  const gap = 8;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
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
          <View style={[styles.handDot, { left: half - 6, top: 10 - 6 }]} />
        </Animated.View>
      )}
      <Breath size={size * 0.52} still={reduced} />
      <PortalEye size={Math.round(size * 0.66)} open blink={blink} instant={reduced} />
    </View>
  );
}

// The Iris's ring thresholds, outermost first: the streak an Eye needs to
// stand on each ring (src/iris.mjs in the service). Ring 0 is Perfect.
const RING_STREAK = [30, 21, 14, 10, 7, 5, 3, 2, 1];

// The other Eyes on the rings, placed the same way every time.
function crowd(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const roll = hash(i * 41 + 3);
    const ring = roll < 0.3 ? 8 : roll < 0.52 ? 7 : roll < 0.68 ? 6 : roll < 0.79 ? 5 : roll < 0.87 ? 4 : roll < 0.93 ? 3 : roll < 0.96 ? 2 : roll < 0.985 ? 1 : 0;
    return { ring, angle: hash(i * 43 + 5) * 360, open: hash(i * 47 + 7) < 0.6 };
  });
}

// One small Eye, the NFT's shape: a glowing ring, a gold iris, shut if it
// has not blinked today.
function SmallEye({ x, y, r, open, perfect }: { x: number; y: number; r: number; open: boolean; perfect: boolean }) {
  const tone = perfect ? colors.metal : open ? '#6EF0FF' : '#5E7890';
  return (
    <G>
      {open ? <Circle cx={x} cy={y} r={r * 1.9} fill={perfect ? colors.metal : '#56E0FF'} opacity={0.12} /> : null}
      <Circle cx={x} cy={y} r={r} fill="#050B10" stroke={tone} strokeWidth={Math.max(1, r * 0.28)} opacity={open ? 1 : 0.75} />
      {open ? (
        <>
          <Circle cx={x} cy={y} r={r * 0.46} fill="#D6B56A" />
          <Circle cx={x} cy={y} r={r * 0.21} fill="#020304" />
        </>
      ) : <Path d={`M ${x - r * 0.55} ${y} L ${x + r * 0.55} ${y}`} stroke="#3A5B68" strokeWidth={Math.max(0.8, r * 0.14)} />}
    </G>
  );
}

// Page four: one of many. The Iris, every Eye a small eye; yours steps ring
// by ring to the pupil, a touch each ring, gold and a chime at thirty days.
function IrisClimb({ active, reduced, size }: { active: boolean; reduced: boolean; size: number }) {
  const half = size / 2;
  const pupil = size * 0.15;
  const outer = half - 6;
  const step = (outer - pupil) / 9;
  const radiusOf = (ring: number) => pupil + (ring + 0.5) * step;
  const angle = -38;
  const at = useCallback((ring: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: half + radiusOf(ring) * Math.cos(rad), y: half + radiusOf(ring) * Math.sin(rad) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);
  const others = useMemo(() => crowd(40), []);
  const [ring, setRing] = useState(reduced ? 0 : 8);
  const [blink, setBlink] = useState(0);
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
      if (current === 0) { cue('chime', 0.45); setBlink((count) => count + 1); } else tick();
    }, 720);
    return () => clearInterval(timer);
  }, [active, reduced, at, x, y]);
  const you = useAnimatedStyle(() => ({ transform: [{ translateX: x.value - 9 }, { translateY: y.value - 9 }] }));
  const perfect = ring === 0;
  const small = Math.max(3.2, step * 0.36);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={half} cy={half} r={outer} fill="rgba(6, 12, 18, 0.72)" />
        <Circle cx={half} cy={half} r={pupil + step} fill="rgba(201, 169, 106, 0.10)" />
        {Array.from({ length: 10 }, (_, index) => (
          <Circle key={index} cx={half} cy={half} r={pupil + index * step} fill="none" stroke={index === 1 ? 'rgba(201, 169, 106, 0.5)' : 'rgba(120, 200, 230, 0.13)'} strokeWidth={1} />
        ))}
        {others.map((eye, index) => {
          const rad = ((eye.angle - 90) * Math.PI) / 180;
          const r = radiusOf(eye.ring);
          return <SmallEye key={index} x={half + r * Math.cos(rad)} y={half + r * Math.sin(rad)} r={small} open={eye.open} perfect={eye.ring === 0} />;
        })}
      </Svg>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <PortalEye size={Math.round(pupil * 2.3)} open blink={blink} instant={reduced} />
      </View>
      <Animated.View pointerEvents="none" style={[styles.youEye, { borderColor: perfect ? colors.metal : colors.accent, shadowColor: perfect ? colors.metal : colors.accent }, you]}>
        <View style={[styles.youIris, { backgroundColor: perfect ? colors.metal : '#D6B56A' }]} />
      </Animated.View>
      <View pointerEvents="none" style={[styles.youTag, { left: half + 8, top: 4 }]}>
        <Text style={[styles.youTagText, { color: perfect ? colors.metal : colors.accent }]}>
          {perfect ? t('Perfect Eye') : (RING_STREAK[ring] ?? 1) === 1 ? t('day 1') : t('{count} days in a row', { count: RING_STREAK[ring] ?? 1 })}
        </Text>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ ready --

function Check({ state, label, detail, index, active }: { state: 'yes' | 'no' | 'wait' | 'later'; label: string; detail?: string | null; index: number; active: boolean }) {
  const tone = state === 'yes' ? colors.positive : state === 'no' ? colors.negative : colors.faint;
  return (
    <Animated.View key={active ? 'on' : 'off'} entering={active ? FadeInDown.delay(250 + index * 220).duration(380) : undefined} style={styles.check}>
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
    </Animated.View>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.rowStrong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong]}>{value}</Text>
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
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const [caption, setCaption] = useState(' ');
  // Prices come with the wallet's status; before a wallet, from the service's health.
  const [health, setHealth] = useState<EyePrices | null>(null);
  useEffect(() => {
    let live = true;
    void fetchEyeHealth().then((answer) => { if (live && answer.prices) setHealth(answer.prices); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const prices: EyePrices | null = status?.prices ?? health;

  // Every page arrives on the low fifth.
  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => cue('hum', 0.3), 120);
    return () => clearTimeout(timer);
  }, [page, reduced]);

  const go = useCallback((next: number) => {
    const target = Math.max(0, Math.min(PAGES - 1, next));
    pager.current?.scrollTo({ x: target * width, animated: !reduced });
    setPage(target);
    tick();
  }, [width, reduced]);

  const onScrolled = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
    if (next !== page) { setPage(next); tick(); }
  }, [width, page]);

  const art = Math.min(290, Math.round(width * 0.72), Math.round(height * 0.36));
  const serial = nextSerial != null ? `EYE #${String(nextSerial).padStart(4, '0')}` : null;
  const hours = cooldownHours(prices, status?.blink?.cooldownSeconds);
  const slots = Math.max(1, Math.round(24 / Math.max(1, hours)));
  const solUsd = prices?.solUsd ?? null;
  const blinkUsd = prices ? usd(prices.blinkLamports, solUsd) : null;
  const blinkPrice = prices ? `${sol(prices.blinkLamports)} SOL${blinkUsd ? ` ≈ ${blinkUsd}` : ''}` : null;

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

  const pages: Array<{ key: string; title: string; body: string; art: ReactElement; foot?: ReactElement | null }> = [
    {
      key: 'wake',
      title: t('This is your Eye'),
      body: t('An NFT that lives in your wallet, one per wallet. Its number is its place in line, and it never changes.'),
      art: <Awakening active={page === 0} reduced={reduced} serial={serial} size={art} />,
    },
    {
      key: 'open',
      title: t('You open it yourself'),
      body: t('Nothing happens without you. Each step lights up on screen the moment it is done.'),
      art: <Orbit active={page === 1} reduced={reduced} size={art} finger={EYE_FINGER_ENABLED} onCaption={setCaption} />,
      foot: <Animated.Text key={caption} entering={reduced ? undefined : FadeIn.duration(260)} style={styles.caption}>{caption}</Animated.Text>,
    },
    {
      key: 'blink',
      title: t('Blink every {hours} hours', { hours }),
      body: t('A Blink is a small mark on Solana that says: I was here. One tap, and your Eye blinks.'),
      art: <BlinkDial active={page === 2} reduced={reduced} size={art} slots={slots} />,
      foot: blinkPrice ? <Text style={styles.caption}>{`${blinkPrice} · ${t('every {hours} hours', { hours })}`}</Text> : null,
    },
    {
      key: 'iris',
      title: t('One Blink a day draws you in'),
      body: t('The Iris is every Eye together. Each day you blink, your Eye moves one ring closer to the centre. Thirty days in a row and it turns gold. Miss a day and you start again.'),
      art: <IrisClimb active={page === 3} reduced={reduced} size={Math.min(320, Math.round(width * 0.8), Math.round(height * 0.4))} />,
    },
  ];

  return (
    <View style={styles.screen}>
      <NightSky width={width} height={height} still={reduced} />
      <View style={styles.top}>
        <View style={styles.bars}>
          {Array.from({ length: PAGES }, (_, index) => (
            <Pressable key={index} onPress={() => go(index)} style={styles.barHit} accessibilityRole="button" accessibilityLabel={`${index + 1} / ${PAGES}`}>
              <View style={[styles.bar, { backgroundColor: index <= page ? colors.accent : 'rgba(120, 200, 230, 0.16)', opacity: index === page ? 1 : index < page ? 0.55 : 1 }]} />
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
        {pages.map((item, index) => (
          <ScrollView key={item.key} style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
            <View style={styles.art}>{item.art}</View>
            {item.foot ?? <View style={styles.captionGap} />}
            {page === index ? (
              <>
                <Animated.Text entering={reduced ? undefined : FadeInDown.delay(180).duration(420)} style={styles.title}>{item.title}</Animated.Text>
                <Animated.Text entering={reduced ? undefined : FadeInDown.delay(420).duration(420)} style={styles.body}>{item.body}</Animated.Text>
              </>
            ) : (
              <>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.body}>{item.body}</Text>
              </>
            )}
          </ScrollView>
        ))}

        <ScrollView style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
          <View style={styles.readyHead}>
            <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
              <Breath size={76} still={reduced} />
              <PortalEye size={84} open={hasEye} instant />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.titleLeft}>{hasEye ? t('Your Eye is open') : t('Ready to open')}</Text>
              {serial && !hasEye ? <Text style={styles.serialLeft}>{t('Next: {serial}', { serial })}</Text> : null}
            </View>
          </View>

          <View style={styles.card}>
            <Check
              index={0}
              active={page === PAGES - 1}
              state={wallet ? 'yes' : 'later'}
              label={t('Wallet connected')}
              detail={wallet ? shortAddress(wallet) : t('Read only. Nothing is signed here.')}
            />
            <Check
              index={1}
              active={page === PAGES - 1}
              state={!wallet ? 'later' : !status ? 'wait' : gates?.sgt ? 'yes' : gates?.sgt === false ? 'no' : 'later'}
              label={t('Seeker Genesis Token')}
              detail={!wallet ? t('Proves this phone is a Seeker') : gates?.sgt === false ? t('Not found in this wallet') : gates?.sgt ? t('Found in your wallet') : null}
            />
            <Check
              index={2}
              active={page === PAGES - 1}
              state={!wallet ? 'later' : !status ? 'wait' : staked ? 'yes' : staked === false ? 'no' : 'later'}
              label={t('Staked SKR')}
              detail={!wallet ? t('You need SKR in staking') : staked && gates?.activeStaked ? `${integer(Number(gates.activeStaked))} SKR` : staked === false ? t('No active SKR position') : null}
            />
            {EYE_FINGER_ENABLED ? (
              <Check
                index={3}
                active={page === PAGES - 1}
                state={verified ? 'yes' : 'later'}
                label={t('Fingerprint on this Seeker')}
                detail={verified ? t('Already verified on this phone.') : t('Checked in the next step')}
              />
            ) : null}
          </View>

          {open != null && total != null ? (
            <View style={styles.card}>
              <Row label={t('Opening fee')} value={`${sol(open)} SOL`} />
              <Row label={t('Deposit kept inside your Eye')} value={`≈ ${sol(rent)} SOL`} />
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

          <Text style={styles.fine}>{t('The opening fee and every Blink go to the maker of SKR Eyes. The deposit stays inside your Eye, in your wallet. No token is sold here.')}</Text>
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
  screen: { flex: 1, backgroundColor: '#03060A' },
  twinkle: { position: 'absolute', backgroundColor: '#E8FBFF' },
  breath: { alignSelf: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  bars: { flex: 1, flexDirection: 'row', gap: 6 },
  barHit: { flex: 1, paddingVertical: 8 },
  bar: { height: 3, borderRadius: 2 },
  skip: { color: colors.muted, fontFamily: font.medium, ...type.small },
  pager: { flex: 1 },
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.sm },
  art: { alignItems: 'center', justifyContent: 'center', minHeight: 250, marginTop: spacing.sm },
  caption: { color: colors.text, fontFamily: font.semibold, fontSize: 16, lineHeight: 22, textAlign: 'center', minHeight: 22, marginTop: spacing.sm, fontVariant: ['tabular-nums'] },
  captionGap: { height: 22 + spacing.sm },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 27, lineHeight: 33, letterSpacing: -0.6, textAlign: 'center', marginTop: spacing.md },
  titleLeft: { color: colors.text, fontFamily: font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  body: { color: '#9FB4C6', fontFamily: font.regular, fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: spacing.sm },
  serial: { color: colors.metal, fontFamily: font.mono, fontSize: 16, letterSpacing: 2, marginTop: spacing.sm },
  serialLeft: { color: colors.metal, fontFamily: font.mono, fontSize: 13, letterSpacing: 1.2, marginTop: 2 },
  orb: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, elevation: 0 },
  handDot: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: '#E8FBFF', shadowColor: '#56E0FF', shadowOpacity: 1, shadowRadius: 8 },
  youEye: { position: 'absolute', left: 0, top: 0, width: 18, height: 18, borderRadius: 9, borderWidth: 2.5, backgroundColor: '#050B10', alignItems: 'center', justifyContent: 'center', shadowOpacity: 1, shadowRadius: 10 },
  youIris: { width: 7, height: 7, borderRadius: 3.5 },
  youTag: { position: 'absolute' },
  youTagText: { fontFamily: font.semibold, ...type.small, fontVariant: ['tabular-nums'] },
  readyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  card: { backgroundColor: 'rgba(10, 16, 23, 0.86)', borderRadius: radius.card, borderWidth: 1, borderColor: '#13212C', padding: spacing.md, gap: spacing.md },
  check: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  checkMark: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkText: { flex: 1, gap: 2 },
  checkLabel: { color: colors.text, fontFamily: font.semibold, ...type.body },
  checkDetail: { color: colors.faint, fontFamily: font.regular, ...type.small, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  rowLabel: { color: colors.muted, fontFamily: font.regular, ...type.body, flexShrink: 1 },
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
  bottom: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  bottomStack: { gap: spacing.xs },
});
