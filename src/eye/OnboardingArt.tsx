import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, FadeIn, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { t } from '../i18n';
import { prefValue } from '../prefs';
import { ritual, type Cue } from '../sound';
import { colors, font, radius, spacing } from '../theme';
import { clamp, isBig } from './fit';
import { Glyph, Overline, type GlyphName } from './glyphs';
import { PortalEye } from './PortalEye';
import { Road, type StepStatus } from './Stepper';

// The pictures of the walk-through of the Eye (EyeOnboarding.tsx), one per
// page, and the sky they all stand in. Each picture runs only while its page
// is in front (`active`), stands still for a person who asked the phone for
// less motion (`reduced`), and moves on the UI thread: shared values and
// timers that change a state a few times a second at most, never a frame at
// a time in JavaScript. Skia is deliberately not linked into this app (see
// src/lab/cardArt.tsx), so every glow, gradient and line here is SVG.

// ------------------------------------------------------------------- cues --

// A sound with its touch, each only if the person has left it on.
export const cue = (name: Cue, volume: number) => ritual(name, volume);

// One soft note per thing that lights, up a scale: tone1 … tone7. The pages
// arrive on them in order, and the lights on a page continue from the page's
// own note, so a walk through the whole thing is one rising line.
export const note = (step: number, volume = 0.3) => ritual(`tone${Math.max(1, Math.min(7, Math.round(step)))}` as Cue, volume);

export function tick() {
  if (prefValue('buzz', true)) void Haptics.selectionAsync().catch(() => undefined);
}

export function tap() {
  if (prefValue('buzz', true)) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function thud() {
  if (prefValue('buzz', true)) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
}

// A list of moments, each at its millisecond; returns the way to cancel them.
export function schedule(steps: Array<[number, () => void]>): () => void {
  const timers = steps.map(([ms, fn]) => setTimeout(fn, ms));
  return () => timers.forEach(clearTimeout);
}

// -------------------------------------------------------------------- sky --

// Placed the same way every time: a small hash, not Math.random.
export function hash(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const STARS = Array.from({ length: 120 }, (_, i) => ({ x: hash(i * 3 + 1), y: hash(i * 7 + 2) * 0.5, r: 0.45 + hash(i * 11 + 3) * 1.1, a: 0.18 + hash(i * 13 + 4) * 0.6 }));
const TWINKLES = Array.from({ length: 14 }, (_, i) => ({ x: hash(i * 17 + 5), y: 0.04 + hash(i * 19 + 6) * 0.42, r: 0.7 + hash(i * 23 + 7) * 0.6, d: 1_400 + hash(i * 29 + 8) * 2_200, o: hash(i * 31 + 9) * 2_000 }));

function Twinkle({ x, y, r, d, o, still }: { x: number; y: number; r: number; d: number; o: number; still: boolean }) {
  const glow = useSharedValue(0.2);
  useEffect(() => {
    if (still) { glow.value = 0.5; return; }
    glow.value = withDelay(o, withRepeat(withSequence(withTiming(0.85, { duration: d, easing: Easing.inOut(Easing.sin) }), withTiming(0.1, { duration: d, easing: Easing.inOut(Easing.sin) })), -1, false));
  }, [still, d, o, glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.value }));
  return <Animated.View pointerEvents="none" style={[styles.twinkle, { left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: r }, style]} />;
}

// The NFT card's night: stars, two curtains of aurora low in the sky, a
// horizon, and the sea catching the light. The stars keep to the upper half,
// where the pictures are, and a scrim darkens the lower half, where the words
// are: a speck of star inside a letter reads as dirt. Drawn once (memoised:
// the pager around it redraws on every page, and this must not); only the
// twinkles move.
export const NightSky = memo(function NightSky({ width, height, still }: { width: number; height: number; still: boolean }) {
  const w = width;
  const h = height;
  // A band between two curves, the aurora's shape.
  const curtain = (top: number, bottom: number, lift: number) =>
    `M0 ${h * top} C ${w * 0.25} ${h * (top - lift)} ${w * 0.55} ${h * (top + lift * 0.6)} ${w} ${h * (top - lift * 0.5)} L ${w} ${h * (bottom - lift * 0.5)} C ${w * 0.55} ${h * (bottom + lift * 0.6)} ${w * 0.25} ${h * (bottom - lift)} 0 ${h * bottom} Z`;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={w} height={h}>
        <Defs>
          <RadialGradient id="sky-a1" cx="0.22" cy="0.78" rx="0.8" ry="0.3">
            <Stop offset="0" stopColor="#1FD6A8" stopOpacity="0.2" />
            <Stop offset="1" stopColor="#1FD6A8" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="sky-a2" cx="0.85" cy="0.62" rx="0.6" ry="0.28">
            <Stop offset="0" stopColor="#2FA8FF" stopOpacity="0.16" />
            <Stop offset="1" stopColor="#2FA8FF" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="sky-halo" cx="0.5" cy="0.34" rx="0.6" ry="0.3">
            <Stop offset="0" stopColor="#56E0FF" stopOpacity="0.1" />
            <Stop offset="1" stopColor="#56E0FF" stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="sky-c1" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#3CF2C0" stopOpacity="0" />
            <Stop offset="0.45" stopColor="#3CF2C0" stopOpacity="0.13" />
            <Stop offset="1" stopColor="#3CF2C0" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="sky-c2" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#56E0FF" stopOpacity="0" />
            <Stop offset="0.5" stopColor="#56E0FF" stopOpacity="0.09" />
            <Stop offset="1" stopColor="#56E0FF" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="sky-sea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0B2A33" stopOpacity="0.05" />
            <Stop offset="1" stopColor="#0B2A33" stopOpacity="0.6" />
          </LinearGradient>
          <LinearGradient id="sky-horizon" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#7CF0BC" stopOpacity="0" />
            <Stop offset="0.5" stopColor="#7CF0BC" stopOpacity="0.4" />
            <Stop offset="1" stopColor="#7CF0BC" stopOpacity="0" />
          </LinearGradient>
          <RadialGradient id="sky-shine" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#56E0FF" stopOpacity="0.16" />
            <Stop offset="1" stopColor="#56E0FF" stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="sky-scrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#03060A" stopOpacity="0" />
            <Stop offset="0.4" stopColor="#03060A" stopOpacity="0.64" />
            <Stop offset="1" stopColor="#03060A" stopOpacity="0.8" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill="#03060A" />
        <Rect x={0} y={0} width={w} height={h} fill="url(#sky-a1)" />
        <Rect x={0} y={0} width={w} height={h} fill="url(#sky-a2)" />
        <Rect x={0} y={0} width={w} height={h} fill="url(#sky-halo)" />
        <Path d={curtain(0.5, 0.62, 0.08)} fill="url(#sky-c2)" />
        <Path d={curtain(0.58, 0.74, 0.06)} fill="url(#sky-c1)" />
        {STARS.map((star, i) => <Circle key={i} cx={star.x * w} cy={star.y * h} r={star.r} fill="#D8F4FF" opacity={star.a} />)}
        <Rect x={0} y={h * 0.8} width={w} height={h * 0.2} fill="url(#sky-sea)" />
        <Rect x={0} y={h * 0.8 - 0.5} width={w} height={1} fill="url(#sky-horizon)" />
        <Ellipse cx={w / 2} cy={h * 0.86} rx={w * 0.36} ry={h * 0.05} fill="url(#sky-shine)" />
        <Rect x={0} y={h * 0.42} width={w} height={h * 0.58} fill="url(#sky-scrim)" />
      </Svg>
      {TWINKLES.map((star, i) => <Twinkle key={i} x={star.x * w} y={star.y * h} r={star.r} d={star.d} o={star.o} still={still} />)}
    </View>
  );
});

