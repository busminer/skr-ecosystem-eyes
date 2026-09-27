import { useEffect, useRef } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

// The Eye exactly as the NFT draws it, with lids that move.
//
// The picture is the portal cut out of the collection card the server
// renders (assets/eye/portal.png: the glowing ring, the lens, the gold iris,
// no lettering), so what the walk-through shows is what the wallet will show.
// The lids are the ones EyePicture draws over a real card: two halves of a
// dark disc inside the lens, clipped by a round view, sliding apart. They are
// plain views moved on the UI thread, not an SVG clip path: on Android a clip
// path is read once and never again, which is how a lid ends up stuck shut.
//
// `open` parts the lids slowly (or shuts them at once when it goes false);
// each new `blink` number is one quick blink. `instant` skips the motion, for
// a person who asked the phone for less of it.

const PORTAL = require('../../assets/eye/portal.png');

// The crop is 660 units of the 1200-unit card around the eye at (600, 640),
// where the lens radius is 152 x 1.35, its stroke 9 x 1.35 and the seam
// 6 x 1.35 with 22 of margin either side (the same numbers as EyePicture).
const LENS = { r: (152 * 1.35) / 660, stroke: (9 * 1.35) / 660, seam: (6 * 1.35) / 660, margin: 22 / 152 };

const OPEN_MS = 950;
const SHUT_MS = 130;
const HOLD_MS = 50;
const REOPEN_MS = 190;

export function PortalEye({ size, open, blink = 0, instant = false }: { size: number; open: boolean; blink?: number; instant?: boolean }) {
  const lids = useSharedValue(open ? 1 : 0); // 0 shut, 1 fully apart
  const frame = useSharedValue(open ? 0 : 1); // the lens's own stroke, drawn while the lids are in it
  const seen = useRef(blink);

  useEffect(() => {
    if (instant || !open) {
      lids.value = open ? 1 : 0;
      frame.value = open ? 0 : 1;
      return;
    }
    const ease = Easing.out(Easing.cubic);
    lids.value = withTiming(1, { duration: OPEN_MS, easing: ease });
    frame.value = withDelay(OPEN_MS * 0.55, withTiming(0, { duration: OPEN_MS * 0.45 }));
  }, [open, instant, lids, frame]);

  useEffect(() => {
    if (blink === seen.current) return;
    seen.current = blink;
    if (instant || !open) return;
    frame.value = withSequence(withTiming(1, { duration: SHUT_MS }), withDelay(HOLD_MS, withTiming(0, { duration: REOPEN_MS })));
    lids.value = withSequence(
      withTiming(0.02, { duration: SHUT_MS, easing: Easing.in(Easing.quad) }),
      withDelay(HOLD_MS, withTiming(1, { duration: REOPEN_MS, easing: Easing.out(Easing.cubic) })),
    );
  }, [blink, open, instant, lids, frame]);

  const R = size * LENS.r;
  const seam = Math.max(1.5, size * LENS.seam);
  const stroke = Math.max(1.5, size * LENS.stroke);
  const margin = `${Math.round(LENS.margin * 50)}%` as const;
  const lens = { position: 'absolute' as const, left: size / 2 - R, top: size / 2 - R, width: R * 2, height: R * 2, borderRadius: R };

  // A seam's worth past the radius, so each lid clears the circle entirely.
  const top = useAnimatedStyle(() => ({ transform: [{ translateY: -(R + seam) * lids.value }] }), [R, seam]);
  const bottom = useAnimatedStyle(() => ({ transform: [{ translateY: (R + seam) * lids.value }] }), [R, seam]);
  const ring = useAnimatedStyle(() => ({ opacity: frame.value }));

  return (
    <View style={{ width: size, height: size }}>
      <Image source={PORTAL} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="cover" />
      <View pointerEvents="none" style={[lens, styles.lens]}>
        <Animated.View style={[styles.lid, { top: 0, height: R }, top]}>
          <View style={[styles.shadowSeam, { left: margin, right: margin, height: seam / 2 }]} />
        </Animated.View>
        <Animated.View style={[styles.lid, { top: R, height: R }, bottom]}>
          <View style={[styles.litSeam, { left: margin, right: margin, height: seam, borderRadius: seam / 2 }]} />
        </Animated.View>
      </View>
      <Animated.View pointerEvents="none" style={[lens, { borderWidth: stroke }, styles.frame, ring]} />
    </View>
  );
}

const styles = StyleSheet.create({
  lens: { overflow: 'hidden', backgroundColor: 'transparent' },
  // The card's own colours: the disc a lens shows with nothing looking out of
  // it, the seam a shade lighter, its shadow nearly black.
  lid: { position: 'absolute', left: 0, right: 0, backgroundColor: '#111A20' },
  shadowSeam: { position: 'absolute', bottom: 0, backgroundColor: '#000A0E', opacity: 0.7 },
  litSeam: { position: 'absolute', top: 0, backgroundColor: '#2B3B45' },
  frame: { borderColor: '#3A5B68' },
});
