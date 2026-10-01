import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { t } from '../../i18n';
import { colors, font } from '../../theme';
import {
  DESIGN_W, IRIS_H, RAMP_BUCKETS, almondD, bucketColor, bucketHex, closest, discD, eyeBatches, hash, loupeNames, rampRGB,
  type Batch, type Bloom, type Box, type IrisWorld, type Placed, type WorldEye,
} from './geometry';
import {
  IDENTITY, OVERSCAN_X, OVERSCAN_Y, ZOOMED, closestOnScreen, cullItems, focusOn, isHome, layerShift, pickOnScreen, planViewLabels, project,
  settled, turnOf, unproject, viewFor, viewMatrix, youPointer, zoomed, type Pt, type ViewLabel, type ViewPlan, type Viewport,
} from './viewport';
import { ScrollLockContext } from './LockableScroll';
import { useViewport, type ViewShared } from './useViewport';

// The Iris: every Eye of the network at once, as one eye made of eyes (01.10, Alex: the stair at
// five hundred shows thirty-six people). The layout and the maths come from geometry.ts and
// viewport.ts; this file draws them and listens to fingers.
//
// Nothing here moves by itself. An Eye stands where its mint number put it and brightens when it
// blinks; a Blink arriving on the stream rings the Eye where it stands and says its name for a
// moment. The world stays in its frame, in its place on the page, and a person explores it:
//   - two fingers pinch it bigger, twist it round, and drag it along;
//   - with the world magnified, one finger drags it (below that the page scrolls as usual);
//   - the more it is magnified, the more people are named, and a tap opens the Eye it lands on;
//   - a touch that stays still for a beat opens the loupe (at rest only): the Eyes under the finger
//     grow and read their names, and lifting the finger opens the one in the crosshair;
//   - the buttons zoom in and out and bring everything home, and a flight (from "Around you" or
//     "Find an Eye") shows somebody up close.
//
// How it stays smooth. react-native-svg rasterises its tree on the CPU each time the tree changes,
// a few hundred milliseconds for five hundred Eyes: no way to redo that per frame. So the Iris is
// drawn once for a viewport into a layer, and while fingers move the live viewport the layer is
// only scaled, turned and shifted by the GPU (layerShift). When the fingers rest, a second layer
// is drawn for the new viewport out of sight, with only the Eyes that can be in view (cullItems),
// and the two crossfade; then they swap roles. A layer is drawn 40% beyond the frame on every
// side, so a drag has something to slide in. The names are small views that follow their Eye
// through the same live numbers, and React lays them out again whenever the fingers pause.

const RL = 46;       // the loupe's radius, in world units
const ZOOM = 3;
const HOLD_MS = 260;
const SLOP = 10;     // how far a finger may wander and still be a tap, in world units
const ROW_W = 320;
const HIDDEN = 0.01; // a layer waiting for its picture is almost, not quite, invisible: a layer at zero is not drawn at all
// What a name may not cover: the legend under the world, the buttons in its corner and the zoom readout.
const RESERVED: Box[] = [
  { x: 0, y: IRIS_H - 24, w: DESIGN_W, h: 24 },
  { x: DESIGN_W - 118, y: 2, w: 116, h: 42 },
  { x: 2, y: 4, w: 52, h: 22 },
];

const STARS = Array.from({ length: 46 }, (_, i) => ({ x: hash(i * 3 + 1) * DESIGN_W, y: hash(i * 7 + 2) * IRIS_H * 0.8, r: 0.4 + hash(i * 11 + 3) * 0.8, a: 0.08 + hash(i * 13 + 4) * 0.22 }));
const FIBRES = (() => {
  const cx = DESIGN_W / 2, cy = 204, R = 176;
  let d = '';
  for (let k = 0; k < 72; k += 1) {
    const th = (k / 72) * Math.PI * 2 + hash(k) * 0.05, r0 = 26 + hash(k + 40) * 30, r1 = R * (0.55 + 0.45 * hash(k + 90));
    d += `M${(cx + Math.cos(th) * r0).toFixed(1)} ${(cy + Math.sin(th) * r0).toFixed(1)}L${(cx + Math.cos(th) * r1).toFixed(1)} ${(cy + Math.sin(th) * r1).toFixed(1)}`;
  }
  return d;
})();

// The gradients every layer refers to by id, defined once per picture.
const Gradients = memo(function Gradients() {
  return (
    <Defs>
      <RadialGradient id="ir-bg" cx="0.5" cy="0.5" rx="0.5" ry="0.5">
        <Stop offset="0" stopColor="#C9A96A" stopOpacity="0.26" />
        <Stop offset="0.3" stopColor="#C9A96A" stopOpacity="0.09" />
        <Stop offset="0.62" stopColor="#7CF0BC" stopOpacity="0.045" />
        <Stop offset="0.9" stopColor="#56E0FF" stopOpacity="0.06" />
        <Stop offset="1" stopColor="#56E0FF" stopOpacity="0" />
      </RadialGradient>
      <RadialGradient id="g-gold" cx="0.5" cy="0.5" rx="0.5" ry="0.5">
        <Stop offset="0.25" stopColor="#C9A96A" stopOpacity="0.42" />
        <Stop offset="1" stopColor="#C9A96A" stopOpacity="0" />
      </RadialGradient>
      {Array.from({ length: RAMP_BUCKETS + 1 }, (_, b) => (
        <RadialGradient key={b} id={`gl-${b}`} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
          <Stop offset="0.3" stopColor={bucketHex(b)} stopOpacity="0.3" />
          <Stop offset="1" stopColor={bucketHex(b)} stopOpacity="0" />
        </RadialGradient>
      ))}
    </Defs>
  );
});

