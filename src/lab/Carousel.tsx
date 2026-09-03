import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, spacing } from '../theme';

// One card at a time, the whole card, never half of the next one.
//
// The first version of the fact cards was a horizontal strip that scrolled by
// itself, and the card that had just left was still half on screen while the
// next one was half on. It read as broken. This is a paged rail: each page is
// the full width, the rail snaps page to page, dots say where you are, and the
// cards turn themselves over until a finger touches them — then they wait a
// while before turning again.

const AUTO_MS = 3_600;
const HOLD_AFTER_TOUCH_MS = 12_000;

export function Carousel({ width, children, auto = true, gap = spacing.md }: { width: number; children: ReactNode; auto?: boolean; gap?: number }) {
  const pages = Children.toArray(children);
  const rail = useRef<ScrollView>(null);
  const index = useRef(0);
  const touchedAt = useRef(0);
  const [current, setCurrent] = useState(0);
  const step = width + gap;

  const go = useCallback((next: number, animated = true) => {
    const count = pages.length;
    if (count === 0) return;
    index.current = ((next % count) + count) % count;
    rail.current?.scrollTo({ x: index.current * step, animated });
    setCurrent(index.current);
  }, [pages.length, step]);

  useEffect(() => {
    if (!auto || pages.length < 2) return undefined;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (Date.now() - touchedAt.current < HOLD_AFTER_TOUCH_MS) return;
      go(index.current + 1);
    }, AUTO_MS);
    return () => clearInterval(timer);
  }, [auto, go, pages.length]);

  const settle = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(event.nativeEvent.contentOffset.x / step);
    index.current = Math.max(0, Math.min(pages.length - 1, page));
    setCurrent(index.current);
  }, [pages.length, step]);

  return (
    <View style={{ width }}>
      <ScrollView
        ref={rail}
        horizontal
        pagingEnabled
        snapToInterval={step}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => { touchedAt.current = Date.now(); }}
        onMomentumScrollEnd={settle}
        contentContainerStyle={{ gap }}
        style={{ width }}
      >
        {pages.map((page, i) => <View key={i} style={{ width }}>{page}</View>)}
      </ScrollView>
      {pages.length > 1 ? (
        <View style={styles.dots}>
          {pages.map((_, i) => (
            <Pressable key={i} hitSlop={8} onPress={() => { touchedAt.current = Date.now(); go(i); }}>
              <View style={[styles.dot, i === current && styles.dotOn]} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  dot: { width: 14, height: 3, borderRadius: 2, backgroundColor: colors.line },
  dotOn: { backgroundColor: colors.accent },
});