// A soft light that breathes behind the Eye.
export function Breath({ size, still, tone = colors.accent, strength = 1 }: { size: number; still: boolean; tone?: string; strength?: number }) {
  const k = useSharedValue(0.5);
  useEffect(() => {
    if (still) { k.value = 0.6; return; }
    k.value = withRepeat(withSequence(withTiming(1, { duration: 2_400, easing: Easing.inOut(Easing.sin) }), withTiming(0.35, { duration: 2_400, easing: Easing.inOut(Easing.sin) })), -1, false);
  }, [still, k]);
  const style = useAnimatedStyle(() => ({ opacity: (0.35 + k.value * 0.55) * strength, transform: [{ scale: 0.94 + k.value * 0.1 }] }));
  const half = size / 2;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, alignSelf: 'center' }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="breath" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0.45" stopColor={tone} stopOpacity="0.32" />
            <Stop offset="0.7" stopColor={tone} stopOpacity="0.12" />
            <Stop offset="1" stopColor={tone} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={half} cy={half} r={half} fill="url(#breath)" />
      </Svg>
    </Animated.View>
  );
}

// One small Eye, the NFT's shape: a glowing ring, a gold iris, shut if it has
// not blinked today. The same drawing the Iris makes on its canvas.
export function SmallEye({ x, y, r, open, perfect }: { x: number; y: number; r: number; open: boolean; perfect: boolean }) {
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

// -------------------------------------------------------- 01 · the idea --

// Fourteen Seekers keeping watch round the Eye, placed the same way every time.
const WATCHERS = Array.from({ length: 14 }, (_, i) => ({
  a: ((i + 0.5) / 14) * Math.PI * 2 + (hash(i * 5 + 1) - 0.5) * 0.35,
  r: 0.42 + hash(i * 9 + 2) * 0.09,
  size: 4.2 + hash(i * 13 + 3) * 2.6,
  order: hash(i * 17 + 4),
}));

function Watcher({ x, y, r, order, crowd }: { x: number; y: number; r: number; order: number; crowd: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, (crowd.value - order * 0.7) / 0.3)) * 0.9 }));
  const box = r * 4;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - box / 2, top: y - box / 2, width: box, height: box }, style]}>
      <Svg width={box} height={box}><SmallEye x={box / 2} y={box / 2} r={r} open perfect={false} /></Svg>
    </Animated.View>
  );
}

