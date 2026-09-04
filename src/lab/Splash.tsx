import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { prefValue, prefsReady } from '../prefs';
import { colors, font, spacing } from '../theme';

// The opening: the first stone.
//
// One phone falls into the dark. It lands with the glass chime every stake
// makes in the vault, and from where it lands a wave runs through the pile:
// thousands of holders come up out of the black. Over the pile the eye opens,
// the name settles under it, and the eye winks once before the app takes
// over. Nothing here is invented data: the pile is a silhouette, the stone is
// a stone.
//
// The sound scheme, one voice per moment and nothing sharp in it: a soft
// whistle of air as the stone falls; the vault's own glass chime when it
// lands; the old opening sweep, once, as the eye opens; two mellow notes for
// the wink. Every sound has its touch when buzz is on.

const FALL_MS = 900;
const LAND_AT = 900;
const WAVE_MS = 900;
const EYE_AT = 1_800;
const EYE_MS = 420;
const WORD_AT = 2_080;
const WINK_AT = 2_900;
const SETTLE_AT = 3_700;
const LEAVE_AT = 4_300;
const LEAVE_MS = 400;
const WHISTLE_AT = 60;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

// A fixed seed: the pile looks the same on every launch, like a logo.
function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

type Piled = { x: number; y: number; w: number; h: number; r: number; a: number };

