import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { prefValue } from './prefs';

// The app's interface sounds. They are loaded once and replayed from the
// start, so a click costs nothing after the first one.
//
// One family, one material: metal and glass. A stake is a coin settling into glass, a
// small labelled stake is a drop into the vault, a large stake is the struck
// bell, a large exit is the tudum, a withdrawal is a door, and the day's own
// stake is a coin. The audio mode is set to mix: none of this may pause the
// music the person is already listening to.

const sources = {
  flip: require('../assets/sound/flip.wav'),
  surge: require('../assets/sound/surge.wav'),
  stake: require('../assets/sound/stake.wav'),
  drop: require('../assets/sound/drop.wav'),
  tudum: require('../assets/sound/tudum.wav'),
  coin: require('../assets/sound/coin.wav'),
  door: require('../assets/sound/door.wav'),
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
    case 'tudum': impact(Haptics.ImpactFeedbackStyle.Medium); impact(Haptics.ImpactFeedbackStyle.Heavy, 300); break;
    case 'door': impact(Haptics.ImpactFeedbackStyle.Medium); break;
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