// Page one: it wakes. Two heartbeats, the lids part, the number rises under
// it, and the others come out of the dark round it one by one.
export function Awakening({ active, reduced, serial, width, height }: { active: boolean; reduced: boolean; serial: string | null; width: number; height: number }) {
  const big = isBig();
  // The eye and its watchers take what the box leaves after the number.
  const size = clamp(Math.min(Math.round(width * 0.85), height - (big ? 36 : 60)), 130, 330);
  const [open, setOpen] = useState(reduced);
  const [blink, setBlink] = useState(0);
  const shown = useSharedValue(reduced ? 1 : 0);
  const crowd = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) { setOpen(true); shown.value = 1; crowd.value = 1; return; }
    if (!active) { setOpen(false); shown.value = 0; crowd.value = 0; return; }
    setOpen(false);
    shown.value = 0;
    crowd.value = 0;
    const stop = schedule([
      [400, () => cue('heart', 0.4)],
      [1_300, () => cue('heart', 0.35)],
      [2_150, () => {
        setOpen(true);
        thud();
        cue('wake', 0.4);
        shown.value = withDelay(650, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
        crowd.value = withDelay(1_100, withTiming(1, { duration: 2_600, easing: Easing.out(Easing.quad) }));
      }],
    ]);
    const loop = setInterval(() => setBlink((count) => count + 1), 4_800);
    return () => { stop(); clearInterval(loop); };
  }, [active, reduced, shown, crowd]);
  const tag = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 12 }] }));
  const cx = width / 2;
  const cy = size / 2;
  return (
    <View style={{ width, alignItems: 'center' }}>
      <View style={{ width, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Breath size={size * 1.3} still={reduced} />
        {WATCHERS.map((eye, i) => (
          <Watcher key={i} x={cx + eye.r * size * Math.cos(eye.a)} y={cy + eye.r * size * Math.sin(eye.a)} r={eye.size} order={eye.order} crowd={crowd} />
        ))}
        <PortalEye size={Math.round(size * 0.8)} open={open} blink={blink} instant={reduced} />
      </View>
      <Animated.View style={[styles.serialBlock, tag]}>
        <Text maxFontSizeMultiplier={1.2} style={styles.serial}>{serial ?? ' '}</Text>
        {big ? null : <Text style={styles.serialNote}>{t('Your number. It never changes.')}</Text>}
      </Animated.View>
    </View>
  );
}

// ------------------------------------------------ 02 · inside your Seeker --

// The phone, drawn in a 120 by 240 box: a cutaway of the Seeker with the
// parts the Eye uses inside it, and above it what vouches for them.
const VB_W = 120;
const VB_H = 240;
const PHONE = { x: 14, y: 54, w: 92, h: 182, rx: 14 };
const SCREEN = { x: 20, y: 62, w: 80, h: 166, rx: 8 };
const DIM = '#2C4A5A';

type Callout = { key: string; icon: GlyphName; title: string; line: string; mark: [number, number] };

function calloutsFor(finger: boolean, big: boolean): Callout[] {
  const vault: Callout = { key: 'vault', icon: 'vault', title: t('Seed Vault wallet'), line: big ? t('Keys never leave the phone.') : t('Its keys never leave the phone’s secure hardware.'), mark: [60, finger ? 146 : 122] };
  const token: Callout = { key: 'token', icon: 'token', title: t('Genesis Token'), line: big ? t('Proof this wallet is a Seeker’s.') : t('Minted once per Seeker. Your wallet’s proof.'), mark: [60, finger ? 188 : 172] };
  if (!finger) {
    return [
      { key: 'network', icon: 'network', title: t('Solana'), line: big ? t('Your Eye lives here.') : t('Your Eye lives here. Every Blink rewrites it.'), mark: [60, 30] },
      vault,
      token,
    ];
  }
  return [
    { key: 'cert', icon: 'cert', title: t('Google attestation'), line: big ? t('Google vouches for the phone.') : t('Google vouches for chip, boot and app.'), mark: [60, 30] },
    { key: 'key', icon: 'key', title: t('StrongBox key'), line: big ? t('Signs only after your fingerprint.') : t('In the secure element. Signs only after your fingerprint.'), mark: [60, 98] },
    vault,
    token,
  ];
}

// The parts, each drawable dim or lit.
function ChainAbove({ tone, blocks }: { tone: string; blocks: boolean }) {
  if (blocks) {
    // Solana: three blocks above the phone, a line down into the vault.
    return (
      <G fill="none" stroke={tone} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
        <Rect x={41} y={24} width={11} height={11} rx={2} />
        <Rect x={54.5} y={24} width={11} height={11} rx={2} />
        <Rect x={68} y={24} width={11} height={11} rx={2} />
        <Path d="M52 29.5h2.5M65.5 29.5h2.5" />
        <Path d="M60 35v19" strokeDasharray="2 3" />
      </G>
    );
  }
  // Google's root at the top, two certificates under it, the chain running
  // down into the phone to the key.
  return (
    <G fill="none" stroke={tone} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M60 5l2.2 5.3 5.3 2.2-5.3 2.2L60 20l-2.2-5.3-5.3-2.2 5.3-2.2L60 5Z" fill={tone} fillOpacity={0.9} />
      <Rect x={52} y={25} width={16} height={9} rx={1.6} />
      <Path d="M55.5 29.5h9" strokeWidth={1} />
      <Rect x={52} y={40} width={16} height={9} rx={1.6} />
      <Path d="M55.5 44.5h9" strokeWidth={1} />
      <Path d="M60 20v5M60 34v6M60 49v5" />
      <Path d="M60 54v30" strokeDasharray="2 3" />
    </G>
  );
}

function ChipInside({ tone }: { tone: string }) {
  return (
    <G fill="none" stroke={tone} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={47} y={85} width={26} height={26} rx={2.4} />
      <Rect x={55} y={93} width={10} height={10} rx={1.4} />
      <Path d="M52 85v-4M60 85v-4M68 85v-4M52 111v4M60 111v4M68 111v4M47 90h-4M47 98h-4M47 106h-4M73 90h4M73 98h4M73 106h4" />
      {/* The key inside the chip. */}
      <Circle cx={57.5} cy={98} r={1.6} fill={tone} stroke="none" />
      <Path d="M59 98h4M62 98v1.4" strokeWidth={1} />
      {/* The sensor under the screen, low down, and the line from the chip
          to it: the key answers only to the finger. */}
      <G transform="translate(48.5 197) scale(0.96)">
        <Path d="M4.5 10.2a7.5 7.5 0 0 1 15 0" />
        <Path d="M7.4 19.6c-.9-1.9-1.4-3.9-1.4-6.2a6 6 0 0 1 12 0c0 1.2-.1 2.3-.3 3.4" />
        <Path d="M10.2 21.3c-1.1-2.3-1.6-4.7-1.6-7.3a3.4 3.4 0 0 1 6.8 0c0 2-.3 3.9-.9 5.6" />
        <Path d="M12 13.6c0 3 .6 5.6 1.8 7.8" />
      </G>
    </G>
  );
}

function VaultInside({ tone, y }: { tone: string; y: number }) {
  return (
    <G fill="none" stroke={tone} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={60} cy={y} r={15} />
      <Circle cx={60} cy={y} r={5.5} />
      <Path d={`M60 ${y - 15}v4M60 ${y + 11}v4M45 ${y}h4M71 ${y}h4`} />
      <Path d={`M49.4 ${y - 10.6}l2.8 2.8M67.8 ${y + 7.8}l2.8 2.8M70.6 ${y - 10.6}l-2.8 2.8M52.2 ${y + 7.8}l-2.8 2.8`} strokeWidth={1} />
    </G>
  );
}

function TokenInside({ tone, y }: { tone: string; y: number }) {
  const r = 11;
  const hex = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(60 + r * Math.cos(a)).toFixed(2)} ${(y + r * Math.sin(a)).toFixed(2)}`;
  }).join(' L ');
  return (
    <G fill="none" stroke={tone} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <Path d={`M ${hex} Z`} />
      <Path d={`M60 ${y - 4.6}l1.3 3.3 3.3 1.3-3.3 1.3-1.3 3.3-1.3-3.3-3.3-1.3 3.3-1.3L60 ${y - 4.6}Z`} fill={tone} stroke="none" />
    </G>
  );
}

function Part({ item, tone }: { item: Callout; tone: string }) {
  switch (item.key) {
    case 'cert': return <ChainAbove tone={tone} blocks={false} />;
    case 'network': return <ChainAbove tone={tone} blocks />;
    case 'key': return <ChipInside tone={tone} />;
    case 'vault': return <VaultInside tone={tone} y={item.mark[1]} />;
    case 'token': return <TokenInside tone={tone} y={item.mark[1]} />;
    default: return null;
  }
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

// One leader line from a mark on the phone to its row in the legend, drawn
// on as the callout lights.
function Leader({ d, length, k }: { d: string; length: number; k: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - k.value), opacity: k.value > 0.02 ? 1 : 0 }), [length]);
  return <AnimatedPath d={d} fill="none" stroke={colors.accent} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[length, length]} animatedProps={props} />;
}

function LitLayer({ item, k, width, height }: { item: Callout; k: SharedValue<number>; width: number; height: number }) {
  const style = useAnimatedStyle(() => ({ opacity: k.value }));
  const [mx, my] = item.mark;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Defs>
          <RadialGradient id={`glow-${item.key}`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={colors.accent} stopOpacity="0.28" />
            <Stop offset="1" stopColor={colors.accent} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={mx} cy={my} r={30} fill={`url(#glow-${item.key})`} />
        <Part item={item} tone={colors.accent} />
        <Circle cx={mx} cy={my} r={2.2} fill="#E8FBFF" />
      </Svg>
    </Animated.View>
  );
}

