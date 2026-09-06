import { useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { prefValue, prefsReady } from '../prefs';
import { t } from '../i18n';
import { colors, font, spacing } from '../theme';

// The opening: a device stands facing you, turns the way a person turns, and
// the eye comes out of its camera and blinks once. That blink is the whole
// name of the product.
//
// The silhouette is deliberately our own — a plain slab with a camera island.
// It must read as "a phone", never as a copy of the Seeker's industrial
// design, since the app declares it is not affiliated with Solana Mobile.
//
// Timings are tied to the sound: the sweep runs while the body turns, and the
// two dry ticks land exactly on the blink.
//
// Behind it all, from 1.2, the rings of the Top radar and one beam that goes
// round once while the opening lasts. Alex chose this ground on 06.09 and asked
// for a second more room, so everything up to the blink is untouched to the
// millisecond and the extra second is spent on the hold that follows it: the
// eye stays open, the beam finishes its turn, and only then does the screen go.

const ENTER_MS = 260;
const TURN_AT = 260;
const TURN_MS = 620;
const EYE_AT = 900;
const EYE_MS = 350;
const BLINK_AT = 1_290;
const LEAVE_AT = 2_760;
const LEAVE_MS = 300;
// The rings are the tiers of the leaderboard, in the proportions the radar
// draws them, and the beam takes the whole opening for one pass.
const RINGS = [46, 74, 104, 136, 170, 206];
const BEAM_MS = LEAVE_AT + LEAVE_MS;
const FLASH_AT = BLINK_AT + 40;
const FLASH_MS = 460;
// A fixed sky: the same star dust as the vault, drawn once from a fixed seed so
// the opening looks the same on every launch.
const STARS = (() => {
  let s = 31;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return Array.from({ length: 44 }, () => ({ x: rnd(), y: rnd() * 0.9, o: 0.12 + 0.3 * rnd(), r: 1 + rnd() }));
})();
const SOUND_AT = 240;
// The opening sound is played twice, the second a breath behind the first and
// quieter. This started as an accident — a re-running effect created a second
// player at an unpredictable moment — and Alex liked how it sounded, so it is
// now deliberate: a fixed offset instead of a race, the same on every launch.
const ECHO_AT = SOUND_AT + 300;
const ECHO_VOLUME = 0.38;

export function SplashTurn({ onDone }: { onDone: () => void }) {
  const enter = useSharedValue(0);
  const turn = useSharedValue(0);
  const eye = useSharedValue(0);
  const lid = useSharedValue(0);
  const leave = useSharedValue(0);
  const beam = useSharedValue(0);
  const flash = useSharedValue(0);
  const { width: screenW, height: screenH } = useWindowDimensions();
  // Where the device stands, measured rather than guessed: the rings have to sit
  // on it, not on the middle of the screen, which the wordmark below shifts.
  const [centre, setCentre] = useState<{ x: number; y: number } | null>(null);
  const reach = Math.round(Math.max(screenW, screenH) * 0.62);

  useEffect(() => {
    let gone = false;
    const players: Array<ReturnType<typeof createAudioPlayer>> = [];
    // The switch on Flow says whether this phone makes sounds at all, and the
    // opening is a sound like any other. It used to play regardless, so the one
    // person who had turned sound off got a chime on every single launch.
    const voice = async (volume: number) => {
      await prefsReady;
      if (gone || !prefValue('sound', true)) return;
      try {
        const player = createAudioPlayer(require('../../assets/sound/wake.wav'));
        player.volume = volume;
        players.push(player);
        player.play();
      } catch {
        // A launch that cannot make a sound is still a launch.
      }
    };
    const sound = setTimeout(() => void voice(0.55), SOUND_AT);
    // The opening gets its touch too: one light tap as the device turns, one
    // as the eye blinks, if the person keeps buzz on.
    const buzz = setTimeout(() => { void prefsReady.then(() => { if (!gone && prefValue('buzz', true)) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); }); }, SOUND_AT);
    const blinkBuzz = setTimeout(() => { void prefsReady.then(() => { if (!gone && prefValue('buzz', true)) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); }); }, BLINK_AT);
    const echo = setTimeout(() => void voice(ECHO_VOLUME), ECHO_AT);

    beam.value = withTiming(1, { duration: BEAM_MS, easing: Easing.linear });
    flash.value = withDelay(FLASH_AT, withTiming(1, { duration: FLASH_MS, easing: Easing.out(Easing.quad) }));
    enter.value = withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) });
    turn.value = withDelay(TURN_AT, withTiming(1, { duration: TURN_MS, easing: Easing.inOut(Easing.cubic) }));
    eye.value = withDelay(EYE_AT, withTiming(1, { duration: EYE_MS, easing: Easing.out(Easing.back(1.6)) }));
    lid.value = withDelay(BLINK_AT, withSequence(
      withTiming(1, { duration: 110, easing: Easing.in(Easing.quad) }),
      withTiming(0, { duration: 130, easing: Easing.out(Easing.quad) }),
      withDelay(70, withTiming(1, { duration: 120, easing: Easing.in(Easing.quad) })),
      withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) }),
    ));
    leave.value = withDelay(LEAVE_AT, withTiming(1, { duration: LEAVE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onDone)();
    }));

    return () => {
      gone = true;
      clearTimeout(sound);
      clearTimeout(echo);
      clearTimeout(buzz);
      clearTimeout(blinkBuzz);
      players.forEach((item) => item.remove());
    };
  }, [beam, enter, flash, turn, eye, lid, leave, onDone]);

  const screenStyle = useAnimatedStyle(() => ({ opacity: 1 - leave.value }));

  // One pass of the beam over the whole opening, and the ring the blink lights.
  const beamStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-70 + beam.value * 430}deg` }] }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: (1 - flash.value) * 0.85, transform: [{ scale: 1 + flash.value * 1.6 }] }));

  // The turn: the front narrows away and the back comes round. No 3D engine,
  // just honest foreshortening on two faces that hand over at the halfway mark.
  const frontStyle = useAnimatedStyle(() => ({
    opacity: enter.value * (turn.value < 0.5 ? 1 : 0),
    transform: [
      { perspective: 900 },
      { scale: 0.94 + enter.value * 0.06 },
      { rotateY: `${turn.value * 90}deg` },
    ],
  }));

  const rearStyle = useAnimatedStyle(() => ({
    opacity: turn.value < 0.5 ? 0 : 1,
    transform: [
      { perspective: 900 },
      { rotateY: `${-90 + turn.value * 90}deg` },
    ],
  }));

  const lensStyle = useAnimatedStyle(() => ({ opacity: 1 - eye.value }));

  const eyeStyle = useAnimatedStyle(() => ({
    opacity: eye.value,
    transform: [{ scale: 0.15 + eye.value * 0.85 }],
  }));

  const lidTopStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -26 + lid.value * 26 }] }));
  const lidBottomStyle = useAnimatedStyle(() => ({ transform: [{ translateY: 26 - lid.value * 26 }] }));

  const wordStyle = useAnimatedStyle(() => ({
    opacity: turn.value,
    transform: [{ translateY: (1 - turn.value) * 10 }],
  }));

  return (
    <Animated.View style={[styles.screen, screenStyle]} pointerEvents="none">
      {/* The ground: the vault's star dust and the rings of the Top radar,
          centred on the device rather than on the screen. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={screenW} height={screenH}>
          {STARS.map((star, index) => (
            <Rect key={`star${index}`} x={star.x * screenW} y={star.y * screenH} width={star.r} height={star.r} fill="#A0CDE1" opacity={star.o} />
          ))}
          {centre ? RINGS.map((r, index) => (
            <Circle key={r} cx={centre.x} cy={centre.y} r={r} stroke="#78B4CD" strokeOpacity={0.2 - index * 0.02} strokeWidth={1} fill="none" />
          )) : null}
        </Svg>
      </View>
      {centre ? (
        <Animated.View pointerEvents="none" style={[styles.beam, { left: centre.x - reach, top: centre.y - reach, width: reach * 2, height: reach * 2 }, beamStyle]}>
          <Svg width={reach * 2} height={reach * 2}>
            <Defs>
              <LinearGradient id="beamFade" x1="0" y1="1" x2="0" y2="0">
                <Stop offset="0" stopColor={colors.accent} stopOpacity="0.17" />
                <Stop offset="0.5" stopColor={colors.accent} stopOpacity="0.05" />
                <Stop offset="1" stopColor={colors.accent} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            {/* A narrow wedge: wide enough to read as a beam, not so wide it
                becomes a triangle lying across the screen. */}
            <Path d={`M ${reach} ${reach} L ${reach + reach * 0.9004} ${reach - reach * 0.4350} A ${reach} ${reach} 0 0 1 ${reach * 2} ${reach} Z`} fill="url(#beamFade)" />
            <Path d={`M ${reach} ${reach} L ${reach * 2} ${reach}`} stroke={colors.accent} strokeOpacity={0.45} strokeWidth={1} />
          </Svg>
        </Animated.View>
      ) : null}
      {centre ? (
        <Animated.View pointerEvents="none" style={[styles.pulseRing, { left: centre.x - RINGS[0]!, top: centre.y - RINGS[0]! }, flashStyle]} />
      ) : null}
      <View
        style={styles.stage}
        onLayout={(event) => {
          const { x, y, width, height } = event.nativeEvent.layout;
          setCentre({ x: x + width / 2, y: y + height / 2 });
        }}
      >
        <Animated.View style={[styles.body, styles.front, frontStyle]}>
          <View style={styles.display}>
            <View style={styles.earpiece} />
            <View style={styles.selfie} />
          </View>
        </Animated.View>

        <Animated.View style={[styles.body, styles.rear, rearStyle]}>
          <View style={styles.island}>
            <View style={styles.islandLens} />
            <View style={styles.islandLens} />
          </View>
          <View style={styles.flash} />

          <View style={styles.camera}>
            <Animated.View style={[styles.cameraLens, lensStyle]} />
            <Animated.View style={[styles.eye, eyeStyle]}>
              <View style={styles.iris}>
                <View style={styles.pupil} />
                <View style={styles.spark} />
              </View>
              <Animated.View style={[styles.lid, styles.lidTop, lidTopStyle]} />
              <Animated.View style={[styles.lid, styles.lidBottom, lidBottomStyle]} />
            </Animated.View>
          </View>

          <View style={styles.vaultPanel}>
            <View style={styles.vaultRing} />
          </View>
          <View style={styles.sideButton} />
        </Animated.View>
      </View>

      <Animated.View style={wordStyle}>
        <Text style={styles.wordmark}>SKR EYES</Text>
        <Text style={styles.tagline}>{t('every number has a receipt')}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.xxl, zIndex: 20 },
  stage: { width: 150, height: 300, alignItems: 'center', justifyContent: 'center' },
  beam: { position: 'absolute' },
  pulseRing: { position: 'absolute', width: RINGS[0]! * 2, height: RINGS[0]! * 2, borderRadius: RINGS[0]!, borderWidth: 2, borderColor: colors.metal, opacity: 0 },
  body: { position: 'absolute', width: 132, height: 276, borderRadius: 24, borderWidth: 1.5, backfaceVisibility: 'hidden' },
  front: { backgroundColor: '#10161C', borderColor: '#31454f', alignItems: 'center', paddingTop: spacing.lg },
  display: { position: 'absolute', left: 4, right: 4, top: 4, bottom: 4, borderRadius: 20, backgroundColor: '#04070B', borderWidth: 1, borderColor: 'rgba(167,228,239,0.10)', alignItems: 'center', paddingTop: 10 },
  earpiece: { width: 24, height: 2, borderRadius: 2, backgroundColor: '#293c45' },
  selfie: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#1f3a44', marginTop: 5 },
  rear: { backgroundColor: '#1B262D', borderColor: '#415761' },
  island: { position: 'absolute', left: 16, top: 44, width: 26, height: 54, borderRadius: 13, backgroundColor: '#030506', borderWidth: 2, borderColor: '#354a54', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 4 },
  islandLens: { width: 15, height: 15, borderRadius: 8, backgroundColor: '#050B10', borderWidth: 1, borderColor: '#1b2a30' },
  flash: { position: 'absolute', left: 52, top: 46, width: 8, height: 8, borderRadius: 4, backgroundColor: '#9daaaa' },
  camera: { position: 'absolute', left: 16, top: 15, width: 26, height: 26, borderRadius: 13, backgroundColor: '#020405', borderWidth: 2, borderColor: '#435762', alignItems: 'center', justifyContent: 'center' },
  cameraLens: { position: 'absolute', left: 4, right: 4, top: 4, bottom: 4, borderRadius: 9, backgroundColor: '#0A1520', borderWidth: 1, borderColor: '#233b45' },
  eye: { width: 34, height: 26, borderRadius: 13, backgroundColor: '#F4F1E9', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  iris: { width: 17, height: 17, borderRadius: 9, backgroundColor: colors.metal, alignItems: 'center', justifyContent: 'center' },
  pupil: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#020304' },
  spark: { position: 'absolute', left: 3, top: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF' },
  lid: { position: 'absolute', left: 0, right: 0, height: 15, backgroundColor: '#42505A' },
  lidTop: { top: 0 },
  lidBottom: { bottom: 0 },
  vaultPanel: { position: 'absolute', left: -1, top: 110, width: 46, height: 66, borderRadius: 8, backgroundColor: '#0A1017', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', paddingLeft: 9, paddingTop: 8 },
  vaultRing: { width: 11, height: 11, borderRadius: 6, borderWidth: 1, borderColor: '#86989f', opacity: 0.75 },
  sideButton: { position: 'absolute', right: -3, top: 104, width: 3, height: 22, borderRadius: 2, backgroundColor: '#74858c' },
  wordmark: { color: colors.text, fontFamily: font.black, fontSize: 20, letterSpacing: 3, textAlign: 'center' },
  tagline: { color: colors.faint, fontFamily: font.regular, fontSize: 12, letterSpacing: 0.4, textAlign: 'center', marginTop: spacing.sm },
});
