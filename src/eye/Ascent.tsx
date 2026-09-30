import { memo, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
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
const EYE_W = 46;
const EYE_H = 26;

// One Eye of the world, the mark's own almond (src/lab/kit.tsx Mark): the
// lid line, the dark sclera, the gold iris with its glint — open when it
// blinked today, a shut lid seam when it has not (Alex, 01.10: round was
// not our eye; the world wears the logo's shape).
function EyeFace({ open, perfect, mine, w, h }: { open: boolean; perfect: boolean; mine: boolean; w: number; h: number }) {
  const tone = perfect ? '#E8CF95' : open ? '#6EF0FF' : '#5E7890';
  const glow = perfect || mine ? '#C9A96A' : '#56E0FF';
  return (
    <Svg width={w} height={h} viewBox="0 0 100 56">
      <Defs>
        <RadialGradient id="af-glow" cx="0.5" cy="0.5" rx="0.5" ry="0.5">
          <Stop offset="0.35" stopColor={glow} stopOpacity={open ? 0.45 : 0.1} />
          <Stop offset="1" stopColor={glow} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="af-iris" cx="0.42" cy="0.38" r="0.7">
          <Stop offset="0" stopColor="#F0D898" />
          <Stop offset="0.55" stopColor="#D6B56A" />
          <Stop offset="1" stopColor="#5A4219" />
        </RadialGradient>
      </Defs>
      <Ellipse cx={50} cy={28} rx={49} ry={27} fill="url(#af-glow)" />
      {open ? (
        <>
          <Path
            d="M8 28 C17 10 31 5 50 5 C69 5 83 10 92 28 C83 46 69 51 50 51 C31 51 17 46 8 28 Z"
            fill="#050B10"
            stroke={mine ? '#C9A96A' : tone}
            strokeWidth={mine ? 5 : 3.6}
          />
          <Path d="M9 28 C20 16 32 12 50 12 L50 44 C32 44 20 40 9 28 Z" fill="#0E171E" />
          <Path d="M91 28 C80 16 68 12 50 12 L50 44 C68 44 80 40 91 28 Z" fill="#141F27" />
          <Circle cx={50} cy={28} r={13.5} fill="url(#af-iris)" />
          <Circle cx={50} cy={28} r={6.2} fill="#020304" />
          <Circle cx={45.5} cy={23.5} r={2.6} fill="rgba(244,251,253,0.92)" />
        </>
      ) : (
        <>
          {/* Shut: the lid line the mark closes to, with a hint of the almond. */}
          <Path
            d="M8 28 C17 10 31 5 50 5 C69 5 83 10 92 28 C83 46 69 51 50 51 C31 51 17 46 8 28 Z"
            fill="#070D12"
            stroke={mine ? 'rgba(201, 169, 106, 0.8)' : 'rgba(94, 120, 144, 0.55)'}
            strokeWidth={mine ? 4.5 : 3}
          />
          <Path d="M10 28 C28 30 72 30 90 28" fill="none" stroke="#3A5B68" strokeWidth={3.5} strokeLinecap="round" />
        </>
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
        <EyeFace open={eye.blinkedToday} perfect={eye.perfect} mine={mine} w={EYE_W} h={EYE_H} />
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
  // The steps, filled from the listed Eyes: longest streaks first on each —
  // and you always first on your own step, never hidden behind a +N
  // (thought through for five hundred before five hundred arrive).
  const filled = useMemo(() => {
    const rows = STEPS.map(() => [] as NetworkEye[]);
    for (const eye of network?.eyes ?? []) {
      const at = STEPS.findIndex((step) => eye.streak >= step.day);
      rows[at === -1 ? STEPS.length - 1 : at]?.push(eye);
    }
    rows.forEach((row) => {
      row.sort((a, b) => b.streak - a.streak || a.serial - b.serial);
      if (meSerial != null) {
        const at = row.findIndex((eye) => eye.serial === meSerial);
        if (at > 0) row.unshift(...row.splice(at, 1));
      }
    });
    return rows;
  }, [network, meSerial]);
  // A step opened in full: every Eye standing on it, one row each, so a
  // crowded step is a list to read and a person to find, not a dead +N.
  const [openStep, setOpenStep] = useState<number | null>(null);
  const { height: windowH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
                  <Pressable onPress={() => setOpenStep(i)} style={({ pressed }) => [styles.moreChip, pressed && styles.pressed]} accessibilityRole="button">
                    <Text maxFontSizeMultiplier={1.2} style={styles.moreText}>{`+${integer(more)}`}</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            )}
            {total > 0 ? (
              <Pressable disabled={row.length === 0} onPress={() => setOpenStep(i)} hitSlop={8} accessibilityRole="button">
                <Text maxFontSizeMultiplier={1.2} style={[styles.count, step.gold && styles.countGold]}>{total === 1 ? t('1 Eye') : t('{count} Eyes', { count: integer(total) })}{row.length > 0 ? ' ›' : ''}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {/* The step in full: a Modal list of everyone standing on it. */}
      <Modal transparent statusBarTranslucent animationType="slide" visible={openStep != null} onRequestClose={() => setOpenStep(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} style={styles.backdrop} onPress={() => setOpenStep(null)} />
        <View style={[styles.sheet, { maxHeight: windowH * 0.72, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.grip} />
          {openStep != null ? (
            <>
              <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
                {STEPS[openStep]?.gold
                  ? t('The gold step — 30 days and more')
                  : t('The {label}-day step', { label: STEPS[openStep]?.label ?? '' })}
              </Text>
              <FlatList
                data={filled[openStep] ?? []}
                keyExtractor={(eye) => String(eye.serial)}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const mine = item.serial === meSerial;
                  return (
                    <Pressable onPress={() => { setOpenStep(null); onPick(item); }} style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]} accessibilityRole="button">
                      <EyeFace open={item.blinkedToday} perfect={item.perfect} mine={mine} w={34} h={19} />
                      <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.sheetName, mine && styles.nameMine]}>{item.name}</Text>
                      <Text maxFontSizeMultiplier={1.3} style={styles.sheetDays}>{item.streak === 1 ? t('1 day') : t('{count} days', { count: item.streak })}</Text>
                    </Pressable>
                  );
                }}
                ListFooterComponent={(uncounted[openStep] ?? 0) > 0
                  ? <Text maxFontSizeMultiplier={1.3} style={styles.sheetFoot}>{t('…and {count} more keep watch here', { count: integer(uncounted[openStep] ?? 0) })}</Text>
                  : null}
              />
            </>
          ) : null}
        </View>
      </Modal>
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
  moreChip: { height: EYE_H + 8, minWidth: 44, borderRadius: (EYE_H + 8) / 2, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, marginTop: 4 },
  moreText: { color: colors.muted, fontFamily: font.semibold, fontSize: 12, fontVariant: ['tabular-nums'] },
  // The step opened in full.
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(2, 4, 7, 0.72)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.panelSolid, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: 1, borderColor: '#111B24', paddingTop: spacing.sm, paddingHorizontal: spacing.lg },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: spacing.sm },
  sheetTitle: { color: colors.text, fontFamily: font.bold, fontSize: 18, lineHeight: 23, letterSpacing: -0.3, marginBottom: spacing.sm },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(21, 33, 44, 0.6)' },
  sheetName: { flex: 1, color: colors.text, fontFamily: font.medium, fontSize: 15, lineHeight: 20 },
  sheetDays: { color: colors.muted, fontFamily: font.medium, fontSize: 13.5, fontVariant: ['tabular-nums'] },
  sheetFoot: { color: colors.faint, fontFamily: font.regular, fontSize: 13, lineHeight: 18, paddingVertical: spacing.md, textAlign: 'center' },
});