// Page two: built into your Seeker. A blueprint of the phone with the parts
// the Eye uses, and a legend beside it; part and legend light together, one
// by one, a leader line drawn from each mark to its words.
export function Blueprint({ active, reduced, width, height: room, finger, noteFrom }: { active: boolean; reduced: boolean; width: number; height: number; finger: boolean; noteFrom: number }) {
  const big = isBig();
  const items = useMemo(() => calloutsFor(finger, big), [finger, big]);
  const height = clamp(room, 220, 350);
  const scale = height / VB_H;
  const phoneW = Math.round(VB_W * scale);
  const gap = spacing.sm;
  const legendX = phoneW + gap;
  // The legend sits on a dark plate, so no star shows through its words.
  const plate = spacing.sm;
  const [lit, setLit] = useState(reduced ? items.length : -1);
  const [rows, setRows] = useState<Array<{ y: number; h: number } | null>>([]);
  const k0 = useSharedValue(reduced ? 1 : 0);
  const k1 = useSharedValue(reduced ? 1 : 0);
  const k2 = useSharedValue(reduced ? 1 : 0);
  const k3 = useSharedValue(reduced ? 1 : 0);
  const ks = useMemo(() => [k0, k1, k2, k3], [k0, k1, k2, k3]);

  useEffect(() => {
    const set = (value: number) => ks.forEach((k) => { k.value = value; });
    if (reduced) { setLit(items.length); set(1); return; }
    if (!active) { setLit(-1); set(0); return; }
    setLit(-1);
    set(0);
    return schedule(items.map((_, i) => [900 + i * 1_150, () => {
      setLit(i);
      note(noteFrom + i + 1, 0.28);
      tap();
      const k = ks[i];
      if (k) k.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
    }]));
  }, [active, reduced, items, ks, noteFrom]);

  const onRow = useCallback((index: number, event: LayoutChangeEvent) => {
    const { y, height: h } = event.nativeEvent.layout;
    setRows((current) => {
      const next = current.slice();
      next[index] = { y, h };
      return next;
    });
  }, []);

  // The leaders: from the mark, out past the phone's edge, across to the row.
  const leaders = items.map((item, i) => {
    const row = rows[i];
    if (!row) return null;
    const [mx, my] = item.mark;
    const sx = mx * scale;
    const sy = my * scale;
    const kx = phoneW + 5;
    const ex = legendX + plate - 4;
    const ey = row.y + plate + 15;
    const d = `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${kx} ${sy.toFixed(1)} L ${(ex - 8).toFixed(1)} ${ey.toFixed(1)} L ${ex} ${ey.toFixed(1)}`;
    const length = Math.abs(kx - sx) + Math.hypot(ex - 8 - kx, ey - sy) + 8;
    return { d, length };
  });

  // The sheet itself never changes while the page is up: built once per size.
  const sheet = useMemo(() => (
    <Svg width={phoneW} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`}>
      {/* The sheet: a faint grid and a dimension line, so it reads as a drawing. */}
      <G stroke="#56E0FF" strokeOpacity={0.07} strokeWidth={0.6}>
        {Array.from({ length: 6 }, (_, i) => <Path key={`v${i}`} d={`M${i * 20 + 10} 0V${VB_H}`} />)}
        {Array.from({ length: 12 }, (_, i) => <Path key={`h${i}`} d={`M0 ${i * 20 + 10}H${VB_W}`} />)}
      </G>
      <G stroke="#56E0FF" strokeOpacity={0.3} strokeWidth={0.7} strokeLinecap="round">
        <Path d={`M6 ${PHONE.y}V${PHONE.y + PHONE.h}M3.5 ${PHONE.y}h5M3.5 ${PHONE.y + PHONE.h}h5`} />
        <Path d={`M${PHONE.x} ${VB_H - 3}h${PHONE.w}M${PHONE.x} ${VB_H - 5.5}v5M${PHONE.x + PHONE.w} ${VB_H - 5.5}v5`} />
      </G>
      {/* The Seeker, cut open. */}
      <Rect x={PHONE.x} y={PHONE.y} width={PHONE.w} height={PHONE.h} rx={PHONE.rx} fill="rgba(6, 12, 18, 0.55)" stroke="#56E0FF" strokeOpacity={0.7} strokeWidth={1.2} />
      <Rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={SCREEN.rx} fill="none" stroke="#56E0FF" strokeOpacity={0.28} strokeWidth={0.8} strokeDasharray="3 3" />
      <Circle cx={60} cy={SCREEN.y + 5} r={1.6} fill="none" stroke="#56E0FF" strokeOpacity={0.5} strokeWidth={0.8} />
      {/* The parts, unlit. */}
      {items.map((item) => <Part key={item.key} item={item} tone={DIM} />)}
    </Svg>
  ), [phoneW, height, items]);

  return (
    <View style={{ width, minHeight: height, flexDirection: 'row', gap }}>
      <View style={{ width: phoneW, height }}>
        {sheet}
        {items.map((item, i) => {
          const k = ks[i];
          return k ? <LitLayer key={item.key} item={item} k={k} width={phoneW} height={height} /> : null;
        })}
      </View>
      <View style={styles.legend}>
        {items.map((item, i) => {
          const on = lit >= i;
          const here = lit === i;
          return (
            <View key={item.key} onLayout={(event) => onRow(i, event)} style={styles.callout}>
              <View style={[styles.calloutIcon, on && styles.calloutIconOn, here && styles.calloutIconHere]}>
                <Glyph name={item.icon} size={17} tone={on ? colors.accent : colors.dim} />
              </View>
              <View style={styles.calloutText}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.calloutTitle, !on && styles.calloutOff]}>{item.title}</Text>
                <Text maxFontSizeMultiplier={1.3} style={[styles.calloutLine, !on && styles.calloutOff]}>{item.line}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={Math.max(height, ...rows.map((row) => (row ? row.y + row.h : 0)))}>
        {leaders.map((leader, i) => {
          const k = ks[i];
          return leader && k ? <Leader key={items[i]?.key ?? i} d={leader.d} length={leader.length} k={k} /> : null;
        })}
      </Svg>
    </View>
  );
}

// ------------------------------------------------- 03 · how your Eye opens --

export type RoadStop = { icon: GlyphName; name: string; copy: string };

const WORK_MS = 1_000;
const BEAT_MS = 320;

// Page three: the exact road the person walks next, in order. Once, if the
// finger is on: Verify my Seeker, four checks. Then: Open my Eye, each step
// named as the sheet will name it. The Eye on top opens when the last lands.
export function OpeningRoad({ active, reduced, width, height, finger }: { active: boolean; reduced: boolean; width: number; height: number; finger: boolean }) {
  // At large type the roads lose their overlines and the eye on top gives
  // way first, so the two roads and the caption always have their room.
  const big = isBig();
  const eye = clamp(height - (finger ? (big ? 300 : 350) : (big ? 170 : 210)), 48, 104);
  const verify = useMemo<RoadStop[]>(() => finger ? [
    { icon: 'key', name: t('Vault key'), copy: t('A key is born in the StrongBox secure element. It answers only to your finger.') },
    { icon: 'cert', name: t('Seeker'), copy: t('Google’s certificate chain confirms a real Seeker, verified boot and this app.') },
    { icon: 'token', name: t('Genesis Token'), copy: t('Your Seeker Genesis Token is found in the wallet.') },
    { icon: 'check', name: t('Verified'), copy: t('Our attestor signs it. This phone is known from now on.') },
  ] : [], [finger]);
  const open = useMemo<RoadStop[]>(() => [
    ...(finger ? [{ icon: 'finger' as const, name: t('Finger'), copy: t('Touch the sensor. The key signs a one-time challenge from the server.') }] : []),
    { icon: 'wallet', name: t('Wallet'), copy: t('Approve and pay in your Seed Vault wallet.') },
    { icon: 'network', name: t('Network'), copy: t('The server checks and co-signs. Solana confirms it.') },
    { icon: 'eye', name: t('Eye opens'), copy: t('Your Eye is minted into your wallet. The lids part.') },
  ], [finger]);
  const all = useMemo(() => [...verify, ...open], [verify, open]);
  const total = all.length;
  const [at, setAt] = useState(reduced ? total : -1);
  const [lidsOpen, setLidsOpen] = useState(reduced);

  useEffect(() => {
    if (reduced) { setAt(total); setLidsOpen(true); return; }
    if (!active) { setAt(-1); setLidsOpen(false); return; }
    let cancel: (() => void) | null = null;
    let loud = true;
    const run = () => {
      const steps: Array<[number, () => void]> = [];
      let clock = 600;
      setAt(-1);
      setLidsOpen(false);
      all.forEach((_, i) => {
        const last = i === total - 1;
        if (i === verify.length && verify.length > 0) clock += 700;
        const first = loud;
        steps.push([clock, () => { setAt(i); if (last && first) cue('heart', 0.4); }]);
        clock += last ? 900 : WORK_MS;
        steps.push([clock, () => {
          setAt(i + 1);
          if (last) { setLidsOpen(true); if (first) { thud(); cue('wake', 0.35); } else tap(); }
          else if (first) cue('chime', 0.26);
          else tick();
        }]);
        clock += BEAT_MS;
      });
      clock += 3_400;
      steps.push([clock, () => { loud = false; run(); }]);
      cancel = schedule(steps);
    };
    run();
    return () => cancel?.();
  }, [active, reduced, all, total, verify.length]);

  const caption = at >= total ? t('Your Eye is open') : all[at]?.copy ?? ' ';
  // The stops as the shared road draws them, with the status each has now.
  const road = (stops: RoadStop[], from: number) => stops.map((stop, i) => {
    const index = from + i;
    const status: StepStatus = at > index ? 'done' : at === index ? 'working' : 'pending';
    return { key: stop.name, icon: stop.icon, name: stop.name, status };
  });
  return (
    <View style={{ width, alignItems: 'stretch', gap: spacing.sm }}>
      <View style={[styles.roadEye, { height: eye + 14 }]}>
        <Breath size={eye * 1.45} still={reduced} strength={0.8} />
        <PortalEye size={eye} open={lidsOpen} instant={reduced} />
      </View>
      {verify.length > 0 ? <Road overline={big ? undefined : `${t('Once')} · ${t('Verify my Seeker')}`} stops={road(verify, 0)} reduced={reduced} /> : null}
      <Road overline={big ? undefined : `${verify.length > 0 ? t('Then') : t('One button')} · ${t('Open my Eye')}`} stops={road(open, verify.length)} reduced={reduced} />
      <Animated.Text key={caption} entering={reduced ? undefined : FadeIn.duration(240)} maxFontSizeMultiplier={1.3} style={styles.roadCaption}>{caption}</Animated.Text>
    </View>
  );
}

// ------------------------------------------------------ 04 · the Blink --

// An arc round a centre, degrees clockwise from twelve o'clock.
export function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy + r * Math.sin(rad)).toFixed(2)}`;
  };
  const large = to - from > 180 ? 1 : 0;
  return `M ${point(from)} A ${r} ${r} 0 ${large} 1 ${point(to)}`;
}

function Figure({ label, value, tone = colors.text }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.figure}>
      <Text maxFontSizeMultiplier={1.3} style={styles.figureLabel}>{label}</Text>
      <Animated.Text key={value} entering={FadeIn.duration(220)} maxFontSizeMultiplier={1.3} style={[styles.figureValue, { color: tone }]}>{value}</Animated.Text>
    </View>
  );
}

