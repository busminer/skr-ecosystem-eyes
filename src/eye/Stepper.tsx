import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { Easing, ZoomIn, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { t } from '../i18n';
import { Eyebrow, Panel } from '../lab/kit';
import { colors, font, spacing, type } from '../theme';
import { Glyph, Overline, type GlyphName } from './glyphs';

// A stepper: the one way this app shows a thing that takes several steps and
// real time, so a person is never left with a spinner and a guess.
//
// Every step is a row: a station on a rail down the left, and a card. The
// card carries the step's name, and while the step runs, one plain sentence
// saying what the phone is doing right now and a bar sweeping under it. When
// the step ends the bar fills to the end, the ring on the rail becomes a
// check, and what was found is revealed under the name: a key fingerprint, a
// model, a mint, a signature. A step that has not started yet is a muted name
// and a dot. One that failed is the same card edged red, with the words of
// whoever refused. At the top: "Step 2 of 4" and one segment per step.
//
// The steps are driven by the caller's real events, never by a clock alone.
// The one thing the clock adds is a beat between transitions, through
// `usePaced`: a check lands, four hundred milliseconds pass, the next ring
// starts turning. Fast enough to feel live, slow enough for an eye to follow.
// Reduced motion: no ring, no sweep, no beat, and the cards fill in as the
// data lands.

export type StepStatus = 'pending' | 'working' | 'done' | 'failed' | 'stopped';

// What went wrong, in words the person can act on. `title` is the sentence
// that was actually said, by the attestor, the server or the wallet.
export type Failure = { title: string; body: string | null; detail: string | null };

export type StepModel = {
  key: string;
  // The step's name; what was found may replace it once the step is done.
  title: string;
  // The step's glyph (src/eye/glyphs.tsx): the same drawing the walk-through
  // of the Eye showed next to this step, so the person recognises it.
  icon?: GlyphName;
  // The short name the walk-through used for this step, when the title is a
  // sentence that changes as the step runs; shown small above the title.
  name?: string;
  // One line, present tense: what the phone is doing right now.
  copy: string | null;
  status: StepStatus;
  // Revealed under the name once the step is done.
  result?: ReactNode;
  // Shown on a failed or stopped step.
  failure?: Failure | null;
};

// The beat between two transitions the eye is meant to catch.
export const BEAT_MS = 400;
const TURN_MS = 900;
const SWEEP_MS = 1_100;
const FILL_MS = 320;
const STATION = 20;

export const shorten = (value: string, edge = 6) => (value.length > edge * 2 + 1 ? `${value.slice(0, edge)}…${value.slice(-edge)}` : value);

// A key as a fingerprint a person can compare by eye: first and last pairs
// of the compressed point, grouped in fours.
export function keyFingerprint(p256: string): string {
  const hex = p256.toLowerCase();
  return `${hex.slice(0, 4)} ${hex.slice(4, 8)} ${hex.slice(8, 12)} … ${hex.slice(-12, -8)} ${hex.slice(-8, -4)} ${hex.slice(-4)}`;
}

// Display transitions, applied in the order they were pushed and never
// closer together than `beat`. The work itself runs at its own pace; only
// what the screen shows is spaced out, and only ever by a beat or two.
export function usePaced(beat: number) {
  const queue = useRef<Array<() => void>>([]);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pump = useCallback(() => {
    if (timer.current || queue.current.length === 0) return;
    const wait = Math.max(0, last.current + beat - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      const next = queue.current.shift();
      last.current = Date.now();
      next?.();
      pump();
    }, wait);
  }, [beat]);
  const push = useCallback((fn: () => void) => {
    queue.current.push(fn);
    pump();
  }, [pump]);
  const clear = useCallback(() => {
    queue.current = [];
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    last.current = 0;
  }, []);
  useEffect(() => clear, [clear]);
  // One object for the life of the component: callers hang effects on it.
  return useMemo(() => ({ push, clear }), [push, clear]);
}

export function Stepper({ steps, reduced, eyebrow }: { steps: StepModel[]; reduced: boolean; eyebrow?: string }) {
  const total = steps.length;
  const open = steps.findIndex((step) => step.status !== 'done');
  const current = open === -1 ? total : open + 1;
  return (
    <View style={styles.stepper}>
      <View style={styles.head}>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : <View />}
        <Eyebrow tone={colors.muted}>{t('Step {step} of {total}', { step: current, total })}</Eyebrow>
      </View>
      <View style={styles.segments}>
        {steps.map((step) => (
          <View
            key={step.key}
            style={[
              styles.segment,
              step.status === 'done' && { backgroundColor: colors.positive },
              step.status === 'working' && { backgroundColor: colors.accentDim },
              step.status === 'failed' && { backgroundColor: colors.negative },
              step.status === 'stopped' && { backgroundColor: colors.pending },
            ]}
          />
        ))}
      </View>
      <View>
        {steps.map((step, index) => <Step key={step.key} model={step} last={index === total - 1} reduced={reduced} />)}
      </View>
    </View>
  );
}

