import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { playCue } from '../sound';
import { prefValue } from '../prefs';
import { colors, font, radius } from '../theme';

// The headline number, built the way a departure board is built: one card per
// digit, and a card that changes rolls over instead of being replaced. The
// rolling is the point — it is how a person notices, out of the corner of an
// eye, that the vault moved while they were looking at it.

const FLIP_MS = 320;
const STAGGER_MS = 55;

function Cell({ char, size, width, height, delay }: { char: string; size: number; width: number; height: number; delay: number }) {
  const [pair, setPair] = useState({ next: char, previous: char });
  const roll = useSharedValue(1);

  useEffect(() => {
    setPair((current) => (current.next === char ? current : { next: char, previous: current.next }));
  }, [char]);

  useEffect(() => {
    if (pair.next === pair.previous) return;
    roll.value = 0;
    roll.value = withDelay(delay, withTiming(1, { duration: FLIP_MS, easing: Easing.out(Easing.cubic) }));
  }, [pair, delay, roll]);

  const arriving = useAnimatedStyle(() => ({
    transform: [{ translateY: (roll.value - 1) * height }],
    opacity: 0.25 + roll.value * 0.75,
  }));

  const leaving = useAnimatedStyle(() => ({
    transform: [{ translateY: roll.value * height }],
    opacity: 1 - roll.value,
  }));

  const textStyle = [styles.glyph, { fontSize: size, lineHeight: height, width }];

  return (
    <View style={[styles.cell, { width, height }]}>
      <View style={styles.cellTopTint} pointerEvents="none" />
      <Animated.Text style={[textStyle, leaving]}>{pair.previous}</Animated.Text>
      <Animated.Text style={[textStyle, styles.stacked, arriving]}>{pair.next}</Animated.Text>
      <View style={styles.seam} pointerEvents="none" />
    </View>
  );
}

// `size` is the height of one card; the glyph is sized from it, so the whole
// board scales from a single number.
export function FlipNumber({ value, size = 76 }: { value: string; size?: number }) {
  const height = size;
  const width = Math.round(size * 0.62);
  const glyph = Math.round(size * 0.62);
  const previous = useRef(value);

  useEffect(() => {
    const before = previous.current;
    if (before === value) return;
    previous.current = value;
    // A first fill is data arriving, not a change. It stays silent.
    if (!/\d/.test(before)) return;
    if (!prefValue('sound', true) && !prefValue('buzz', true)) return;

    const changed: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const glyph = value[index] ?? '';
      if (before[index] !== glyph && /\d/.test(glyph)) changed.push(index);
    }
    if (changed.length === 0) return;

    if (prefValue('buzz', true)) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    if (!prefValue('sound', true)) return;
    // One card falls for the whole change. A click per digit, staggered, read
    // as a burst of ticks from across the room; one soft knock reads as a board.
    // The board is felt, not heard: even one soft knock from the table was a
    // tick to a person who was not looking at the screen.
    return undefined;
  }, [value]);

  return (
    <View style={styles.row}>
      {value.split('').map((char, index) => (
        /\d/.test(char)
          ? <Cell key={index} char={char} size={glyph} width={width} height={height} delay={index * STAGGER_MS} />
          : <View key={index} style={[styles.separator, { height, paddingBottom: Math.round(size * 0.15) }]}>
              <View style={styles.dot} />
            </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cell: {
    borderRadius: radius.inner,
    backgroundColor: '#0B131B',
    borderWidth: 1,
    borderColor: colors.lineStrong,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  cellTopTint: { position: 'absolute', left: 0, right: 0, top: 0, height: '50%', backgroundColor: 'rgba(255,255,255,0.022)' },
  seam: { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  stacked: { position: 'absolute', left: 0, right: 0 },
  glyph: {
    color: colors.text,
    fontFamily: font.monoBlack,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    letterSpacing: -1,
  },
  separator: { width: 14, alignItems: 'center', justifyContent: 'flex-end' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.metal },
});
