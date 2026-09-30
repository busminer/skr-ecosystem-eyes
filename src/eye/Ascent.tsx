import { memo, useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { t } from '../i18n';
import { integer } from '../format';
import { colors, font, radius, spacing } from '../theme';
import type { EyeNetwork, NetworkEye } from './api';

// The Ascent (01.10, Alex: the radar was dull and floaty — make a little
// world of the minted, where you can poke around, read who stands where,
// and feel somebody gaining on you).
//
// The world is a stair of nine steps, the same thresholds the service
// already keeps (1, 2, 3, 5, 7, 10, 14, 21, 30+), drawn top-down: gold at
// the summit under its own aurora, day one at the foot. Every Eye is a
// round glowing eye — no phones — with its .skr name written under it, and
// it stands on the step its streak has earned. Above you is literally
// above you: one glance says who is ahead and how far the next step is.
// Yours wears the gold ring and a "you" tag. A Blink arriving on the
// stream makes that Eye pulse where it stands. Tap any Eye and its sheet
// opens. Everything is native views on the page's own scroll: nothing
// drifts, nothing floats, no WebView.
//
// A step shows up to EYES_SHOWN Eyes in a row that scrolls sideways; past
// that a +N chip says how many more stand there. Empty steps stay drawn,
// dim: the road is part of the world, and the summit is visible from the
// foot.

const STEPS = [
  { day: 30, label: '30+', gold: true },
  { day: 21, label: '21', gold: false },
  { day: 14, label: '14', gold: false },
  { day: 10, label: '10', gold: false },
  { day: 7, label: '7', gold: false },
  { day: 5, label: '5', gold: false },
  { day: 3, label: '3', gold: false },
  { day: 2, label: '2', gold: false },
  { day: 1, label: '1', gold: false },
] as const;
const EYES_SHOWN = 24;
const EYE_R = 21;

// One round Eye of the world: the NFT's shape in vector — glowing ring,
// dark lens, gold iris — shut (a seam) when it has not blinked today.
function EyeFace({ open, perfect, mine, size }: { open: boolean; perfect: boolean; mine: boolean; size: number }) {
  const tone = perfect ? '#E8CF95' : open ? '#6EF0FF' : '#5E7890';
  const half = size / 2;
  const r = half - 3;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id="af-glow" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0.4" stopColor={perfect ? '#C9A96A' : '#56E0FF'} stopOpacity={open ? 0.5 : 0.12} />
          <Stop offset="1" stopColor={perfect ? '#C9A96A' : '#56E0FF'} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="af-iris" cx="0.42" cy="0.38" r="0.7">
          <Stop offset="0" stopColor="#F0D898" />
          <Stop offset="0.55" stopColor="#D6B56A" />
          <Stop offset="1" stopColor="#5A4219" />
        </RadialGradient>
      </Defs>
      <Circle cx={half} cy={half} r={half} fill="url(#af-glow)" />
      <Circle cx={half} cy={half} r={r} fill="#050B10" stroke={mine ? '#C9A96A' : tone} strokeWidth={mine ? 3 : 2.2} opacity={open || mine ? 1 : 0.8} />
      {open ? (
        <>
          <Circle cx={half} cy={half} r={r * 0.52} fill="url(#af-iris)" />
          <Circle cx={half} cy={half} r={r * 0.24} fill="#020304" />
          <Circle cx={half - r * 0.22} cy={half - r * 0.24} r={r * 0.11} fill="rgba(244,251,253,0.9)" />
        </>
      ) : (
        <Path d={`M ${half - r * 0.55} ${half} L ${half + r * 0.55} ${half}`} stroke="#3A5B68" strokeWidth={2} strokeLinecap="round" />
      )}
    </Svg>
  );
}

// One person on a step: the eye, the name, the day. Pulses when their
// Blink arrives on the stream.
function Climber({ eye, mine, pulse, onPick }: { eye: NetworkEye; mine: boolean; pulse: number; onPick: (eye: NetworkEye) => void }) {
  const k = useSharedValue(1);
  useEffect(() => {
    if (!pulse) return;
    k.value = withSequence(
      withTiming(1.22, { duration: 160, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }),
    );
  }, [pulse, k]);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: k.value }] }));
  return (
    <Pressable onPress={() => onPick(eye)} style={({ pressed }) => [styles.climber, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={eye.name}>
      <Animated.View style={pop}>
        <EyeFace open={eye.blinkedToday} perfect={eye.perfect} mine={mine} size={EYE_R * 2} />
      </Animated.View>
      {mine ? <View style={styles.youTag}><Text style={styles.youTagText}>{t('you')}</Text></View> : null}
      <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.name, mine && styles.nameMine]}>{eye.name}</Text>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.days}>{eye.streak === 1 ? t('1 day') : t('{count} days', { count: eye.streak })}</Text>
    </Pressable>
  );
}