export function Splash({ onDone }: { onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const pileTop = Math.round(H * 0.66);
  const landX = W / 2;
  const landY = pileTop - 8;
  const eyeY = Math.round(H * 0.40);

  const pile = useMemo<Piled[]>(() => {
    const rnd = seeded(7);
    const rows: Piled[] = [];
    const surface = (x: number) => pileTop + Math.sin(x * 0.02) * 4 + Math.sin(x * 0.055 + 2) * 2.5;
    for (let i = 0; i < 260; i += 1) {
      const u = rnd();
      const d = Math.pow(rnd(), 1.3);
      const x = u * W;
      const w = rnd() > 0.5 ? 7 : 5.2;
      rows.push({ x, y: surface(x) + d * (H - pileTop - 10) + 6, w, h: w * 1.75, r: (rnd() - 0.5) * 18, a: 0.55 - 0.4 * d });
    }
    return rows;
  }, [W, H, pileTop]);

  const surfacePath = useMemo(() => {
    let d = `M0 ${pileTop}`;
    for (let x = 0; x <= W; x += 6) d += ` L${x} ${(pileTop + Math.sin(x * 0.02) * 4 + Math.sin(x * 0.055 + 2) * 2.5).toFixed(1)}`;
    return d;
  }, [W, pileTop]);

  const fall = useSharedValue(0);
  const wave = useSharedValue(0);
  const flash = useSharedValue(0);
  const eye = useSharedValue(0);
  const lid = useSharedValue(1);
  const word = useSharedValue(0);
  const leave = useSharedValue(0);

  useEffect(() => {
    let gone = false;
    const players: Array<ReturnType<typeof createAudioPlayer>> = [];
    const voice = async (source: number, volume: number) => {
      await prefsReady;
      if (gone || !prefValue('sound', true)) return;
      try {
        const player = createAudioPlayer(source);
        player.volume = volume;
        players.push(player);
        player.play();
      } catch {
        // A launch that cannot make a sound is still a launch.
      }
    };
    const touch = (style: Haptics.ImpactFeedbackStyle) => {
      void prefsReady.then(() => { if (!gone && prefValue('buzz', true)) void Haptics.impactAsync(style).catch(() => undefined); });
    };
    const timers = [
      setTimeout(() => void voice(require('../../assets/sound/whistle.wav'), 0.5), WHISTLE_AT),
      setTimeout(() => { void voice(require('../../assets/sound/stake.wav'), 0.6); touch(Haptics.ImpactFeedbackStyle.Medium); }, LAND_AT),
      setTimeout(() => { void voice(require('../../assets/sound/wake.wav'), 0.42); touch(Haptics.ImpactFeedbackStyle.Light); }, EYE_AT),
      setTimeout(() => { void voice(require('../../assets/sound/wink.wav'), 0.5); touch(Haptics.ImpactFeedbackStyle.Light); }, WINK_AT),
    ];

    fall.value = withTiming(1, { duration: FALL_MS, easing: Easing.in(Easing.cubic) });
    wave.value = withDelay(LAND_AT, withTiming(1, { duration: WAVE_MS, easing: Easing.out(Easing.cubic) }));
    flash.value = withDelay(LAND_AT, withSequence(withTiming(0.22, { duration: 40 }), withTiming(0, { duration: 180 })));
    eye.value = withDelay(EYE_AT, withTiming(1, { duration: EYE_MS, easing: Easing.out(Easing.back(1.4)) }));
    // The wink: shut fast, hold a beat, open a little slower, the way a real one goes.
    lid.value = withDelay(WINK_AT, withSequence(
      withTiming(0.04, { duration: 100, easing: Easing.in(Easing.quad) }),
      withDelay(70, withTiming(1, { duration: 190, easing: Easing.out(Easing.back(1.2)) })),
      // A slow half-close later, the eye settling, so the hold is not a still.
      withDelay(SETTLE_AT - WINK_AT - 360, withTiming(0.55, { duration: 260, easing: Easing.inOut(Easing.quad) })),
      withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }),
    ));
    word.value = withDelay(WORD_AT, withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
    leave.value = withDelay(LEAVE_AT, withTiming(1, { duration: LEAVE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onDone)();
    }));

    return () => {
      gone = true;
      timers.forEach((timer) => clearTimeout(timer));
      players.forEach((item) => item.remove());
    };
  }, [fall, wave, flash, eye, lid, word, leave, onDone]);

  const screenStyle = useAnimatedStyle(() => ({ opacity: 1 - leave.value }));

  // The stone: straight down, a little spin, and it sinks a touch when it lands.
  const stoneStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -40 + (landY + 40) * fall.value + wave.value * 5 },
      { rotate: `${(1 - fall.value) * 14}deg` },
    ],
  }));

  const revealProps = useAnimatedProps(() => ({ r: 1 + wave.value * W * 1.25 }));
  const rippleProps = useAnimatedProps(() => ({ rx: wave.value * W * 0.9, ry: wave.value * W * 0.2, strokeOpacity: 0.7 * (1 - wave.value) }));
  const flashProps = useAnimatedProps(() => ({ fillOpacity: flash.value }));

  const eyeStyle = useAnimatedStyle(() => ({
    opacity: eye.value,
    transform: [
      { scale: 0.6 + 0.4 * eye.value },
      { scaleY: lid.value },
    ],
  }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: eye.value * (0.6 + 0.4 * lid.value) }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: word.value, transform: [{ translateY: (1 - word.value) * 8 }] }));

  return (
    <Animated.View style={[styles.screen, screenStyle]} pointerEvents="none">
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="soft" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#fff" stopOpacity={1} />
            <Stop offset="0.72" stopColor="#fff" stopOpacity={1} />
            <Stop offset="1" stopColor="#fff" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="stoneGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#7CF0BC" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#7CF0BC" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="pileFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#7CF0BC" stopOpacity={0.16} />
            <Stop offset="1" stopColor="#7CF0BC" stopOpacity={0} />
          </LinearGradient>
          <Mask id="reveal" maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
            <AnimatedCircle cx={landX} cy={landY} animatedProps={revealProps} fill="url(#soft)" />
          </Mask>
        </Defs>

        {/* a few motes in the dark, so the black is a sky and not a hole */}
        {STARS.map((s, i) => <Circle key={i} cx={s[0] * W} cy={s[1] * H * 0.6} r={0.8} fill="#A0CDE1" opacity={0.10 + s[2] * 0.14} />)}

        <G mask="url(#reveal)">
          <Rect x={0} y={pileTop} width={W} height={H - pileTop} fill="url(#pileFill)" />
          <Path d={surfacePath} stroke="#7CF0BC" strokeOpacity={0.3} strokeWidth={1} fill="none" />
          {pile.map((q, i) => (
            <Rect key={i} x={q.x - q.w / 2} y={q.y - q.h / 2} width={q.w} height={q.h} rx={q.w * 0.22} fill="#0F2A36" fillOpacity={0.9} stroke="#7CF0BC" strokeOpacity={q.a} strokeWidth={1} transform={`rotate(${q.r.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)})`} />
          ))}
        </G>

        <AnimatedEllipse cx={landX} cy={landY} stroke="#7CF0BC" strokeWidth={1.5} fill="none" animatedProps={rippleProps} />
        <AnimatedRect x={0} y={0} width={W} height={H} fill="#7CF0BC" animatedProps={flashProps} />
      </Svg>

      {/* the stone itself, a phone the colour of every stake in the vault */}
      <Animated.View style={[styles.stone, { left: landX - 45 }, stoneStyle]}>
        <Svg width={90} height={90} viewBox="0 0 90 90" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="stoneHalo" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#7CF0BC" stopOpacity={0.5} />
              <Stop offset="1" stopColor="#7CF0BC" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={45} cy={45} r={45} fill="url(#stoneHalo)" />
        </Svg>
        <View style={styles.stoneBody} />
      </Animated.View>

      <Animated.View style={[styles.halo, { top: eyeY - 150, left: W / 2 - 150 }, haloStyle]}>
        <Svg width={300} height={300} viewBox="0 0 300 300">
          <Defs>
            <RadialGradient id="eyeHalo" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#56E0FF" stopOpacity={0.16} />
              <Stop offset="0.55" stopColor="#56E0FF" stopOpacity={0.05} />
              <Stop offset="1" stopColor="#56E0FF" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={150} cy={150} r={150} fill="url(#eyeHalo)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.eye, { top: eyeY - 60, left: W / 2 - 60 }, eyeStyle]}>
        <Svg width={120} height={120} viewBox="0 0 100 100">
          <Path d="M12 50 C22 29 34 24 50 24 C66 24 78 29 88 50 C78 71 66 76 50 76 C34 76 22 71 12 50 Z" fill="#070B0E" stroke={colors.accent} strokeWidth={3.2} />
          <Path d="M13 50 C24 37 34 33 50 33 L50 67 C34 67 24 63 13 50 Z" fill="#101A21" />
          <Path d="M87 50 C76 37 66 33 50 33 L50 67 C66 67 76 63 87 50 Z" fill="#16242D" />
          <Circle cx={50} cy={50} r={16} fill="#050B10" stroke="#3A5B68" strokeWidth={2.4} />
          <Circle cx={50} cy={50} r={8.5} fill={colors.metal} />
          <Circle cx={50} cy={50} r={3.6} fill="#020304" />
          <Circle cx={46.5} cy={46.5} r={1.9} fill="#F4FBFD" />
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.word, { top: eyeY + 74 }, wordStyle]}>
        <Text style={styles.wordmark}>SKR EYES</Text>
      </Animated.View>
    </Animated.View>
  );
}

const STARS: Array<[number, number, number]> = (() => {
  const rnd = seeded(3);
  return Array.from({ length: 46 }, () => [rnd(), rnd(), rnd()] as [number, number, number]);
})();

const styles = StyleSheet.create({
  screen: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#05080D', zIndex: 20 },
  stone: { position: 'absolute', top: -36, width: 90, height: 90, alignItems: 'center', justifyContent: 'center' },
  stoneBody: { width: 10, height: 17, borderRadius: 3, backgroundColor: colors.positive },
  halo: { position: 'absolute', width: 300, height: 300 },
  eye: { position: 'absolute', width: 120, height: 120 },
  word: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  wordmark: { color: colors.text, fontFamily: font.black, fontSize: 15, letterSpacing: 3.4, textAlign: 'center', paddingLeft: 3.4, marginTop: spacing.sm },
});