// Page four: Blink every eight hours. A dial of the day round the Eye, one
// arc per rest, a hand walking it; at each arc's end the Eye blinks and the
// three numbers a Blink writes on Solana move. A tap tries a Blink.
export function BlinkDial({ active, reduced, width, height, slots, hours }: { active: boolean; reduced: boolean; width: number; height: number; slots: number; hours: number }) {
  const size = clamp(Math.min(Math.round(width * 0.82), height - (isBig() ? 84 : 72)), 140, 300);
  const [blink, setBlink] = useState(0);
  const [slot, setSlot] = useState(0);
  const [written, setWritten] = useState({ streak: 1, blinks: 1 });
  const turn = useSharedValue(0);
  const per = 360 / slots;
  useEffect(() => {
    setSlot(0);
    setWritten({ streak: 1, blinks: 1 });
    turn.value = 0;
    if (reduced || !active) return;
    let ticks = 0;
    const SLOT_MS = 2_100;
    turn.value = withTiming(per, { duration: SLOT_MS, easing: Easing.linear });
    const timer = setInterval(() => {
      ticks += 1;
      setBlink((count) => count + 1);
      setSlot(ticks % slots);
      setWritten((was) => ({ streak: was.streak + (ticks % slots === 0 ? 1 : 0), blinks: was.blinks + 1 }));
      if (ticks <= slots) cue('wink', 0.28); else tap();
      turn.value = withTiming((ticks + 1) * per, { duration: SLOT_MS, easing: Easing.linear });
    }, SLOT_MS);
    return () => clearInterval(timer);
  }, [active, reduced, per, slots, turn]);
  const hand = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const half = size / 2;
  const r = half - 14;
  const gap = 7;
  const tickEvery = 24 / Math.max(1, slots);
  const trail = Array.from({ length: 6 }, (_, i) => i);
  return (
    <View style={{ alignItems: 'center', gap: spacing.md }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={half} cy={half} r={r} fill="none" stroke={colors.line} strokeWidth={1} />
          {/* Twenty-four hours, a longer mark where a rest ends. */}
          {Array.from({ length: 24 }, (_, hour) => {
            const rad = ((hour * 15 - 90) * Math.PI) / 180;
            const edge = hour % tickEvery === 0;
            const r1 = r + 6;
            const r2 = r + (edge ? 12 : 9);
            return <Path key={hour} d={`M ${half + r1 * Math.cos(rad)} ${half + r1 * Math.sin(rad)} L ${half + r2 * Math.cos(rad)} ${half + r2 * Math.sin(rad)}`} stroke={edge ? colors.accent : 'rgba(120, 200, 230, 0.35)'} strokeWidth={edge ? 1.4 : 1} strokeLinecap="round" />;
          })}
          {Array.from({ length: slots }, (_, index) => (
            <Path
              key={index}
              d={arc(half, half, r, index * per + gap / 2, (index + 1) * per - gap / 2)}
              fill="none"
              stroke={index === slot ? colors.accent : 'rgba(120, 200, 230, 0.22)'}
              strokeWidth={index === slot ? 6 : 4}
              strokeLinecap="round"
            />
          ))}
          {Array.from({ length: slots }, (_, index) => {
            const rad = ((index * per - 90) * Math.PI) / 180;
            const rr = r + 22;
            return (
              <SvgText key={index} x={half + rr * Math.cos(rad)} y={half + rr * Math.sin(rad) + 3} fontSize={9.5} fontFamily={font.monoSemibold} fill={colors.faint} textAnchor="middle">
                {`${index * hours}h`}
              </SvgText>
            );
          })}
        </Svg>
        {reduced ? null : (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, hand]}>
            <Svg width={size} height={size}>
              <Defs>
                <RadialGradient id="hand-glow" cx="0.5" cy="0.5" r="0.5">
                  <Stop offset="0" stopColor="#56E0FF" stopOpacity="0.55" />
                  <Stop offset="1" stopColor="#56E0FF" stopOpacity="0" />
                </RadialGradient>
              </Defs>
              {trail.map((i) => <Path key={i} d={arc(half, half, r, -4 - (i + 1) * 5, -4 - i * 5)} fill="none" stroke="#C6F6FF" strokeWidth={6} strokeLinecap="butt" opacity={0.55 * (1 - i / 6)} />)}
              <Circle cx={half} cy={14} r={14} fill="url(#hand-glow)" />
              <Circle cx={half} cy={14} r={4.5} fill="#F2FDFF" />
            </Svg>
          </Animated.View>
        )}
        <Breath size={size * 0.8} still={reduced} />
        <Pressable onPress={() => { setBlink((count) => count + 1); setWritten((was) => ({ ...was, blinks: was.blinks + 1 })); cue('wink', 0.4); tap(); }} accessibilityRole="button" accessibilityLabel={t('Tap the Eye to try a Blink')}>
          <PortalEye size={Math.round(size * 0.6)} open blink={blink} instant={reduced} />
        </Pressable>
      </View>
      {/* What one Blink rewrites in the Eye, on Solana. */}
      <View style={styles.figures}>
        <Figure label={t('Streak')} value={written.streak === 1 ? t('1 day') : t('{count} days', { count: written.streak })} tone={colors.metal} />
        <View style={styles.figureRule} />
        <Figure label={t('Blinks')} value={String(written.blinks)} />
        <View style={styles.figureRule} />
        <Figure label={t('Written on')} value="Solana" tone={colors.positive} />
      </View>
    </View>
  );
}

