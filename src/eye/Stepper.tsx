import type { ReactNode } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { Easing, FadeIn, ZoomIn, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { t } from '../i18n';
import { Panel } from '../lab/kit';
import { colors, font, spacing } from '../theme';
import { Glyph, Overline, type GlyphName } from './glyphs';

// A stepper: the one way this app shows a thing that takes several steps and
// real time, so a person is never left with a spinner and a guess.
//
// One step on screen at a time. At the top, "Step 2 of 4" and the road: every
// step as a station with its glyph and its name, the same stations and the
// same glyphs the walk-through of the Eye showed, so the person knows where
// they are. Under the road, one card, for the step the person is on. While
// the step runs the card says in one plain sentence what the phone is doing
// right now, with a bar sweeping under it. When the step ends the card says
// what was done, with a check, and shows what was found: a key fingerprint,
// a model, a mint, a signature. Then the caller's button appears, and the
// person moves on when they have read it. Nothing moves on by itself past a
// finished step, unless waiting would let something expire, and then the
// caller says so in the next card.
//
// A step that failed is the same card edged red, with the words of whoever
// refused. A step the person stopped is edged amber. A step that waits for
// the person before it starts (the wallet, which has to be opened by them)
// holds a still ring and a still bar.
//
// The steps are driven by the caller's real events, never by a clock alone.
// The one thing the clock adds is a beat between transitions, through
// `usePaced`: a check lands, four hundred milliseconds pass, the next card
// comes. Reduced motion: no ring, no sweep, no beat.

export type StepStatus = 'pending' | 'working' | 'ready' | 'done' | 'failed' | 'stopped';

// What went wrong, in words the person can act on. `title` is the sentence
// that was actually said, by the attestor, the server or the wallet.
export type Failure = { title: string; body: string | null; detail: string | null };

export type StepModel = {
  key: string;
  // The step's glyph (src/eye/glyphs.tsx): the drawing the walk-through of
  // the Eye showed next to this step.
  icon: GlyphName;
  // The step's short name, the one the walk-through used: Finger, Wallet.
  name: string;
  // One plain sentence: what the phone is doing right now (working), or
  // what it is waiting for (ready).
  doing: string | null;
  // One plain sentence: what was done, shown with the check.
  done: string | null;
  status: StepStatus;
  // The facts found, revealed under the sentence once the step is done.
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

const toneOf = (status: StepStatus) =>
  status === 'done' ? colors.positive
    : status === 'working' || status === 'ready' ? colors.accent
      : status === 'failed' ? colors.negative
        : status === 'stopped' ? colors.pending
          : colors.dim;

// ------------------------------------------------------------------- road --

export type RoadStop = { key: string; icon: GlyphName; name: string; status: StepStatus };

// The road: every step as a station with its glyph and its name, a rail
// between them that fills as steps land. The walk-through of the Eye draws
// the very same road on its third page, so nothing here is new to the eye.
export function Road({ overline, stops, current, reduced }: { overline?: string; stops: RoadStop[]; current?: number; reduced: boolean }) {
  return (
    <View style={styles.road}>
      {overline ? <Overline tone={colors.faint}>{overline}</Overline> : null}
      <View style={styles.roadRow}>
        {stops.map((stop, i) => {
          const tone = toneOf(stop.status);
          const lit = stop.status !== 'pending';
          const here = current === i;
          return (
            <Fragment key={stop.key}>
              {i > 0 ? (
                <View style={styles.rail}>
                  <View style={[styles.railFill, { width: stop.status !== 'pending' ? '100%' : '0%' }]} />
                </View>
              ) : null}
              <View style={styles.stop}>
                <Station status={stop.status} reduced={reduced} flush />
                <View style={[styles.stopIcon, lit && { borderColor: tone }, here && styles.stopIconHere]}>
                  <Glyph name={stop.icon} size={18} tone={tone} />
                </View>
                <Text maxFontSizeMultiplier={1.35} style={[styles.stopName, lit && styles.stopNameOn, here && styles.stopNameHere]}>{stop.name}</Text>
              </View>
            </Fragment>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- stepper --

// `current` is the step on screen. `note` is one line under the card for a
// thing the person should know about the whole move ("The transaction
// expired while you were reading. Starting again."). `action` is the
// caller's buttons for this moment, rendered under the card.
export function Stepper({ steps, current, reduced, eyebrow, note, action }: { steps: StepModel[]; current: number; reduced: boolean; eyebrow?: string; note?: string | null; action?: ReactNode }) {
  const total = steps.length;
  const at = Math.max(0, Math.min(total - 1, current));
  const step = steps[at];
  return (
    <View style={styles.stepper}>
      <View style={styles.head}>
        {eyebrow ? <Overline tone={colors.faint}>{eyebrow}</Overline> : <View />}
        <Overline tone={colors.muted}>{t('Step {step} of {total}', { step: at + 1, total })}</Overline>
      </View>
      <Road stops={steps.map((item) => ({ key: item.key, icon: item.icon, name: item.name, status: item.status }))} current={at} reduced={reduced} />
      {step ? <Card model={step} reduced={reduced} /> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

// The one card on screen: the step's glyph, its name, and the sentence for
// this moment. A new status brings the card in fresh, so the eye catches it.
function Card({ model, reduced }: { model: StepModel; reduced: boolean }) {
  const { status, name, icon, doing, done, result, failure } = model;
  const failed = status === 'failed';
  const stopped = status === 'stopped';
  const tone = toneOf(status);
  const sentence = status === 'done' ? done : status === 'working' || status === 'ready' ? doing : (failed || stopped) && failure ? failure.title : null;
  return (
    <Animated.View key={`${model.key}-${status}`} entering={reduced ? undefined : FadeIn.duration(260)}>
      <Panel style={styles.card} tone={failed ? colors.negative : stopped ? colors.pending : status === 'done' ? colors.positive : undefined}>
        <View style={styles.cardHead}>
          <View style={[styles.glyph, { borderColor: tone }]}>
            <Glyph name={icon} size={22} tone={tone} />
          </View>
          <View style={styles.cardTitle}>
            <Overline tone={tone}>{name}</Overline>
            {sentence ? <Text style={[styles.sentence, (failed || stopped) && { color: tone }]}>{sentence}</Text> : null}
          </View>
          <View style={styles.mark}><Station status={status} reduced={reduced} flush /></View>
        </View>
        {status === 'done' && result ? <View style={styles.result}>{result}</View> : null}
        {(failed || stopped) && failure ? (
          <View style={styles.result}>
            {failure.body ? <Text style={styles.copy}>{failure.body}</Text> : null}
            {failure.detail ? <Text style={styles.mono}>{failure.detail}</Text> : null}
          </View>
        ) : null}
        {status === 'pending' ? null : <Progress status={status} reduced={reduced} />}
      </Panel>
    </Animated.View>
  );
}

// The bar under a running step. While the step runs a short mint segment
// sweeps the track, over and over: something is happening, and how long it
// takes is not known. When the step ends the whole track fills, mint for a
// step that passed, red for one that failed, amber for one the person
// stopped. A step waiting for the person holds a still, dim fill, as does a
// running one under reduced motion.
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
    const target = status === 'done' || status === 'failed' || status === 'stopped' ? 1 : status === 'ready' || (status === 'working' && reduced) ? 0.4 : 0;
    fill.value = reduced ? target : withTiming(target, { duration: FILL_MS, easing: Easing.out(Easing.cubic) });
  }, [status, reduced, fill]);

  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -width * 0.35 + sweep.value * width * 1.35 }] }), [width]);
  const fillStyle = useAnimatedStyle(() => ({ width: fill.value * width }), [width]);
  const tone = status === 'failed' ? colors.negative : status === 'stopped' ? colors.pending : status === 'working' ? colors.dim : status === 'ready' ? colors.accentDim : colors.positive;

  return (
    <View style={styles.track} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {live && width > 0 ? <Animated.View style={[styles.sweep, { width: width * 0.35 }, sweepStyle]} /> : null}
      <Animated.View style={[styles.fill, { backgroundColor: tone }, fillStyle]} />
    </View>
  );
}

// The mark beside a step: a dot for a step still to come, a ring turning
// while it runs, a still ring while it waits for the person, a mint check
// once it is done, a red cross if it failed, an amber ring if the person
// stopped it. The change from one to the next is the moment the person is
// meant to catch. `flush` drops the margin that once lined a station up with
// a card's title; every use is flush now, and the prop stays for the road.
export function Station({ status, reduced, flush = false }: { status: StepStatus; reduced: boolean; flush?: boolean }) {
  const pop = reduced || status === 'working' || status === 'ready' || status === 'pending' ? undefined : ZoomIn.duration(220);
  return (
    <View style={[styles.station, flush && styles.stationFlush]}>
      <Animated.View key={status} entering={pop}>
        {status === 'pending' ? <View style={styles.dot} /> : null}
        {status === 'working' ? <Ring reduced={reduced} /> : null}
        {status === 'ready' ? (
          <Svg width={STATION} height={STATION} viewBox="0 0 20 20">
            <Circle cx={10} cy={10} r={8} fill="none" stroke={colors.accent} strokeWidth={2} />
            <Circle cx={10} cy={10} r={2.4} fill={colors.accent} />
          </Svg>
        ) : null}
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

const styles = StyleSheet.create({
  stepper: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  // The road.
  road: { gap: spacing.xs },
  roadRow: { flexDirection: 'row', alignItems: 'flex-start' },
  rail: { width: 14, height: 2, marginTop: 9, borderRadius: 1, backgroundColor: colors.line, overflow: 'hidden' },
  railFill: { height: 2, backgroundColor: colors.positive },
  stop: { flex: 1, minWidth: 56, alignItems: 'center', gap: 5 },
  stopIcon: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(6, 12, 18, 0.9)', alignItems: 'center', justifyContent: 'center' },
  stopIconHere: { backgroundColor: 'rgba(86, 224, 255, 0.1)' },
  stopName: { color: colors.faint, fontFamily: font.semibold, fontSize: 12, lineHeight: 15, textAlign: 'center' },
  stopNameOn: { color: colors.muted },
  stopNameHere: { color: colors.text },
  // The card.
  card: { padding: spacing.md, gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  glyph: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { flex: 1, gap: 3, paddingTop: 2 },
  sentence: { color: colors.text, fontFamily: font.semibold, fontSize: 17, lineHeight: 23, letterSpacing: -0.2 },
  mark: { paddingTop: 2 },
  station: { width: STATION, height: STATION, marginTop: spacing.md, alignItems: 'center', justifyContent: 'center' },
  stationFlush: { marginTop: 0 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dim },
  ring: { width: STATION, height: STATION },
  copy: { color: colors.muted, fontFamily: font.regular, fontSize: 14.5, lineHeight: 21 },
  result: { gap: spacing.xs, paddingLeft: 42 + spacing.md },
  mono: { color: colors.text, fontFamily: font.mono, fontSize: 13, lineHeight: 19, letterSpacing: 0.3 },
  note: { color: colors.pending, fontFamily: font.medium, fontSize: 14.5, lineHeight: 21 },
  action: { gap: spacing.sm },
  track: { height: 3, borderRadius: 1.5, backgroundColor: colors.line, overflow: 'hidden', marginTop: spacing.xs },
  sweep: { position: 'absolute', left: 0, top: 0, height: 3, borderRadius: 1.5, backgroundColor: colors.positive },
  fill: { height: 3, borderRadius: 1.5 },
});
