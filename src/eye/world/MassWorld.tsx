import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { t } from '../../i18n';
import { colors, font } from '../../theme';
import {
  DESIGN_W, IRIS_H, RAMP_BUCKETS, almondD, bucketColor, bucketHex, closest, discD, eyeBatches, hash, loupeNames, nearest, rampRGB,
  type Batch, type Bloom, type IrisWorld, type Label, type LabelPlan, type Placed,
} from './geometry';

// The Iris: every Eye of the network at once, as one eye made of eyes (01.10,
// Alex: the stair at five hundred shows thirty-six people). The layout, the
// labels and the loupe come from geometry.ts; this file draws them.
//
// Nothing here moves by itself. An Eye stands where its mint number put it
// and brightens when it blinks; a Blink arriving on the stream rings the Eye
// where it stands and says its name for a moment. A touch that stays still
// for a beat opens the loupe: the Eyes under the finger grow and read their
// names, and lifting the finger opens the one in the crosshair. A quick tap
// opens the nearest Eye. A drag that starts before the beat is the page's
// own scroll: the world only holds on to a touch once the loupe is open.

const RL = 46;       // the loupe's radius, in world units
const ZOOM = 3;
const HOLD_MS = 260;

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

const Backdrop = memo(function Backdrop({ world }: { world: IrisWorld }) {
  const { cx, cy, R, rOut } = world;
  return (
    <>
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
      {STARS.map((s, i) => <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#D8F4FF" opacity={s.a} />)}
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

function LabelView({ label, k }: { label: Label; k: number }) {
  const { box, side, tone, text, size } = label;
  const color = tone === 'me' ? colors.metal : tone === 'gold' ? '#E8CF95' : '#E4EEF6';
  // A wide row with the plate hugging the text inside it: the estimated box
  // only says where the plate is anchored, never how wide the text may be.
  const W = 320;
  const at = side === 'right' ? { left: box.x * k, alignItems: 'flex-start' as const }
    : side === 'left' ? { left: (box.x + box.w) * k - W, alignItems: 'flex-end' as const }
      : { left: (box.x + box.w / 2) * k - W / 2, alignItems: 'center' as const };
  return (
    <View pointerEvents="none" style={[styles.labelRow, at, { top: box.y * k, height: box.h * k, width: W }]}>
      <View style={[styles.plate, tone === 'me' && styles.plateMe, { borderRadius: 3.2 * k, paddingHorizontal: 3 * k, height: box.h * k }]}>
        <Text allowFontScaling={false} numberOfLines={1} style={{ color, fontFamily: tone === 'me' ? font.semibold : font.medium, fontSize: size * k, lineHeight: size * k * 1.25, includeFontPadding: false }}>{text}</Text>
      </View>
    </View>
  );
}

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

export const MassWorld = memo(function MassWorld({ world, plan, pulses, arcs, highlight, onPick }: {
  world: IrisWorld;
  plan: LabelPlan;
  // serial -> a counter that grows with each of their Blinks on the stream.
  pulses: Record<number, number>;
  // Serials of the people who looked at you today.
  arcs: number[];
  // An Eye to ring and name for a moment (from the rail or from Find).
  highlight: number | null;
  onPick: (serial: number) => void;
}) {
  const { width: windowW } = useWindowDimensions();
  const [boxW, setBoxW] = useState(Math.max(260, windowW - 32));
  const k = boxW / DESIGN_W;
  const kRef = useRef(k);
  kRef.current = k;

  const { items } = world;
  const bySerial = useMemo(() => new Map(items.map((it) => [it.eye.serial, it])), [items]);
  const { batches, blooms } = useMemo(() => eyeBatches(items), [items]);
  const meIt = useMemo(() => items.find((it) => it.eye.me) ?? null, [items]);
  const arcItems = useMemo(() => arcs.map((s) => bySerial.get(s)).filter((it): it is Placed => Boolean(it)).slice(0, 5), [arcs, bySerial]);

  // Touch. The loupe opens after a still beat; before that the page may scroll.
  const [touch, setTouch] = useState<{ x: number; y: number } | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loupe = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const first = useRef({ x: 0, y: 0 });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const point = (event: GestureResponderEvent) => ({ x: event.nativeEvent.locationX / kRef.current, y: event.nativeEvent.locationY / kRef.current });
  const stopHold = () => { if (hold.current) { clearTimeout(hold.current); hold.current = null; } };
  const pickAt = useCallback((x: number, y: number, tap: boolean) => {
    const it = tap ? (nearest(itemsRef.current, x, y, 5) ?? (() => { const c = closest(itemsRef.current, x, y); return c && Math.hypot(c.x - x, c.y - y) < 18 ? c : null; })()) : closest(itemsRef.current, x, y);
    if (it) onPick(it.eye.serial);
  }, [onPick]);
  const responder = {
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => !loupe.current,
    onResponderGrant: (event: GestureResponderEvent) => {
      const p = point(event);
      first.current = p; last.current = p;
      stopHold();
      hold.current = setTimeout(() => { hold.current = null; loupe.current = true; void Haptics.selectionAsync(); setTouch(last.current); }, HOLD_MS);
    },
    onResponderMove: (event: GestureResponderEvent) => {
      const p = point(event);
      last.current = p;
      if (loupe.current) setTouch(p);
      else if (Math.hypot(p.x - first.current.x, p.y - first.current.y) > 10) stopHold();
    },
    onResponderRelease: () => {
      stopHold();
      const p = last.current;
      const moved = Math.hypot(p.x - first.current.x, p.y - first.current.y);
      if (loupe.current) { loupe.current = false; setTouch(null); pickAt(p.x, p.y, false); }
      else if (moved <= 10) pickAt(p.x, p.y, true);
    },
    onResponderTerminate: () => { stopHold(); loupe.current = false; setTouch(null); },
  };
  useEffect(() => stopHold, []);

  // Blinks heard on the stream: a ring and a name where the Eye stands.
  const seen = useRef<Record<number, number>>(pulses);
  const ringId = useRef(0);
  const [rings, setRings] = useState<Array<{ id: number; it: Placed }>>([]);
  useEffect(() => {
    const before = seen.current;
    const fresh: Array<{ id: number; it: Placed }> = [];
    for (const [key, count] of Object.entries(pulses)) {
      const serial = Number(key);
      if ((before[serial] ?? 0) === count) continue;
      const it = bySerial.get(serial);
      if (it) { ringId.current += 1; fresh.push({ id: ringId.current, it }); }
    }
    seen.current = pulses;
    if (fresh.length) setRings((current) => [...current, ...fresh.slice(0, 5)].slice(-8));
  }, [pulses, bySerial]);
  const done = useCallback((id: number) => setRings((current) => current.filter((r) => r.id !== id)), []);

  const hiIt = highlight != null ? bySerial.get(highlight) ?? null : null;

  // The loupe, above the finger (below it when the finger is near the top).
  // It is magnetic: it centres on the Eye nearest the finger, so there is
  // always an Eye in its crosshair and its name is written beside it; lifting
  // the finger opens that Eye.
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
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('{count} Eyes are watching', { count: items.length })}
        style={[styles.field, { aspectRatio: DESIGN_W / IRIS_H }]}
        onLayout={(event) => setBoxW(event.nativeEvent.layout.width)}
        {...responder}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${DESIGN_W} ${IRIS_H}`}>
            <Backdrop world={world} />
            <EyesLayer batches={batches} blooms={blooms} />
            <LookArcs from={arcItems} me={meIt} />
            {meIt ? <MeEye it={meIt} cx={world.cx} cy={world.cy} /> : null}
            {hiIt ? <Circle cx={hiIt.x} cy={hiIt.y} r={hiIt.w * 0.9 + 4} fill="none" stroke="#F2F7FB" strokeWidth={1.4} /> : null}
          </Svg>
        </View>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {plan.labels.map((label, i) => <LabelView key={`${label.text}${i}`} label={label} k={k} />)}
          {plan.youTag ? (
            <View style={[styles.you, { left: plan.youTag.x * k, top: plan.youTag.y * k + 1.5 * k, height: 12 * k, paddingHorizontal: 5.5 * k, borderRadius: 6 * k }]}>
              <Text allowFontScaling={false} style={{ color: '#191307', fontFamily: font.bold, fontSize: 8.2 * k, includeFontPadding: false, letterSpacing: 0.3 }}>{t('you')}</Text>
            </View>
          ) : null}
          {hiIt ? <LabelView label={{ text: hiIt.eye.name, size: 10, box: { x: Math.max(4, Math.min(DESIGN_W - 120, hiIt.x - 50)), y: Math.max(4, hiIt.y - hiIt.w * 0.9 - 24), w: 100, h: 14.5 }, side: 'below', tone: hiIt.eye.me ? 'me' : 'plain', ring: null, leader: null }} k={k} /> : null}
          {rings.map((r) => <Pulse key={r.id} id={r.id} x={r.it.x} y={r.it.y} w={r.it.w} name={r.it.eye.name} me={r.it.eye.me} k={k} onDone={done} />)}
        </View>
        {lens ? (
          <View pointerEvents="none" style={[styles.lens, { left: (lens.lcx - RL) * k, top: (lens.lcy - RL) * k, width: RL * 2 * k, height: RL * 2 * k, borderRadius: RL * k }]}>
            <Svg width="100%" height="100%" viewBox={`0 0 ${RL * 2} ${RL * 2}`}>
              <Defs>
                {Array.from({ length: RAMP_BUCKETS + 1 }, (_, b) => (
                  <RadialGradient key={b} id={`gl-${b}`} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
                    <Stop offset="0.3" stopColor={bucketHex(b)} stopOpacity="0.3" />
                    <Stop offset="1" stopColor={bucketHex(b)} stopOpacity="0" />
                  </RadialGradient>
                ))}
                <RadialGradient id="g-gold" cx="0.5" cy="0.5" rx="0.5" ry="0.5">
                  <Stop offset="0.25" stopColor="#C9A96A" stopOpacity="0.42" />
                  <Stop offset="1" stopColor="#C9A96A" stopOpacity="0" />
                </RadialGradient>
                <LinearGradient id="lens-rim" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor="#96DCF0" stopOpacity="0.8" />
                  <Stop offset="1" stopColor="#56E0FF" stopOpacity="0.5" />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width={RL * 2} height={RL * 2} fill="#04080D" />
              <G transform={`translate(${RL} ${RL}) scale(${ZOOM}) translate(${-lens.fx} ${-lens.fy})`}>
                <EyesLayer batches={batches} blooms={blooms} />
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
        {lens ? <View pointerEvents="none" style={[styles.cross, lens.near ? { left: (lens.near.x - lens.near.w * 0.6 - 3) * k, top: (lens.near.y - lens.near.w * 0.6 - 3) * k, width: (lens.near.w * 1.2 + 6) * k, height: (lens.near.w * 1.2 + 6) * k, borderRadius: (lens.near.w * 0.6 + 3) * k } : { left: touch!.x * k - 4, top: touch!.y * k - 4 }]} /> : null}
      </View>
      <Legend />
    </View>
  );
});

// Gold to cyan: the colour of a streak, read from the pupil to the rim.
export function Legend() {
  const a = rampRGB(0), b = rampRGB(0.4), c = rampRGB(1);
  const hex = (v: number[]) => `#${v.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  return (
    <View style={styles.legend}>
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
  labelRow: { position: 'absolute', justifyContent: 'center' },
  plate: { backgroundColor: 'rgba(3, 6, 10, 0.82)', justifyContent: 'center', alignItems: 'center' },
  plateMe: { borderWidth: 0.8, borderColor: 'rgba(201, 169, 106, 0.6)' },
  you: { position: 'absolute', backgroundColor: colors.metal, justifyContent: 'center', alignItems: 'center' },
  ring: { position: 'absolute', borderWidth: 1.5 },
  saying: { position: 'absolute', backgroundColor: 'rgba(3, 6, 10, 0.82)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  lens: { position: 'absolute', overflow: 'hidden', backgroundColor: '#04080D' },
  lensName: { position: 'absolute', backgroundColor: 'rgba(3, 6, 10, 0.82)', paddingHorizontal: 3, borderRadius: 3, justifyContent: 'center' },
  cross: { position: 'absolute', width: 8, height: 8, borderRadius: 4, borderWidth: 1.2, borderColor: 'rgba(150, 220, 240, 0.9)' },
  legend: { position: 'absolute', left: 0, right: 0, bottom: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  legendText: { fontFamily: font.medium, fontSize: 8.5 },
});