// The night behind the Iris stays where it is, drawn once: only the Iris is looked at closer.
const Sky = memo(function Sky() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${DESIGN_W} ${IRIS_H}`}>
        {STARS.map((s, i) => <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#D8F4FF" opacity={s.a} />)}
      </Svg>
    </View>
  );
});

const Disc = memo(function Disc({ world }: { world: IrisWorld }) {
  const { cx, cy, R, rOut } = world;
  return (
    <>
      <Circle cx={cx} cy={cy} r={R + 16} fill="url(#ir-bg)" />
      <Path d={FIBRES} stroke="rgba(214,236,250,0.05)" strokeWidth={0.8} fill="none" />
      <Circle cx={cx} cy={cy} r={R + 10} fill="none" stroke="rgba(86,224,255,0.08)" strokeWidth={8} />
      <Circle cx={cx} cy={cy} r={R + 5} fill="none" stroke="rgba(86,224,255,0.32)" strokeWidth={1.1} />
      <Circle cx={cx} cy={cy} r={(rOut[0] ?? 14) + 7} fill="#02040A" fillOpacity={0.55} stroke="rgba(201,169,106,0.4)" strokeWidth={1} />
      {rOut.slice(0, 8).map((r, i) => <Circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke="rgba(150,200,225,0.07)" strokeWidth={0.8} strokeDasharray="1.5 4" />)}
    </>
  );
});

const EyesLayer = memo(function EyesLayer({ batches, blooms }: { batches: Batch[]; blooms: Bloom[] }) {
  return (
    <>
      {blooms.map((b, i) => <Circle key={`b${i}`} cx={b.x} cy={b.y} r={b.r} fill={`url(#gl-${b.bucket})`} />)}
      {batches.map((b, i) => {
        if (b.kind === 'halo') return <Path key={i} d={b.d} fill={bucketColor(b.bucket)} opacity={b.opacity} />;
        if (b.kind === 'lid') return <Path key={i} d={b.d} fill={b.awake ? '#050B10' : '#060B10'} stroke={bucketColor(b.bucket, b.awake ? 1 : 0.26)} strokeWidth={b.sw} />;
        if (b.kind === 'seam') return <Path key={i} d={b.d} fill="none" stroke={bucketColor(b.bucket, 0.22)} strokeWidth={b.sw} strokeLinecap="round" />;
        return <Path key={i} d={b.d} fill={b.color} />;
      })}
    </>
  );
});

// You: the gold ring, the gold iris, a bloom of gold, and the thread home.
const MeEye = memo(function MeEye({ it, cx, cy }: { it: Placed; cx: number; cy: number }) {
  const s = it.w * 1.25, { x, y } = it;
  const mx = (x + cx) / 2 + (y - cy) * 0.18, my = (y + cy) / 2 - (x - cx) * 0.18;
  return (
    <>
      <Path d={`M${x} ${y}Q${mx} ${my} ${cx} ${cy}`} fill="none" stroke="rgba(201,169,106,0.42)" strokeWidth={1} strokeDasharray="1.5 3.5" />
      <Circle cx={x} cy={y} r={s * 0.95} fill="url(#g-gold)" />
      <Path d={almondD(x, y, s)} fill="#050B10" stroke="#C9A96A" strokeWidth={Math.max(1, s * 0.05)} />
      <Path d={discD(x, y, s * 0.14)} fill="#E9CD8C" />
      <Path d={discD(x, y, s * 0.064)} fill="#020304" />
      {s >= 15 ? <Path d={discD(x - s * 0.05, y - s * 0.05, s * 0.03)} fill="rgba(244,251,253,0.92)" /> : null}
      <Circle cx={x} cy={y} r={s * 0.62 + 2} fill="none" stroke="rgba(201,169,106,0.55)" strokeWidth={1} />
    </>
  );
});

// Who looked at your Eye today: soft dashed arcs that end on yours.
const LookArcs = memo(function LookArcs({ from, me }: { from: Placed[]; me: Placed | null }) {
  if (!me || from.length === 0) return null;
  let d = '', dots = '';
  for (const it of from) {
    const mx = (it.x + me.x) / 2, my = (it.y + me.y) / 2;
    const nx = -(me.y - it.y), ny = me.x - it.x, len = Math.hypot(nx, ny) || 1;
    const bend = Math.min(40, len * 0.28) * (hash(it.eye.serial) < 0.5 ? 1 : -1);
    d += `M${it.x.toFixed(1)} ${it.y.toFixed(1)}Q${(mx + (nx / len) * bend).toFixed(1)} ${(my + (ny / len) * bend).toFixed(1)} ${me.x.toFixed(1)} ${me.y.toFixed(1)}`;
    dots += discD(it.x, it.y, 2.2);
  }
  return (
    <>
      <Path d={d} fill="none" stroke="rgba(236,244,250,0.34)" strokeWidth={0.9} strokeDasharray="3 3" />
      <Path d={dots} fill="rgba(236,244,250,0.8)" />
    </>
  );
});

