import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { prefValue } from './prefs';

// The app's interface sounds. They are loaded once and replayed from the
// start, so a click costs nothing after the first one.
//
// Three voices for three moves, all from a hundred thousand SKR: a large stake
// arrives on a fifth going up, a large exit is one low tone bending down, a
// large withdrawal is a short dry fall. The rest of the set serves the opening
// and the tip sheet.
//
// The three were rewritten on 22.09. The old set was literal — an old phone
// ringing, a cinematic tudum, a door closing — which is a lot of character for
// what is really a number crossing a line. These are instruments instead: one
// soft mallet on metal, three intervals. Alex picked them by ear on the phone.
//
// The audio mode is set to mix: none of this may pause the
// music the person is already listening to.

const sources = {
  flip: require('../assets/sound/flip.wav'),
  surge: require('../assets/sound/surge.wav'),
  stake: require('../assets/sound/stake.wav'),
  drop: require('../assets/sound/drop.wav'),
  coin: require('../assets/sound/coin.wav'),
  in: require('../assets/sound/in.wav'),
  out: require('../assets/sound/out.wav'),
  gone: require('../assets/sound/gone.wav'),
} as const;

export type Cue = keyof typeof sources;

const players = new Map<Cue, AudioPlayer>();

export async function prepareSound(): Promise<void> {
  try {
    await setAudioModeAsync({ interruptionMode: 'mixWithOthers', shouldPlayInBackground: false, playsInSilentMode: true });
  } catch {
    // An audio mode we could not set is not a reason to fail a launch.
  }
}

// The buzz that belongs to each sound. A sound without a touch is half an
// event on a phone: the pair is what makes a person feel it land without
// looking. Heavy things knock twice, light things tap once.
export function cueHaptic(cue: Cue): void {
  const impact = (style: Haptics.ImpactFeedbackStyle, delay = 0) => {
    setTimeout(() => { void Haptics.impactAsync(style).catch(() => undefined); }, delay);
  };
  switch (cue) {
    case 'surge': impact(Haptics.ImpactFeedbackStyle.Heavy); impact(Haptics.ImpactFeedbackStyle.Medium, 160); break;
    // Each buzz follows its own sound: two notes get two taps, one tone gets one.
    case 'in': impact(Haptics.ImpactFeedbackStyle.Light); impact(Haptics.ImpactFeedbackStyle.Light, 85); break;
    case 'out': impact(Haptics.ImpactFeedbackStyle.Medium); break;
    case 'gone': impact(Haptics.ImpactFeedbackStyle.Medium); impact(Haptics.ImpactFeedbackStyle.Light, 100); break;
    case 'coin': impact(Haptics.ImpactFeedbackStyle.Light); impact(Haptics.ImpactFeedbackStyle.Light, 90); break;
    case 'stake': impact(Haptics.ImpactFeedbackStyle.Light); break;
    case 'drop': impact(Haptics.ImpactFeedbackStyle.Light); break;
    case 'flip': break; // the flip board buzzes on its own, once per change
  }
}

export function playCue(cue: Cue, volume = 0.5, buzz = true): void {
  if (buzz && prefValue('buzz', true)) cueHaptic(cue);
  try {
    let player = players.get(cue);
    if (!player) {
      player = createAudioPlayer(sources[cue]);
      players.set(cue, player);
    }
    player.volume = volume;
    if (player.currentTime > 0) void player.seekTo(0).catch(() => undefined);
    player.play();
  } catch {
    // Silence is an acceptable outcome for a sound effect.
  }
}
