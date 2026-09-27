import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { prefValue } from '../prefs';
import { playCue } from '../sound';
import { colors, radius } from '../theme';

// The Eye's picture, and the two moments it moves.
//
// The picture is drawn on the server: one square, the ring at a fixed place
// in it. Over that ring this draws the closed lens from the staker card, a
// dark disc with a fine seam where the two halves meet, and moves the halves
// apart. Once, slowly, when the Eye is first opened, with the picture coming
// up underneath it; and once quickly, shut and open again, every time it
// blinks. Between those two moments nothing here moves at all: no loop, no
// idle shimmer, nothing for the battery to pay for. The lids are not even
// mounted.

export type Motion = 'opening' | 'blink';

// Where the ring sits in the server's render, the Portal card: a 1200-square
// with the eye at (600, 640), drawn at 1.35 times its size on the staker card,
// where the ring's radius is 152, its stroke 9 and the seam 6 with 22 of
// margin either side. All of it as fractions of the picture's width, so the
// lens lands on the ring at whatever size the panel gets.
const LENS = {
  x: 0.5,
  y: 640 / 1200,
  r: (152 * 1.35) / 1200,
  stroke: (9 * 1.35) / 1200,
  seam: (6 * 1.35) / 1200,
  margin: 22 / 152,
};

const OPEN_MS = 900;
const SHUT_MS = 130;
const HOLD_MS = 40;
const REOPEN_MS = 180;
// How long the closed lens waits for the picture before the lids part anyway.
// Parting onto an empty box is a letdown; holding forever is worse.
const PATIENCE_MS = 2_000;

export function EyePicture({ uri, label, motion, onSettled }: { uri: string; label: string; motion: Motion | null; onSettled: () => void }) {
  const [size, setSize] = useState(0);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const [waited, setWaited] = useState(false);
  // Born shut only when the picture arrives mid-opening. An Eye that was
  // already open when the panel drew it shows straight away, no lids.
  const bornShut = useRef(motion === 'opening').current;
  const lids = useSharedValue(bornShut ? 0 : 1); // 0 shut, 1 fully apart
  const veil = useSharedValue(bornShut ? 1 : 0); // the dark around the lens
  const frame = useSharedValue(bornShut ? 1 : 0); // the ring's own stroke
  const picture = useSharedValue(bornShut ? 0 : 1);
  const running = useRef<Motion | null>(null);

  useEffect(() => {
    if (motion !== 'opening') { setWaited(false); return; }
    const timer = setTimeout(() => setWaited(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [motion]);

  const ready = motion === 'blink' || (motion === 'opening' && (loadedUri === uri || waited));

  useEffect(() => {
    if (!motion) { running.current = null; return; }
    if (!ready || running.current === motion) return;
    running.current = motion;
    const settle = (finished?: boolean) => {
      'worklet';
      if (finished) runOnJS(onSettled)();
    };
    const buzz = prefValue('buzz', true);
    const sound = prefValue('sound', true);
    if (motion === 'opening') {
      // The lids part: the heaviest touch the phone has, and the note the
      // launch wakes its own eye on.
      if (buzz) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
      if (sound) playCue('wake', 0.42, false);
      const ease = Easing.out(Easing.cubic);
      lids.value = withTiming(1, { duration: OPEN_MS, easing: ease }, settle);
      picture.value = withTiming(1, { duration: OPEN_MS, easing: ease });
      veil.value = withTiming(0, { duration: OPEN_MS, easing: ease });
      // The ring stays while the lids are still in it, and goes as they clear.
      frame.value = withDelay(OPEN_MS * 0.55, withTiming(0, { duration: OPEN_MS * 0.45 }));
    } else {
      // Shut fast, hold a beat, open a little slower, the way a real one goes.
      if (buzz) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      if (sound) playCue('wink', 0.5, false);
      frame.value = withSequence(withTiming(1, { duration: SHUT_MS }), withDelay(HOLD_MS, withTiming(0, { duration: REOPEN_MS })));
      lids.value = withSequence(
        withTiming(0.02, { duration: SHUT_MS, easing: Easing.in(Easing.quad) }),
        withDelay(HOLD_MS, withTiming(1, { duration: REOPEN_MS, easing: Easing.out(Easing.cubic) }, settle)),
      );
    }
  }, [motion, ready, onSettled, lids, veil, frame, picture]);

  const R = size * LENS.r;
  const cx = size * LENS.x;
  const cy = size * LENS.y;
  const stroke = Math.max(3, size * LENS.stroke);
  const seam = Math.max(2, size * LENS.seam);
  const margin = `${Math.round(LENS.margin * 50)}%` as const;

  const pictureStyle = useAnimatedStyle(() => ({ opacity: picture.value }));
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));
  const frameStyle = useAnimatedStyle(() => ({ opacity: frame.value }));
  // A seam's worth past the radius, so each lid clears the circle entirely.
  const topStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -(R + seam) * lids.value }] }), [R, seam]);
  const bottomStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (R + seam) * lids.value }] }), [R, seam]);

  const lens = { position: 'absolute' as const, left: cx - R, top: cy - R, width: R * 2, height: R * 2, borderRadius: R };

  return (
    <View style={styles.box} onLayout={(event) => setSize(event.nativeEvent.layout.width)}>
      <Animated.Image
        key={uri}
        source={{ uri }}
        style={[styles.image, pictureStyle]}
        resizeMode="cover"
        accessibilityLabel={label}
        onLoad={() => setLoadedUri(uri)}
      />
      {motion ? (
        <View pointerEvents="none" style={styles.overlay}>
          <Animated.View style={[styles.veil, veilStyle]} />
          {size > 0 ? (
            <>
              {/* The lens clips the two lids, so as they slide out they
                  simply stop being there and the picture is what is left. */}
              <View style={[lens, styles.lens]}>
                <Animated.View style={[styles.lid, { top: 0, height: R }, topStyle]}>
                  <View style={[styles.shadowSeam, { left: margin, right: margin, height: seam / 2 }]} />
                </Animated.View>
                <Animated.View style={[styles.lid, { top: R, height: R }, bottomStyle]}>
                  <View style={[styles.litSeam, { left: margin, right: margin, height: seam, borderRadius: seam / 2 }]} />
                </Animated.View>
              </View>
              {/* The stroke rides above the lids, never painted over by them. */}
              <Animated.View style={[lens, { borderWidth: stroke }, styles.frame, frameStyle]} />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', aspectRatio: 1, borderRadius: radius.inner, backgroundColor: colors.inset, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  veil: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.inset },
  lens: { overflow: 'hidden', backgroundColor: 'transparent' },
  // The lid colours are the card's: the disc a lens shows with nothing
  // looking out of it, the seam a shade lighter, its shadow nearly black.
  lid: { position: 'absolute', left: 0, right: 0, backgroundColor: '#111A20' },
  shadowSeam: { position: 'absolute', bottom: 0, backgroundColor: '#000A0E', opacity: 0.7 },
  litSeam: { position: 'absolute', top: 0, backgroundColor: '#2B3B45' },
  frame: { borderColor: '#3A5B68' },
});