// One picture of the Iris, drawn for the viewport `layer.baked`, in a view 40% bigger than the
// frame on every side. The live viewport only ever moves the finished picture (layerShift).
type Layer = { baked: Viewport; batches: Batch[]; blooms: Bloom[] };
type Baked = { s: SharedValue<number>; a: SharedValue<number>; x: SharedValue<number>; y: SharedValue<number>; o: SharedValue<number> };

const SceneLayer = memo(function SceneLayer({ layer, world, me, arcs, k, view, baked }: {
  layer: Layer; world: IrisWorld; me: Placed | null; arcs: Placed[]; k: number; view: ViewShared; baked: Baked;
}) {
  const style = useAnimatedStyle(() => {
    const m = layerShift({ s: view.s.value, a: view.a.value, x: view.x.value, y: view.y.value }, { s: baked.s.value, a: baked.a.value, x: baked.x.value, y: baked.y.value });
    return { opacity: baked.o.value, transform: [{ translateX: m.dx * k }, { translateY: m.dy * k }, { rotate: `${m.a}rad` }, { scale: m.s }] };
  }, [k]);
  const w = DESIGN_W + 2 * OVERSCAN_X, h = IRIS_H + 2 * OVERSCAN_Y;
  const [a, b, c, d, e, f] = viewMatrix(layer.baked);
  return (
    <Animated.View pointerEvents="none" style={[styles.layer, { left: -OVERSCAN_X * k, top: -OVERSCAN_Y * k, width: w * k, height: h * k }, style]}>
      <Svg width="100%" height="100%" viewBox={`${-OVERSCAN_X} ${-OVERSCAN_Y} ${w} ${h}`}>
        <Gradients />
        <G transform={`matrix(${a} ${b} ${c} ${d} ${e} ${f})`}>
          <Disc world={world} />
          <EyesLayer batches={layer.batches} blooms={layer.blooms} />
          <LookArcs from={arcs} me={me} />
          {me ? <MeEye it={me} cx={world.cx} cy={world.cy} /> : null}
        </G>
      </Svg>
    </Animated.View>
  );
});

// A name, as a plate that hugs its text and follows its Eye through the viewport on the UI thread.
const FollowLabel = memo(function FollowLabel({ label, k, view }: { label: ViewLabel; k: number; view: ViewShared }) {
  const { at, dx, dy, w, h, side, tone, text, size } = label;
  const color = tone === 'me' ? colors.metal : tone === 'gold' ? '#E8CF95' : '#E4EEF6';
  const shift = side === 'left' ? w : side === 'right' ? 0 : w / 2;
  const row = side === 'left' ? -ROW_W : side === 'right' ? 0 : -ROW_W / 2;
  const style = useAnimatedStyle(() => {
    const p = project({ s: view.s.value, a: view.a.value, x: view.x.value, y: view.y.value }, at.x, at.y);
    return { transform: [{ translateX: (p.x + dx + shift) * k + row }, { translateY: (p.y + dy) * k }] };
  }, [at.x, at.y, dx, dy, shift, row, k]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.labelRow, { height: h * k, width: ROW_W, alignItems: side === 'right' ? 'flex-start' : side === 'left' ? 'flex-end' : 'center' }, style]}
    >
      <View style={[styles.plate, tone === 'me' && styles.plateMe, { borderRadius: 3.2 * k, paddingHorizontal: 3 * k, height: h * k }]}>
        <Text allowFontScaling={false} numberOfLines={1} style={{ color, fontFamily: tone === 'me' ? font.semibold : font.medium, fontSize: size * k, lineHeight: size * k * 1.25, includeFontPadding: false }}>{text}</Text>
      </View>
    </Animated.View>
  );
});

const FollowTag = memo(function FollowTag({ tag, k, view }: { tag: NonNullable<ViewPlan['youTag']>; k: number; view: ViewShared }) {
  const { at, dx, dy, w, h } = tag;
  const style = useAnimatedStyle(() => {
    const p = project({ s: view.s.value, a: view.a.value, x: view.x.value, y: view.y.value }, at.x, at.y);
    return { transform: [{ translateX: (p.x + dx) * k }, { translateY: (p.y + dy + 1.5) * k }] };
  }, [at.x, at.y, dx, dy, k]);
  return (
    <Animated.View pointerEvents="none" style={[styles.you, { width: w * k, height: (h - 2) * k, borderRadius: 6 * k }, style]}>
      <Text allowFontScaling={false} style={{ color: '#191307', fontFamily: font.bold, fontSize: 8.2 * k, includeFontPadding: false, letterSpacing: 0.3 }}>{t('you')}</Text>
    </Animated.View>
  );
});

// An Eye somebody asked to see: a white ring that follows it.
const FollowRing = memo(function FollowRing({ at, w, k, view }: { at: Pt; w: number; k: number; view: ViewShared }) {
  const r0 = (w * 0.9 + 4) * k;
  const style = useAnimatedStyle(() => {
    const p = project({ s: view.s.value, a: view.a.value, x: view.x.value, y: view.y.value }, at.x, at.y);
    return { transform: [{ translateX: p.x * k - r0 }, { translateY: p.y * k - r0 }, { scale: view.s.value }] };
  }, [at.x, at.y, k, r0]);
  return <Animated.View pointerEvents="none" style={[styles.followRing, { width: r0 * 2, height: r0 * 2, borderRadius: r0 }, style]} />;
});

