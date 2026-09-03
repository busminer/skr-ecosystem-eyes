import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// The app's interface sounds. They are loaded once and replayed from the
// start, so a click costs nothing after the first one.
//
// One family, one material: metal and glass. A stake sings up (the bird), a
// small labelled stake is a drop into the vault, a large stake is the struck
// bell, a large exit is the tudum, a withdrawal is a door, and the day's own
// stake is a coin. The audio mode is set to mix: none of this may pause the
// music the person is already listening to.

const sources = {
  flip: require('../assets/sound/flip.wav'),
  surge: require('../assets/sound/surge.wav'),
  bird: require('../assets/sound/bird.wav'),
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

export function playCue(cue: Cue, volume = 0.5): void {
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