function Step({ model, last, reduced }: { model: StepModel; last: boolean; reduced: boolean }) {
  const { status, title, copy, result, failure, icon, name } = model;
  const pending = status === 'pending';
  const failed = status === 'failed';
  const stopped = status === 'stopped';
  const tone = status === 'done' ? colors.positive : status === 'working' ? colors.accent : failed ? colors.negative : stopped ? colors.pending : colors.dim;
  return (
    <View style={styles.row}>
      <View style={styles.railCol}>
        <Station status={status} reduced={reduced} />
        {last ? null : <Rail filled={status === 'done'} reduced={reduced} />}
      </View>
      <Panel style={styles.card} flat={pending} tone={failed ? colors.negative : stopped ? colors.pending : undefined}>
        <View style={styles.titleRow}>
          {icon ? (
            <View style={[styles.glyph, !pending && { borderColor: tone }]}>
              <Glyph name={icon} size={17} tone={tone} />
            </View>
          ) : null}
          <View style={styles.titleText}>
            {name ? <Overline tone={pending ? colors.dim : colors.faint}>{name}</Overline> : null}
            <Text style={[styles.title, pending && styles.titlePending]}>{title}</Text>
          </View>
        </View>
        {status === 'working' && copy ? <Text style={styles.copy}>{copy}</Text> : null}
        {status === 'done' && result ? <View style={styles.result}>{result}</View> : null}
        {(failed || stopped) && failure ? (
          <>
            <Text style={[styles.said, { color: failed ? colors.negative : colors.pending }]}>{failure.title}</Text>
            {failure.body ? <Text style={styles.copy}>{failure.body}</Text> : null}
            {failure.detail ? <Text style={styles.mono}>{failure.detail}</Text> : null}
          </>
        ) : null}
        {pending ? null : <Progress status={status} reduced={reduced} />}
      </Panel>
    </View>
  );
}

// The bar under a running step. While the step runs a short mint segment
// sweeps the track, over and over: something is happening, and how long it
// takes is not known. When the step ends the whole track fills, mint for a
// step that passed, red for one that failed, amber for one the person
// stopped. Under reduced motion the sweep is a still, dim fill.
function Progress({ status, reduced }: { status: StepStatus; reduced: boolean }) {
  const [width, setWidth] = useState(0);
  const sweep = useSharedValue(0);
  const fill = useSharedValue(0);
  const live = status === 'working' && !reduced;

  useEffect(() => {
    if (live) {
      sweep.value = 0;
      sweep.value = withRepeat(withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.quad) }), -1, false);
    } else {
      cancelAnimation(sweep);
      sweep.value = 0;
    }
    return () => cancelAnimation(sweep);
  }, [live, sweep]);

  useEffect(() => {
    const target = status === 'done' || status === 'failed' || status === 'stopped' ? 1 : status === 'working' && reduced ? 0.4 : 0;
    fill.value = reduced ? target : withTiming(target, { duration: FILL_MS, easing: Easing.out(Easing.cubic) });
  }, [status, reduced, fill]);

  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -width * 0.35 + sweep.value * width * 1.35 }] }), [width]);
  const fillStyle = useAnimatedStyle(() => ({ width: fill.value * width }), [width]);
  const tone = status === 'failed' ? colors.negative : status === 'stopped' ? colors.pending : status === 'working' ? colors.dim : colors.positive;

  return (
    <View style={styles.track} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {live && width > 0 ? <Animated.View style={[styles.sweep, { width: width * 0.35 }, sweepStyle]} /> : null}
      <Animated.View style={[styles.fill, { backgroundColor: tone }, fillStyle]} />
    </View>
  );
}

