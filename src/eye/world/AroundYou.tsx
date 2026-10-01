import { memo, useCallback, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { t } from '../../i18n';
import { integer } from '../../format';
import { colors, font, radius, spacing, type } from '../../theme';
import { Eyebrow } from '../../lab/kit';
import type { AroundYou as Around, WorldEye } from './geometry';

// The part of the world that reads as words: the Eyes just ahead of you and
// just behind, how many stand each side, and how far the next step is. The
// picture shows the whole network; this answers "who is near me" (Alex: who
// is overtaking me) without a finger on a thousand tiny Eyes. Pressing a chip
// rings that Eye in the picture while the finger is down; letting go opens it.

const ALMOND = 'M8 28 C17 10 31 5 50 5 C69 5 83 10 92 28 C83 46 69 51 50 51 C31 51 17 46 8 28 Z';

export function MiniEye({ awake, mine = false, w = 20 }: { awake: boolean; mine?: boolean; w?: number }) {
  const gold = 'rgba(201, 169, 106, 0.85)';
  return (
    <Svg width={w} height={(w * 56) / 100} viewBox="0 0 100 56">
      {awake ? (
        <>
          <Path d={ALMOND} fill="#050B10" stroke={mine ? colors.metal : '#6EF0FF'} strokeWidth={7} />
          <Circle cx={50} cy={28} r={14} fill="#D6B56A" />
          <Circle cx={50} cy={28} r={6.4} fill="#020304" />
        </>
      ) : (
        <>
          <Path d={ALMOND} fill="#070D12" stroke={mine ? gold : 'rgba(94, 120, 144, 0.6)'} strokeWidth={6} />
          <Path d="M10 28 C28 30 72 30 90 28" fill="none" stroke="#3A5B68" strokeWidth={7} strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}

const days = (n: number) => (n === 1 ? t('1 day') : t('{count} days', { count: integer(n) }));
const eyes = (n: number) => (n === 1 ? t('1 Eye') : t('{count} Eyes', { count: integer(n) }));

export const AroundYou = memo(function AroundYou({ around, onPick, onHold }: {
  around: Around;
  onPick: (serial: number) => void;
  // A chip pressed (its serial) or let go (null): the picture rings that Eye.
  onHold: (serial: number | null) => void;
}) {
  const { ahead, behind, me, aheadCount, behindCount, nextStep } = around;
  // Your chip is the one that must never sit half out of the row: once the row
  // and your chip have both been measured, the row is scrolled to centre it
  // (at a large system font only three chips fit).
  const scroller = useRef<ScrollView>(null);
  const mine = useRef<{ x: number; w: number } | null>(null);
  const port = useRef(0);
  const settle = useCallback(() => {
    if (!mine.current || !port.current) return;
    scroller.current?.scrollTo({ x: Math.max(0, mine.current.x + mine.current.w / 2 - port.current / 2), animated: false });
  }, []);
  const chip = (eye: WorldEye, arrow: string) => (
    <Pressable
      key={eye.serial}
      onLayout={eye.me ? (event) => { mine.current = { x: event.nativeEvent.layout.x, w: event.nativeEvent.layout.width }; settle(); } : undefined}
      onPressIn={() => onHold(eye.serial)}
      onPressOut={() => onHold(null)}
      onPress={() => onPick(eye.serial)}
      accessibilityRole="button"
      accessibilityLabel={eye.name}
      style={({ pressed }) => [styles.chip, eye.me && styles.chipMe, pressed && styles.pressed]}
    >
      <MiniEye awake={eye.awake} mine={eye.me} />
      <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.chipName, eye.me && styles.chipNameMe]}>{eye.me ? t('you') : eye.name}</Text>
      <Text maxFontSizeMultiplier={1.2} style={[styles.chipDays, arrow === '▲' && styles.chipAhead]}>{arrow ? `${arrow} ` : ''}{days(eye.streak)}</Text>
    </Pressable>
  );
  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Eyebrow>{t('Around you')}</Eyebrow>
        <Text maxFontSizeMultiplier={1.3} style={styles.sum}>{t('{ahead} ahead · {behind} behind', { ahead: integer(aheadCount), behind: integer(behindCount) })}</Text>
      </View>
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} onLayout={(event) => { port.current = event.nativeEvent.layout.width; settle(); }}>
        {ahead.map((eye) => chip(eye, '▲'))}
        {chip(me, '')}
        {behind.map((eye) => chip(eye, '▼'))}
      </ScrollView>
      <Text maxFontSizeMultiplier={1.3} style={styles.next}>
        {nextStep
          ? nextStep.label === 'gold'
            ? t('{days} to the gold step · {eyes} there', { days: days(nextStep.days), eyes: eyes(nextStep.count) })
            : t('{days} to the {label}-day step · {eyes} there', { days: days(nextStep.days), label: nextStep.label, eyes: eyes(nextStep.count) })
          : t('You stand on the gold step')}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  box: { backgroundColor: colors.panel, borderRadius: radius.card, borderWidth: 1, borderColor: '#101B25', padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  sum: { color: colors.faint, fontFamily: font.regular, ...type.small, fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  chips: { gap: 6, paddingRight: spacing.sm },
  chip: { minWidth: 64, alignItems: 'center', gap: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.inner, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.inset },
  chipMe: { borderColor: 'rgba(201, 169, 106, 0.6)', backgroundColor: 'rgba(201, 169, 106, 0.09)' },
  pressed: { opacity: 0.7 },
  chipName: { color: '#CFE2EF', fontFamily: font.medium, fontSize: 10.5, lineHeight: 14, maxWidth: 88 },
  chipNameMe: { color: colors.metal, fontFamily: font.semibold },
  chipDays: { color: colors.faint, fontFamily: font.regular, fontSize: 9.5, lineHeight: 12, fontVariant: ['tabular-nums'] },
  chipAhead: { color: colors.positive },
  next: { color: colors.muted, fontFamily: font.regular, ...type.small },
});