// When you are out of the frame (magnified somewhere else), a gold sign on its edge points at you;
// a touch on it flies there.
const YouPointer = memo(function YouPointer({ me, k, view, onPress }: { me: Pt; k: number; view: ViewShared; onPress: () => void }) {
  const style = useAnimatedStyle(() => {
    const p = youPointer({ s: view.s.value, a: view.a.value, x: view.x.value, y: view.y.value }, me, 20);
    if (!p) return { opacity: 0, transform: [{ translateX: -200 }, { translateY: -200 }, { rotate: '0rad' }] };
    // Out of the corner where the buttons are.
    const px = p.y < 52 && p.x > DESIGN_W - 130 ? DESIGN_W - 134 : p.x;
    return { opacity: 1, transform: [{ translateX: px * k - 17 }, { translateY: p.y * k - 17 }, { rotate: `${p.angle}rad` }] };
  }, [me.x, me.y, k]);
  return (
    <Animated.View style={[styles.pointer, style]}>
      <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Show my Eye')} style={styles.pointerHit}>
        <Svg width={34} height={34} viewBox="0 0 34 34">
          <Circle cx={17} cy={17} r={15} fill="rgba(8,14,20,0.82)" stroke="#C9A96A" strokeWidth={1.6} />
          <Path d="M12 10.5 L24 17 L12 23.5 L15 17 Z" fill="#E9CD8C" />
        </Svg>
      </Pressable>
    </Animated.View>
  );
});

// A Blink arriving: a ring leaves the Eye where it stands and its name is said.
function Pulse({ x, y, w, name, me, k, onDone, id }: { x: number; y: number; w: number; name: string; me: boolean; k: number; onDone: (id: number) => void; id: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) });
    const timer = setTimeout(() => onDone(id), 2500);
    return () => clearTimeout(timer);
  }, [p, onDone, id]);
  const base = Math.max(14, w * 0.9) * k;
  const ring = useAnimatedStyle(() => ({ opacity: 0.95 * (1 - p.value), transform: [{ scale: 0.6 + p.value * 3.2 }] }));
  const say = useAnimatedStyle(() => ({ opacity: p.value < 0.08 ? p.value / 0.08 : p.value < 0.8 ? 1 : Math.max(0, 1 - (p.value - 0.8) / 0.2) }));
  const tone = me ? colors.metal : '#7CF0FF';
  const right = x < DESIGN_W * 0.6;
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.ring, { left: x * k - base / 2, top: y * k - base / 2, width: base, height: base, borderRadius: base / 2, borderColor: tone }, ring]} />
      <Animated.View pointerEvents="none" style={[styles.saying, right ? { left: x * k + (w / 2 + 3) * k } : { right: (DESIGN_W - x) * k + (w / 2 + 3) * k }, { top: y * k - 8 * k }, say]}>
        <Text allowFontScaling={false} numberOfLines={1} style={{ color: me ? colors.metal : '#B6F7FF', fontFamily: font.semibold, fontSize: 9.5 * k, includeFontPadding: false }}>{name}</Text>
      </Animated.View>
    </>
  );
}

function ControlIcon({ kind }: { kind: 'plus' | 'minus' | 'home' }) {
  return (
    <Svg width={30} height={30} viewBox="0 0 30 30">
      <Circle cx={15} cy={15} r={14} fill="rgba(8,14,20,0.78)" stroke="rgba(120,200,225,0.38)" strokeWidth={1} />
      {kind === 'home' ? (
        <>
          <Path d="M20.5 11.2 A6.6 6.6 0 1 0 21.6 16.5" fill="none" stroke="#CFE2EF" strokeWidth={1.7} strokeLinecap="round" />
          <Path d="M17.4 10.6 L21.1 10.9 L20.3 7.2" fill="none" stroke="#CFE2EF" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <Line x1={9.5} y1={15} x2={20.5} y2={15} stroke="#CFE2EF" strokeWidth={1.8} strokeLinecap="round" />
          {kind === 'plus' ? <Line x1={15} y1={9.5} x2={15} y2={20.5} stroke="#CFE2EF" strokeWidth={1.8} strokeLinecap="round" /> : null}
        </>
      )}
    </Svg>
  );
}

type Mode = 'idle' | 'press' | 'loupe' | 'pan' | 'pinch' | 'page';

const sameView = (a: Viewport, b: Viewport) => Math.abs(a.s - b.s) < 1e-3 && Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(Math.atan2(Math.sin(a.a - b.a), Math.cos(a.a - b.a))) < 1e-3;

function useBaked(opacity: number): Baked {
  const s = useSharedValue(1), a = useSharedValue(0), x = useSharedValue(0), y = useSharedValue(0), o = useSharedValue(opacity);
  return useMemo(() => ({ s, a, x, y, o }), [s, a, x, y, o]);
}