// The mark on the rail beside a card: a dot for a step still to come, a ring
// turning while it runs, a mint check once it is done, a red cross if it
// failed, an amber ring if the person stopped it. The change from one to the
// next is the moment the person is meant to catch. Exported so the
// walk-through of the Eye can draw the very same marks on its road; `flush`
// drops the margin that lines a station up with a card's title here.
export function Station({ status, reduced, flush = false }: { status: StepStatus; reduced: boolean; flush?: boolean }) {
  const pop = reduced || status === 'working' || status === 'pending' ? undefined : ZoomIn.duration(220);
  return (
    <View style={[styles.station, flush && styles.stationFlush]}>
      <Animated.View key={status} entering={pop}>
        {status === 'pending' ? <View style={styles.dot} /> : null}
        {status === 'working' ? <Ring reduced={reduced} /> : null}
        {status === 'done' ? (
          <Svg width={STATION} height={STATION} viewBox="0 0 20 20">
            <Circle cx={10} cy={10} r={9} fill={colors.positive} />
            <Path d="M5.5 10.2 8.6 13.3 14.6 7.2" fill="none" stroke={colors.bg} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        ) : null}
        {status === 'failed' ? (
          <Svg width={STATION} height={STATION} viewBox="0 0 20 20">
            <Circle cx={10} cy={10} r={8.5} fill="none" stroke={colors.negative} strokeWidth={1.8} />
            <Path d="M7 7 13 13M13 7 7 13" fill="none" stroke={colors.negative} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        ) : null}
        {status === 'stopped' ? (
          <Svg width={STATION} height={STATION} viewBox="0 0 20 20">
            <Circle cx={10} cy={10} r={8.5} fill="none" stroke={colors.pending} strokeWidth={1.8} />
            <Path d="M8 7v6M12 7v6" fill="none" stroke={colors.pending} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        ) : null}
      </Animated.View>
    </View>
  );
}

// The turning ring: three quarters of a mint circle over a dim track, one
// turn every nine hundred milliseconds. Under reduced motion it holds still,
// a plain ring in the muted grey, which is still a thing being waited on.
function Ring({ reduced }: { reduced: boolean }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.value = 0;
    if (reduced) return;
    turn.value = withRepeat(withTiming(360, { duration: TURN_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [reduced, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const r = 8;
  const round = 2 * Math.PI * r;
  return (
    <Animated.View style={[styles.ring, spin]}>
      <Svg width={STATION} height={STATION} viewBox="0 0 20 20">
        <Circle cx={10} cy={10} r={r} fill="none" stroke={colors.line} strokeWidth={2} />
        {reduced
          ? <Circle cx={10} cy={10} r={r} fill="none" stroke={colors.muted} strokeWidth={2} />
          : <Circle cx={10} cy={10} r={r} fill="none" stroke={colors.positive} strokeWidth={2} strokeLinecap="round" strokeDasharray={`${round * 0.72} ${round}`} />}
      </Svg>
    </Animated.View>
  );
}

// The rail under a station, down to the next card. A dim track, and a mint
// fill that grows from the top the moment this step settles.
function Rail({ filled, reduced }: { filled: boolean; reduced: boolean }) {
  const fill = useSharedValue(filled ? 1 : 0);
  useEffect(() => {
    fill.value = reduced ? (filled ? 1 : 0) : withTiming(filled ? 1 : 0, { duration: 420, easing: Easing.out(Easing.cubic) });
  }, [filled, reduced, fill]);
  const grow = useAnimatedStyle(() => ({ transform: [{ scaleY: fill.value }] }));
  return (
    <View style={styles.rail}>
      <Animated.View style={[styles.railFill, grow]} />
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  segments: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  segment: { flex: 1, height: 3, borderRadius: 1.5, backgroundColor: colors.line },
  // The rows carry their own spacing, so the rail runs through the gaps.
  row: { flexDirection: 'row', gap: spacing.sm },
  railCol: { width: STATION, alignItems: 'center' },
  // Level with the card's title line.
  station: { width: STATION, height: STATION, marginTop: spacing.md, alignItems: 'center', justifyContent: 'center' },
  stationFlush: { marginTop: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  glyph: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  titleText: { flex: 1, gap: 1 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dim },
  ring: { width: STATION, height: STATION },
  rail: { flex: 1, width: 2, borderRadius: 1, marginTop: spacing.xs, backgroundColor: colors.line, overflow: 'hidden' },
  railFill: { flex: 1, width: 2, backgroundColor: colors.positive, transformOrigin: 'top' },
  card: { flex: 1, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  title: { color: colors.text, fontFamily: font.semibold, fontSize: 15.5, lineHeight: 20, letterSpacing: -0.2 },
  titlePending: { color: colors.faint },
  copy: { color: colors.muted, fontFamily: font.regular, ...type.small },
  said: { fontFamily: font.medium, ...type.small },
  result: { gap: spacing.xs },
  mono: { color: colors.text, fontFamily: font.mono, ...type.small, letterSpacing: 0.3 },
  track: { height: 3, borderRadius: 1.5, backgroundColor: colors.line, overflow: 'hidden', marginTop: spacing.xs },
  sweep: { position: 'absolute', left: 0, top: 0, height: 3, borderRadius: 1.5, backgroundColor: colors.positive },
  fill: { height: 3, borderRadius: 1.5 },
});