// ------------------------------------------------------- 05 · the Iris --

// The Iris's ring thresholds, outermost first: the streak an Eye needs to
// stand on each ring (src/iris.mjs in the service). Ring 0 is Perfect.
const RING_STREAK = [30, 21, 14, 10, 7, 5, 3, 2, 1];
// What each rail says on the real Iris, innermost first.
const RAIL_LABEL = ['30+', '21', '14', '10', '7', '5', '3', '2', '1'];

// The other Eyes on the rings, placed the same way every time.
function crowd(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const roll = hash(i * 41 + 3);
    const ring = roll < 0.3 ? 8 : roll < 0.52 ? 7 : roll < 0.68 ? 6 : roll < 0.79 ? 5 : roll < 0.87 ? 4 : roll < 0.93 ? 3 : roll < 0.96 ? 2 : roll < 0.985 ? 1 : 0;
    return { ring, angle: hash(i * 43 + 5) * 360, open: hash(i * 47 + 7) < 0.6 };
  });
}

// A Blink arriving on the network: a ring that grows and fades where the Eye is.
function Flash({ x, y, gold, k }: { x: number; y: number; gold: boolean; k: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: 1 - k.value, transform: [{ scale: 0.6 + 2.6 * k.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.flash, { left: x - 10, top: y - 10, borderColor: gold ? colors.metal : colors.positive }, style]} />;
}

// Page five: one of many. The Iris, every Eye a small eye on its ring, the
// network blinking round the pupil; yours steps ring by ring to the centre,
// a touch each ring, gold and a chime at thirty days.
export function IrisClimb({ active, reduced, width, height }: { active: boolean; reduced: boolean; width: number; height: number }) {
  const size = clamp(Math.min(width, height), 160, 330);
  const half = size / 2;
  const pupil = size * 0.15;
  const outer = half - 8;
  const step = (outer - pupil) / 9;
  const radiusOf = useCallback((ring: number) => pupil + (ring + 0.5) * step, [pupil, step]);
  const angle = -38;
  const at = useCallback((ring: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: half + radiusOf(ring) * Math.cos(rad), y: half + radiusOf(ring) * Math.sin(rad) };
  }, [half, radiusOf]);
  const others = useMemo(() => crowd(44), []);
  const placed = useMemo(() => others.map((eye) => {
    const rad = ((eye.angle - 90) * Math.PI) / 180;
    const r = radiusOf(eye.ring);
    return { ...eye, x: half + r * Math.cos(rad), y: half + r * Math.sin(rad) };
  }), [others, half, radiusOf]);
  const [ring, setRing] = useState(reduced ? 0 : 8);
  const [blink, setBlink] = useState(0);
  const x = useSharedValue(at(reduced ? 0 : 8).x);
  const y = useSharedValue(at(reduced ? 0 : 8).y);
  // Three flashes in flight at most; each is re-aimed at the next Eye that blinks.
  const f0 = useSharedValue(1);
  const f1 = useSharedValue(1);
  const f2 = useSharedValue(1);
  const flashes = useMemo(() => [f0, f1, f2], [f0, f1, f2]);
  const [aims, setAims] = useState<Array<{ x: number; y: number; gold: boolean }>>([]);
  const turn = useRef(0);

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
    let arrived = false;
    const climb = setInterval(() => {
      if (current === 0) {
        hold += 1;
        if (hold < 4) return;
        hold = 0;
        current = 8;
        place(8, 0);
        return;
      }
      current -= 1;
      place(current, 420);
      if (current === 0) { if (!arrived) cue('chime', 0.4); else tick(); arrived = true; setBlink((count) => count + 1); } else tick();
    }, 760);
    // Somebody on the network blinks every second or so: the pupil blinks with them.
    let slot = 0;
    const network = setInterval(() => {
      const open = placed.filter((eye) => eye.open);
      const pick = open[Math.floor(hash(turn.current * 7 + 1) * open.length)];
      turn.current += 1;
      if (!pick) return;
      const index = slot % 3;
      slot += 1;
      setAims((current) => {
        const next = current.slice();
        next[index] = { x: pick.x, y: pick.y, gold: pick.ring === 0 };
        return next;
      });
      const k = flashes[index];
      if (k) { k.value = 0; k.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) }); }
      setBlink((count) => count + 1);
    }, 1_350);
    return () => { clearInterval(climb); clearInterval(network); };
  }, [active, reduced, at, x, y, placed, flashes]);

  const you = useAnimatedStyle(() => ({ transform: [{ translateX: x.value - 9 }, { translateY: y.value - 9 }] }));
  const perfect = ring === 0;
  const small = Math.max(3.2, step * 0.36);
  // The field, rails, crowd and labels never change while the page is up:
  // built once per size, so a blink on the network redraws only the flash.
  const field = useMemo(() => (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id="iris-field" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0.3" stopColor="#122A38" stopOpacity="0.6" />
          <Stop offset="0.7" stopColor="#0A1A26" stopOpacity="0.35" />
          <Stop offset="1" stopColor="#04070B" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx={half} cy={half} r={outer + 6} fill="url(#iris-field)" />
      <Circle cx={half} cy={half} r={pupil + step} fill="rgba(201, 169, 106, 0.08)" />
      {Array.from({ length: 10 }, (_, index) => (
        <Circle key={index} cx={half} cy={half} r={pupil + index * step} fill="none" stroke={index === 1 ? 'rgba(201, 169, 106, 0.5)' : 'rgba(120, 200, 230, 0.13)'} strokeWidth={1} />
      ))}
      {placed.map((eye, index) => <SmallEye key={index} x={eye.x} y={eye.y} r={small} open={eye.open} perfect={eye.ring === 0} />)}
      {/* The streak a rail stands for, as the Iris writes it: every other
          rail, in a row along the left radius where nothing moves. */}
      {[8, 6, 4, 2, 0].map((index) => {
        const label = RAIL_LABEL[index] ?? '';
        const lx = half - (pupil + (index + 1) * step);
        const ly = half;
        return (
          <G key={label}>
            <Circle cx={lx} cy={ly} r={7} fill="rgba(4, 7, 11, 0.92)" stroke={index === 0 ? 'rgba(201, 169, 106, 0.5)' : 'rgba(120, 200, 230, 0.25)'} strokeWidth={0.8} />
            <SvgText x={lx} y={ly + 2.8} fontSize={7.5} fontFamily={font.monoSemibold} fill={index === 0 ? '#E8CF95' : 'rgba(150, 200, 225, 0.95)'} textAnchor="middle">{label}</SvgText>
          </G>
        );
      })}
    </Svg>
  ), [size, half, pupil, step, outer, placed, small]);

  return (
    <View style={{ width: size, height: size }}>
      {field}
      {aims.map((aim, index) => {
        const k = flashes[index];
        return aim && k ? <Flash key={index} x={aim.x} y={aim.y} gold={aim.gold} k={k} /> : null;
      })}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <PortalEye size={Math.round(pupil * 2.3)} open blink={blink} instant={reduced} />
      </View>
      <Animated.View pointerEvents="none" style={[styles.youEye, { borderColor: perfect ? colors.metal : colors.accent, shadowColor: perfect ? colors.metal : colors.accent }, you]}>
        <View style={[styles.youIris, { backgroundColor: perfect ? colors.metal : '#D6B56A' }]} />
      </Animated.View>
      <View pointerEvents="none" style={[styles.youTag, { left: half + 10, top: 6 }]}>
        <Text maxFontSizeMultiplier={1.35} style={[styles.youTagText, { color: perfect ? colors.metal : colors.accent }]}>
          {perfect ? t('Perfect Eye') : (RING_STREAK[ring] ?? 1) === 1 ? t('day 1') : t('{count} days in a row', { count: RING_STREAK[ring] ?? 1 })}
        </Text>
      </View>
    </View>
  );
}