export const Ascent = memo(function Ascent({ network, meSerial, pulses, onPick }: {
  network: EyeNetwork | null;
  meSerial: number | null;
  // serial -> a counter that grows with each of their Blinks on the stream.
  pulses: Record<number, number>;
  onPick: (eye: NetworkEye) => void;
}) {
  // The steps, filled from the listed Eyes: longest streaks first on each.
  const filled = useMemo(() => {
    const rows = STEPS.map(() => [] as NetworkEye[]);
    for (const eye of network?.eyes ?? []) {
      const at = STEPS.findIndex((step) => eye.streak >= step.day);
      rows[at === -1 ? STEPS.length - 1 : at]?.push(eye);
    }
    rows.forEach((row) => row.sort((a, b) => b.streak - a.streak || a.serial - b.serial));
    return rows;
  }, [network]);
  // Eyes the server counted but did not list, per step, from ringCounts
  // (ring 0 is the innermost, the 30+ step).
  const uncounted = useMemo(() => STEPS.map((_, i) => {
    const counted = network?.ringCounts?.[i] ?? 0;
    return Math.max(0, counted - (filled[i]?.length ?? 0));
  }), [network, filled]);

  return (
    <View style={styles.world}>
      {/* The mountain the stair climbs: a quiet ridge, the summit's aurora. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="asc-ridge" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#0E1B26" stopOpacity="0.9" />
              <Stop offset="0.35" stopColor="#0A141D" stopOpacity="0.55" />
              <Stop offset="1" stopColor="#060B11" stopOpacity="0.2" />
            </LinearGradient>
            <LinearGradient id="asc-au" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#C9A96A" stopOpacity="0.22" />
              <Stop offset="0.6" stopColor="#3CF2C0" stopOpacity="0.05" />
              <Stop offset="1" stopColor="#3CF2C0" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#asc-ridge)" />
          <Rect x="0" y="0" width="100%" height="120" fill="url(#asc-au)" />
        </Svg>
      </View>
      <View style={styles.spine} pointerEvents="none" />

      {STEPS.map((step, i) => {
        const row = filled[i] ?? [];
        const ghosts = uncounted[i] ?? 0;
        const total = row.length + ghosts;
        const shown = row.slice(0, EYES_SHOWN);
        const more = total - shown.length;
        const empty = total === 0;
        return (
          <View key={step.label} style={[styles.step, step.gold && styles.stepGold, empty && styles.stepEmpty]}>
            <View style={styles.rail}>
              <Text maxFontSizeMultiplier={1.2} style={[styles.railDay, step.gold && styles.railGold, empty && styles.railEmpty]}>{step.label}</Text>
              <Text maxFontSizeMultiplier={1.2} style={[styles.railWord, empty && styles.railEmpty]}>{step.gold ? t('gold') : t('days')}</Text>
            </View>
            {empty ? (
              <View style={styles.flat}><View style={[styles.ledge, step.gold && styles.ledgeGold]} /></View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowInner} style={styles.row}>
                {shown.map((eye) => (
                  <Climber key={eye.serial} eye={eye} mine={eye.serial === meSerial} pulse={pulses[eye.serial] ?? 0} onPick={onPick} />
                ))}
                {more > 0 ? (
                  <View style={styles.moreChip}><Text maxFontSizeMultiplier={1.2} style={styles.moreText}>{`+${integer(more)}`}</Text></View>
                ) : null}
              </ScrollView>
            )}
            {total > 0 ? <Text maxFontSizeMultiplier={1.2} style={[styles.count, step.gold && styles.countGold]}>{total === 1 ? t('1 Eye') : t('{count} Eyes', { count: integer(total) })}</Text> : null}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  world: { borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(17, 27, 36, 0.9)', paddingVertical: spacing.sm },
  // The one thread from the foot to the summit, behind the rail labels.
  spine: { position: 'absolute', left: 37, top: 10, bottom: 10, width: 1.5, backgroundColor: 'rgba(86, 224, 255, 0.14)', borderRadius: 1 },
  step: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingRight: spacing.sm },
  stepGold: { backgroundColor: 'rgba(201, 169, 106, 0.07)' },
  stepEmpty: { minHeight: 34 },
  rail: { width: 58, alignItems: 'center', gap: 0 },
  railDay: { color: 'rgba(150, 200, 225, 0.95)', fontFamily: font.monoSemibold, fontSize: 13, letterSpacing: 0.4 },
  railGold: { color: colors.metal },
  railWord: { color: colors.dim, fontFamily: font.semibold, fontSize: 8.5, letterSpacing: 1, textTransform: 'uppercase' },
  railEmpty: { opacity: 0.45 },
  row: { flex: 1 },
  rowInner: { alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 6, paddingRight: spacing.sm },
  flat: { flex: 1, justifyContent: 'center' },
  ledge: { height: 1, backgroundColor: 'rgba(120, 180, 205, 0.12)', marginRight: spacing.md },
  ledgeGold: { backgroundColor: 'rgba(201, 169, 106, 0.25)' },
  climber: { width: 64, alignItems: 'center' },
  pressed: { opacity: 0.7 },
  youTag: { position: 'absolute', top: -2, right: 2, backgroundColor: colors.metal, borderRadius: radius.pill, paddingHorizontal: 5, paddingVertical: 1 },
  youTagText: { color: '#191307', fontFamily: font.bold, fontSize: 8.5, letterSpacing: 0.5 },
  name: { color: '#CFE2EF', fontFamily: font.medium, fontSize: 10.5, lineHeight: 14, maxWidth: 64, marginTop: 1 },
  nameMine: { color: colors.metal, fontFamily: font.semibold },
  days: { color: colors.faint, fontFamily: font.regular, fontSize: 9.5, lineHeight: 12, fontVariant: ['tabular-nums'] },
  count: { color: colors.faint, fontFamily: font.medium, fontSize: 10, fontVariant: ['tabular-nums'], marginLeft: spacing.xs },
  countGold: { color: 'rgba(201, 169, 106, 0.8)' },
  moreChip: { height: EYE_R * 2, minWidth: 40, borderRadius: EYE_R, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  moreText: { color: colors.muted, fontFamily: font.semibold, fontSize: 12, fontVariant: ['tabular-nums'] },
});