export const MassWorld = memo(function MassWorld({ world, eyes, pulses, arcs, highlight, fly, onPick }: {
  world: IrisWorld;
  eyes: WorldEye[];
  // serial -> a counter that grows with each of their Blinks on the stream.
  pulses: Record<number, number>;
  // Serials of the people who looked at you today.
  arcs: number[];
  // An Eye to ring for a moment (from "Around you" or "Find an Eye").
  highlight: number | null;
  // Fly to somebody: a new `nonce` is a new flight.
  fly: { serial: number; nonce: number } | null;
  onPick: (serial: number) => void;
}) {
  const { width: windowW } = useWindowDimensions();
  const [boxW, setBoxW] = useState(Math.max(260, windowW - 32));
  const k = boxW / DESIGN_W;
  const kRef = useRef(k);
  kRef.current = k;
  const setLocked = useContext(ScrollLockContext);

  const { items } = world;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const eyesRef = useRef(eyes);
  eyesRef.current = eyes;
  const bySerial = useMemo(() => new Map(items.map((it) => [it.eye.serial, it])), [items]);
  // Everybody, as drawn at home and in the loupe.
  const full = useMemo(() => eyeBatches(items), [items]);
  const fullRef = useRef(full);
  fullRef.current = full;
  const meIt = useMemo(() => items.find((it) => it.eye.me) ?? null, [items]);
  const arcItems = useMemo(() => arcs.map((s) => bySerial.get(s)).filter((it): it is Placed => Boolean(it)).slice(0, 5), [arcs, bySerial]);

  // The viewport, the names laid out for it, and the two layers.
  const [plan, setPlan] = useState<ViewPlan>(() => planViewLabels(items, eyes, IDENTITY, { reserved: RESERVED }));
  const [look, setLook] = useState({ s: 1, home: true });
  const planTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleRef = useRef<() => void>(() => undefined);
  const viewport = useViewport(() => settleRef.current());
  const view = viewport.view;
  const bakedA = useBaked(1);
  const bakedB = useBaked(HIDDEN);
  const layerValues = useMemo(() => [bakedA, bakedB] as const, [bakedA, bakedB]);
  const [layers, setLayers] = useState<[Layer, Layer]>(() => [{ baked: IDENTITY, batches: full.batches, blooms: full.blooms }, { baked: IDENTITY, batches: [], blooms: [] }]);
  const front = useRef(0);
  const swapping = useRef(false);
  const dirty = useRef(false);
  const drawnFor = useRef<{ view: Viewport; items: ReadonlyArray<Placed> }>({ view: IDENTITY, items });

  const replan = useCallback((delay: number) => {
    if (planTimer.current) {
      if (delay > 0) return;
      clearTimeout(planTimer.current);
    }
    planTimer.current = setTimeout(() => {
      planTimer.current = null;
      const v = view.current;
      setPlan(planViewLabels(itemsRef.current, eyesRef.current, v, { reserved: RESERVED }));
      setLook((cur) => (cur.s === v.s && cur.home === isHome(v) ? cur : { s: v.s, home: isHome(v) }));
    }, delay);
  }, [view]);

  // Draw a fresh picture for where the viewport is now, in the layer that is out of sight, wait for it
  // to be drawn, crossfade, and swap the layers' roles. A change that arrives meanwhile waits its turn.
  const bake = useCallback(() => {
    bakeTimer.current = null;
    if (viewport.busy()) { bakeTimer.current = setTimeout(() => bake(), 120); return; }
    if (swapping.current) { dirty.current = true; return; }
    const v = view.current;
    const shown = drawnFor.current;
    if (!dirty.current && sameView(shown.view, v) && shown.items === itemsRef.current) return;
    dirty.current = false;
    const h = 1 - front.current;
    const home = v.s === 1 && v.a === 0 && v.x === 0 && v.y === 0;
    const picture = home ? fullRef.current : eyeBatches(cullItems(itemsRef.current, v));
    const a = viewport.angle.current;
    const values = layerValues[h]!;
    values.s.value = v.s; values.a.value = a; values.x.value = v.x; values.y.value = v.y; values.o.value = HIDDEN;
    const next: Layer = { baked: { ...v, a }, batches: picture.batches, blooms: picture.blooms };
    setLayers((cur) => (h === 0 ? [next, cur[1]] : [cur[0], next]));
    swapping.current = true;
    drawnFor.current = { view: v, items: itemsRef.current };
    const wait = Math.min(560, 150 + picture.batches.length * 2.4);
    setTimeout(() => {
      const o = { duration: 170, easing: Easing.out(Easing.quad) };
      layerValues[h]!.o.value = withTiming(1, o);
      layerValues[1 - h]!.o.value = withTiming(0, o);
      setTimeout(() => {
        front.current = h;
        swapping.current = false;
        if (dirty.current || !sameView(drawnFor.current.view, view.current) || drawnFor.current.items !== itemsRef.current) { bakeTimer.current = setTimeout(() => bake(), 40); }
      }, 210);
    }, wait);
  }, [layerValues, view, viewport]);

  // Whenever the viewport changes: lay the names out again, and, once it has rested, draw it anew.
  // The timers call the drawing through a ref, and the effect below does not depend on it: the
  // effect re-plans and re-draws, so if it ran whenever `bake` was a new function it would feed itself.
  const bakeRef = useRef(bake);
  bakeRef.current = bake;
  settleRef.current = () => {
    replan(200);
    if (bakeTimer.current) clearTimeout(bakeTimer.current);
    bakeTimer.current = setTimeout(() => bakeRef.current(), 180);
  };
  const firstItems = useRef(true);
  useEffect(() => {
    replan(0);
    if (firstItems.current) { firstItems.current = false; return; }
    if (bakeTimer.current) clearTimeout(bakeTimer.current);
    bakeTimer.current = setTimeout(() => bakeRef.current(), 60);
  }, [items, eyes, replan]);
  useEffect(() => () => { if (planTimer.current) clearTimeout(planTimer.current); if (bakeTimer.current) clearTimeout(bakeTimer.current); }, []);

  // ---- the loupe (at rest only) ----
  const [touch, setTouch] = useState<Pt | null>(null);
  const atRest = () => { const v = view.current; return v.s === 1 && v.a === 0 && v.x === 0 && v.y === 0; };

  // ---- fingers ----
  const gs = useRef({ mode: 'idle' as Mode, locked: false, start: { x: 0, y: 0 } as Pt, last: { x: 0, y: 0 } as Pt, anchor: { x: 0, y: 0 } as Pt, base: IDENTITY, d0: 1, phi0: 0, hold: null as ReturnType<typeof setTimeout> | null }).current;
  const stopHold = () => { if (gs.hold) { clearTimeout(gs.hold); gs.hold = null; } };
  const lock = (on: boolean) => { if (gs.locked !== on) { gs.locked = on; setLocked(on); } };
  useEffect(() => () => { stopHold(); if (gs.locked) { gs.locked = false; setLocked(false); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pointOf = (touchPoint: { locationX: number; locationY: number }): Pt => ({ x: touchPoint.locationX / kRef.current, y: touchPoint.locationY / kRef.current });

  const pickAt = useCallback((x: number, y: number, how: 'tap' | 'release') => {
    const v = view.current;
    let hit: Placed | null = null;
    if (how === 'tap') {
      hit = pickOnScreen(itemsRef.current, v, x, y, 5);
      if (!hit) { const c = closestOnScreen(itemsRef.current, v, x, y); if (c && c.d < 18) hit = c.it; }
    } else hit = closestOnScreen(itemsRef.current, v, x, y)?.it ?? null;
    if (hit) onPick(hit.eye.serial);
  }, [onPick, view]);

  const beginPinch = (touches: ReadonlyArray<{ locationX: number; locationY: number }>) => {
    const a = pointOf(touches[0]!), b = pointOf(touches[1]!);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    stopHold();
    if (gs.mode === 'loupe') setTouch(null);
    gs.mode = 'pinch';
    gs.base = view.current;
    gs.anchor = unproject(gs.base, mid.x, mid.y);
    gs.d0 = Math.max(24, Math.hypot(b.x - a.x, b.y - a.y));
    gs.phi0 = Math.atan2(b.y - a.y, b.x - a.x);
    lock(true);
  };
  const movePinch = (touches: ReadonlyArray<{ locationX: number; locationY: number }>) => {
    const a = pointOf(touches[0]!), b = pointOf(touches[1]!);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = Math.max(24, Math.hypot(b.x - a.x, b.y - a.y));
    const turn = turnOf(Math.atan2(b.y - a.y, b.x - a.x) - gs.phi0);
    viewport.set(viewFor(gs.base, gs.anchor, mid, d / gs.d0, turn));
  };
  const beginPan = (p: Pt) => {
    gs.mode = 'pan';
    gs.base = view.current;
    gs.anchor = unproject(gs.base, p.x, p.y);
    gs.last = p;
    lock(true);
  };

  const responder = {
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => gs.mode === 'idle' || gs.mode === 'press' || gs.mode === 'page',
    onResponderGrant: (event: GestureResponderEvent) => {
      const touches = event.nativeEvent.touches;
      viewport.snap();
      stopHold();
      if (touches.length >= 2) { beginPinch(touches); return; }
      const first = touches[0] ?? event.nativeEvent;
      const p = pointOf(first);
      gs.mode = 'press';
      gs.start = p; gs.last = p;
      gs.base = view.current;
      if (!isHome(view.current)) lock(true);
      if (atRest()) {
        gs.hold = setTimeout(() => {
          gs.hold = null;
          if (gs.mode !== 'press' || !atRest()) return;
          gs.mode = 'loupe';
          lock(true);
          void Haptics.selectionAsync();
          setTouch(gs.last);
        }, HOLD_MS);
      }
    },
    onResponderMove: (event: GestureResponderEvent) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        if (gs.mode !== 'pinch') beginPinch(touches);
        movePinch(touches);
        return;
      }
      const first = touches[0];
      if (!first) return;
      const p = pointOf(first);
      if (gs.mode === 'pinch') { beginPan(p); return; }   // one finger lifted: the other carries on dragging
      if (gs.mode === 'loupe') { gs.last = p; setTouch(p); return; }
      if (gs.mode === 'pan') {
        gs.last = p;
        viewport.set(viewFor(gs.base, gs.anchor, p, 1, 0));
        return;
      }
      if (gs.mode === 'press') {
        gs.last = p;
        if (Math.hypot(p.x - gs.start.x, p.y - gs.start.y) > SLOP) {
          stopHold();
          if (!isHome(view.current)) beginPan(p);
          else { gs.mode = 'page'; lock(false); }          // not magnified: the page scrolls
        }
      }
    },
    onResponderRelease: () => finish(true),
    onResponderTerminate: () => finish(false),
  };
  const finish = (tapped: boolean) => {
    stopHold();
    const mode = gs.mode;
    gs.mode = 'idle';
    if (mode === 'loupe') { setTouch(null); if (tapped) pickAt(gs.last.x, gs.last.y, 'release'); }
    else if (mode === 'press' && tapped) pickAt(gs.last.x, gs.last.y, 'tap');
    else if (mode === 'pan' || mode === 'pinch') {
      const v = view.current, next = settled(v);
      if (next !== v) viewport.set(next, 180);
      else settleRef.current();
    }
    lock(false);
  };

  // Blinks heard on the stream: a ring and a name where the Eye stands now.
  const seen = useRef<Record<number, number>>(pulses);
  const ringId = useRef(0);
  const [rings, setRings] = useState<Array<{ id: number; x: number; y: number; w: number; name: string; me: boolean }>>([]);
  useEffect(() => {
    const before = seen.current;
    const fresh: Array<{ id: number; x: number; y: number; w: number; name: string; me: boolean }> = [];
    for (const [key, count] of Object.entries(pulses)) {
      const serial = Number(key);
      if ((before[serial] ?? 0) === count) continue;
      const it = bySerial.get(serial);
      if (!it) continue;
      const p = project(view.current, it.x, it.y);
      if (p.x < 0 || p.x > DESIGN_W || p.y < 0 || p.y > IRIS_H) continue;
      ringId.current += 1;
      fresh.push({ id: ringId.current, x: p.x, y: p.y, w: it.w * view.current.s, name: it.eye.name, me: it.eye.me });
    }
    seen.current = pulses;
    if (fresh.length) setRings((current) => [...current, ...fresh.slice(0, 5)].slice(-8));
  }, [pulses, bySerial, view]);
  const done = useCallback((id: number) => setRings((current) => current.filter((r) => r.id !== id)), []);

  const hiIt = highlight != null ? bySerial.get(highlight) ?? null : null;

  // A flight to somebody a person asked to see.
  const flown = useRef(0);
  useEffect(() => {
    if (!fly || fly.nonce === flown.current) return;
    flown.current = fly.nonce;
    const it = bySerial.get(fly.serial);
    if (it) viewport.set(focusOn(view.current, it, 3.2), 520);
  }, [fly, bySerial, viewport, view]);

  const zoomStep = (factor: number) => {
    void Haptics.selectionAsync();
    viewport.snap();
    viewport.set(settled(zoomed(view.current, factor)), 240);
  };
  const goHome = () => { void Haptics.selectionAsync(); viewport.snap(); viewport.set(IDENTITY, 320); };
  const toMe = () => { if (meIt) { void Haptics.selectionAsync(); viewport.set(focusOn(view.current, meIt, Math.max(view.current.s, 2.2)), 520); } };

  // The loupe, above the finger (below it when the finger is near the top). It is magnetic: it
  // centres on the Eye nearest the finger, so there is always an Eye in its crosshair and its
  // name is written beside it; lifting the finger opens that Eye.
  const snapped = useRef<number | null>(null);
  const lens = useMemo(() => {
    if (!touch) return null;
    const lcx = Math.max(RL + 4, Math.min(DESIGN_W - RL - 4, touch.x));
    let lcy = touch.y - 74;
    if (lcy < RL + 4) lcy = touch.y + 74;
    lcy = Math.max(RL + 4, Math.min(IRIS_H - RL - 4, lcy));
    const c = closest(items, touch.x, touch.y);
    const near = c && Math.hypot(c.x - touch.x, c.y - touch.y) < 34 ? c : null;
    const fx = near ? near.x : touch.x, fy = near ? near.y : touch.y;
    return { lcx, lcy, fx, fy, near, names: loupeNames(items, fx, fy, lcx, lcy, ZOOM, RL) };
  }, [touch, items]);
  useEffect(() => {
    const serial = lens?.near?.eye.serial ?? null;
    if (serial !== snapped.current) { snapped.current = serial; if (serial != null) void Haptics.selectionAsync(); }
  }, [lens]);

  return (
    <View style={styles.frame}>
      <View
        style={[styles.field, { aspectRatio: DESIGN_W / IRIS_H }]}
        onLayout={(event) => setBoxW(event.nativeEvent.layout.width)}
        {...responder}
      >
        <Sky />
        <View pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel={t('{count} Eyes are watching', { count: items.length })} style={StyleSheet.absoluteFill}>
          <SceneLayer layer={layers[0]} world={world} me={meIt} arcs={arcItems} k={k} view={viewport.shared} baked={layerValues[0]} />
          <SceneLayer layer={layers[1]} world={world} me={meIt} arcs={arcItems} k={k} view={viewport.shared} baked={layerValues[1]} />
        </View>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {hiIt ? <FollowRing at={{ x: hiIt.x, y: hiIt.y }} w={hiIt.w} k={k} view={viewport.shared} /> : null}
          {plan.labels.map((label) => <FollowLabel key={label.serial} label={label} k={k} view={viewport.shared} />)}
          {plan.youTag ? <FollowTag tag={plan.youTag} k={k} view={viewport.shared} /> : null}
          {rings.map((r) => <Pulse key={r.id} id={r.id} x={r.x} y={r.y} w={r.w} name={r.name} me={r.me} k={k} onDone={done} />)}
        </View>
        {meIt ? <YouPointer me={{ x: meIt.x, y: meIt.y }} k={k} view={viewport.shared} onPress={toMe} /> : null}
        <View style={styles.controls} pointerEvents="box-none">
          {look.home ? null : (
            <Pressable onPress={goHome} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('Reset the view')}><ControlIcon kind="home" /></Pressable>
          )}
          <Pressable onPress={() => zoomStep(1 / 1.7)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('Zoom out')}><ControlIcon kind="minus" /></Pressable>
          <Pressable onPress={() => zoomStep(1.7)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('Zoom in')}><ControlIcon kind="plus" /></Pressable>
        </View>
        {look.s >= ZOOMED ? (
          <View pointerEvents="none" style={styles.readout}>
            <Text allowFontScaling={false} style={styles.readoutText}>{`${look.s.toFixed(look.s < 10 ? 1 : 0)}×`}</Text>
          </View>
        ) : null}
        {lens ? (
          <View pointerEvents="none" style={[styles.lens, { left: (lens.lcx - RL) * k, top: (lens.lcy - RL) * k, width: RL * 2 * k, height: RL * 2 * k, borderRadius: RL * k }]}>
            <Svg width="100%" height="100%" viewBox={`0 0 ${RL * 2} ${RL * 2}`}>
              <Gradients />
              <LinearGradientRim />
              <Rect x={0} y={0} width={RL * 2} height={RL * 2} fill="#04080D" />
              <G transform={`translate(${RL} ${RL}) scale(${ZOOM}) translate(${-lens.fx} ${-lens.fy})`}>
                <EyesLayer batches={full.batches} blooms={full.blooms} />
                {meIt ? <MeEye it={meIt} cx={world.cx} cy={world.cy} /> : null}
              </G>
              <Circle cx={RL} cy={RL} r={RL - 0.7} fill="none" stroke="url(#lens-rim)" strokeWidth={1.4} />
            </Svg>
            {lens.names.map((n, i) => (
              <View key={`${n.text}${i}`} pointerEvents="none" style={[styles.lensName, { left: (n.box.x - (lens.lcx - RL)) * k, top: (n.box.y - (lens.lcy - RL)) * k, height: n.box.h * k }]}>
                <Text allowFontScaling={false} numberOfLines={1} style={{ color: n.me ? colors.metal : '#F2F7FB', fontFamily: font.semibold, fontSize: 9.5 * k, includeFontPadding: false }}>{n.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {lens?.near ? <View pointerEvents="none" style={[styles.cross, { left: (lens.near.x - lens.near.w * 0.6 - 3) * k, top: (lens.near.y - lens.near.w * 0.6 - 3) * k, width: (lens.near.w * 1.2 + 6) * k, height: (lens.near.w * 1.2 + 6) * k, borderRadius: (lens.near.w * 0.6 + 3) * k }]} /> : null}
      </View>
      <Legend />
    </View>
  );
});

const LinearGradientRim = memo(function LinearGradientRim() {
  return (
    <Defs>
      <LinearGradient id="lens-rim" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#96DCF0" stopOpacity="0.8" />
        <Stop offset="1" stopColor="#56E0FF" stopOpacity="0.5" />
      </LinearGradient>
    </Defs>
  );
});

// Gold to cyan: the colour of a streak, read from the pupil to the rim.
export function Legend() {
  const a = rampRGB(0), b = rampRGB(0.4), c = rampRGB(1);
  const hex = (v: number[]) => `#${v.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  return (
    <View style={styles.legend} pointerEvents="none">
      <Text allowFontScaling={false} style={[styles.legendText, { color: colors.metal }]}>{t('{count} days', { count: '30+' })}</Text>
      <Svg width={104} height={4} viewBox="0 0 104 4">
        <Defs>
          <LinearGradient id="lg-ramp" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={hex(a)} />
            <Stop offset="0.4" stopColor={hex(b)} />
            <Stop offset="1" stopColor={hex(c)} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={104} height={3.5} rx={1.75} fill="url(#lg-ramp)" opacity={0.9} />
      </Svg>
      <Text allowFontScaling={false} style={[styles.legendText, { color: colors.accent }]}>{t('1 day')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(17, 27, 36, 0.9)', backgroundColor: 'rgba(8, 15, 22, 0.55)' },
  field: { width: '100%' },
  layer: { position: 'absolute' },
  labelRow: { position: 'absolute', left: 0, top: 0, justifyContent: 'center' },
  plate: { backgroundColor: 'rgba(3, 6, 10, 0.82)', justifyContent: 'center', alignItems: 'center' },
  plateMe: { borderWidth: 0.8, borderColor: 'rgba(201, 169, 106, 0.6)' },
  you: { position: 'absolute', left: 0, top: 0, backgroundColor: colors.metal, justifyContent: 'center', alignItems: 'center' },
  followRing: { position: 'absolute', left: 0, top: 0, borderWidth: 1.4, borderColor: '#F2F7FB' },
  pointer: { position: 'absolute', left: 0, top: 0, width: 34, height: 34 },
  pointerHit: { width: 34, height: 34 },
  ring: { position: 'absolute', borderWidth: 1.5 },
  saying: { position: 'absolute', backgroundColor: 'rgba(3, 6, 10, 0.82)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  controls: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 6 },
  readout: { position: 'absolute', top: 10, left: 12, backgroundColor: 'rgba(3, 6, 10, 0.7)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  readoutText: { color: colors.muted, fontFamily: font.monoSemibold, fontSize: 10.5, fontVariant: ['tabular-nums'] },
  lens: { position: 'absolute', overflow: 'hidden', backgroundColor: '#04080D' },
  lensName: { position: 'absolute', backgroundColor: 'rgba(3, 6, 10, 0.82)', paddingHorizontal: 3, borderRadius: 3, justifyContent: 'center' },
  cross: { position: 'absolute', borderWidth: 1.2, borderColor: 'rgba(150, 220, 240, 0.9)' },
  legend: { position: 'absolute', left: 0, right: 0, bottom: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  legendText: { fontFamily: font.medium, fontSize: 8.5 },
});