// -------------------------------------------------------- 06 · your card --

// A card the server's own renderer drew for a sample Eye (your.skr, EYE
// #0042, streak 7, 9 blinks), bundled so the page never shows another
// person's Eye and never waits on the network.
const SAMPLE_CARD = require('../../assets/eye/sample-card.jpg');

// Page six: your Eye is a card. The sample card rising into place; then the
// post it becomes on X, with the first lines of the caption the app writes,
// and the button that sends it, drawn as part of the picture.
export function CardShare({ active, reduced, width, height, caption }: { active: boolean; reduced: boolean; width: number; height: number; caption: string }) {
  const big = isBig();
  const card = clamp(Math.min(Math.round(width * 0.42), height - (big ? 236 : 206)), 92, 160);
  const up = useSharedValue(reduced ? 1 : 0);
  const post = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) { up.value = 1; post.value = 1; return; }
    if (!active) { up.value = 0; post.value = 0; return; }
    up.value = 0;
    post.value = 0;
    up.value = withDelay(200, withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }));
    post.value = withDelay(1_300, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
    return schedule([[1_350, () => { cue('chime', 0.3); tap(); }]]);
  }, [active, reduced, up, post]);
  const rise = useAnimatedStyle(() => ({ opacity: up.value, transform: [{ translateY: (1 - up.value) * 26 }, { scale: 0.96 + up.value * 0.04 }] }));
  const slide = useAnimatedStyle(() => ({ opacity: post.value, transform: [{ translateY: (1 - post.value) * 18 }] }));
  // The caption's first two lines, then an ellipsis: enough to see the shape of the post.
  const preview = useMemo(() => `${caption.split('\n').filter((line) => line.trim().length > 0).slice(0, 2).join('\n')}\n…`, [caption]);
  return (
    <View style={{ width, alignItems: 'center', gap: spacing.sm }}>
      <View style={{ width: card + 40, height: card + 12, alignItems: 'center', justifyContent: 'center' }}>
        <Breath size={card * 1.3} still={reduced} strength={0.9} />
        <Animated.View style={[styles.card, { width: card, height: card }, rise]}>
          <Image source={SAMPLE_CARD} style={{ width: card, height: card }} resizeMode="cover" accessibilityLabel={t('A sample Eye card')} />
        </Animated.View>
      </View>
      <Animated.View style={[styles.post, { width: Math.min(width, 380) }, slide]}>
        <View style={styles.postHead}>
          <View style={styles.postAvatar}><Glyph name="eye" size={14} tone={colors.metal} /></View>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.postName}>{`${t('you')}, `}<Text style={styles.postWhere}>{t('on X, with the picture attached')}</Text></Text>
        </View>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={big ? 3 : 4} style={styles.postText}>{preview}</Text>
        <View style={styles.postButton}>
          <Glyph name="share" size={14} tone={colors.accent} />
          <Text maxFontSizeMultiplier={1.3} style={styles.postButtonText}>{t('Share my Eye on X')}</Text>
        </View>
        <Text maxFontSizeMultiplier={1.3} style={styles.postNote}>{t('This button appears once your Eye is open.')}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  twinkle: { position: 'absolute', backgroundColor: '#E8FBFF' },
  serialBlock: { alignItems: 'center', gap: 2, marginTop: spacing.xs },
  serial: { color: colors.metal, fontFamily: font.monoSemibold, fontSize: 20, letterSpacing: 2.4, textShadowColor: 'rgba(0, 0, 0, 0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2.5 },
  serialNote: { color: colors.muted, fontFamily: font.regular, fontSize: 14, lineHeight: 19 },
  // The blueprint's legend.
  legend: { flex: 1, justifyContent: 'space-around', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.card, backgroundColor: 'rgba(4, 7, 11, 0.6)' },
  callout: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  calloutIcon: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(6, 12, 18, 0.9)', alignItems: 'center', justifyContent: 'center' },
  calloutIconOn: { borderColor: colors.accentDim, backgroundColor: 'rgba(86, 224, 255, 0.08)' },
  calloutIconHere: { borderColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.9, shadowRadius: 10, elevation: 0 },
  calloutText: { flex: 1, gap: 1 },
  calloutTitle: { color: colors.text, fontFamily: font.semibold, fontSize: 15, lineHeight: 20 },
  calloutLine: { color: '#A9BDCE', fontFamily: font.regular, fontSize: 14, lineHeight: 19 },
  calloutOff: { color: colors.faint, opacity: 0.6 },
  // The road.
  roadEye: { alignItems: 'center', justifyContent: 'center' },
  roadCaption: { color: colors.text, fontFamily: font.medium, fontSize: 15.5, lineHeight: 21, textAlign: 'center', paddingHorizontal: spacing.sm },
  // The dial's figures.
  figures: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.inner, backgroundColor: 'rgba(10, 16, 23, 0.8)', borderWidth: 1, borderColor: '#13212C' },
  figure: { alignItems: 'center', gap: 1, minWidth: 64 },
  figureLabel: { color: colors.faint, fontFamily: font.semibold, fontSize: 10.5, lineHeight: 14, letterSpacing: 1, textTransform: 'uppercase' },
  figureValue: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'] },
  figureRule: { width: 1, height: 22, backgroundColor: colors.line },
  // The Iris.
  flash: { position: 'absolute', width: 20, height: 20, borderRadius: 10, borderWidth: 1.5 },
  youEye: { position: 'absolute', left: 0, top: 0, width: 18, height: 18, borderRadius: 9, borderWidth: 2.5, backgroundColor: '#050B10', alignItems: 'center', justifyContent: 'center', shadowOpacity: 1, shadowRadius: 10 },
  youIris: { width: 7, height: 7, borderRadius: 3.5 },
  youTag: { position: 'absolute' },
  youTagText: { fontFamily: font.semibold, fontSize: 14, lineHeight: 19, fontVariant: ['tabular-nums'] },
  // The card and its post.
  card: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(86, 224, 255, 0.35)', backgroundColor: '#03060A' },
  post: { alignSelf: 'center', backgroundColor: 'rgba(10, 16, 23, 0.92)', borderRadius: radius.card, borderWidth: 1, borderColor: '#13212C', padding: spacing.md, gap: 6 },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  postAvatar: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.metalDim, backgroundColor: colors.metalWash, alignItems: 'center', justifyContent: 'center' },
  postName: { flex: 1, color: colors.text, fontFamily: font.semibold, fontSize: 13.5, lineHeight: 17 },
  postWhere: { color: colors.faint, fontFamily: font.regular, fontSize: 12.5 },
  postText: { color: '#D9E6F0', fontFamily: font.regular, fontSize: 13.5, lineHeight: 19 },
  // Part of the picture, not a button: an outline, small, and a line under it saying when the real one comes.
  postButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', gap: 6, borderWidth: 1, borderColor: colors.accentDim, borderRadius: radius.button, minHeight: 32, paddingHorizontal: spacing.md, marginTop: 2 },
  postButtonText: { color: colors.accent, fontFamily: font.semibold, fontSize: 12, letterSpacing: 0.3 },
  postNote: { color: colors.faint, fontFamily: font.regular, fontSize: 12, lineHeight: 16 },
});
