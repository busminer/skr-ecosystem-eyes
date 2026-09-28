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
  // The Eye's two moments, borrowed from the launch: the note the eye wakes
  // on when it is first opened, and the wink for every Blink after that.
  wake: require('../assets/sound/wake.wav'),
  wink: require('../assets/sound/wink.wav'),
  // The walk-through of the Eye: since 28.09 evening, recorded sounds from
  // Mixkit (assets/sound/SOURCES.md) after Alex turned down three synthesised
  // sets. What follows is the history. The first set (27.09) sat at 85-110 Hz, which
  // a phone speaker rattles instead of playing; Alex called it unpleasant. The
  // set of 28.09 (scripts/make-eye-sounds.py) is a glass mallet from 440 Hz up,
  // in the register of the stake sound he picked: a faint pad once when the
  // walk-through appears, a struck glass for every step that lights, a soft
  // swell just before the lids part, and one rising note per page.
  hum: require('../assets/sound/hum.wav'),
  chime: require('../assets/sound/chime.wav'),
  heart: require('../assets/sound/heart.wav'),
  tone1: require('../assets/sound/tone1.wav'),
  tone2: require('../assets/sound/tone2.wav'),
  tone3: require('../assets/sound/tone3.wav'),
  tone4: require('../assets/sound/tone4.wav'),
  tone5: require('../assets/sound/tone5.wav'),
  tone6: require('../assets/sound/tone6.wav'),
  tone7: require('../assets/sound/tone7.wav'),
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
    case 'wake': case 'wink': break; // the Eye times its own buzz to the lids
    case 'hum': impact(Haptics.ImpactFeedbackStyle.Soft); break;
    case 'chime': impact(Haptics.ImpactFeedbackStyle.Light); break;
    // The swell grows for a second; the touch grows with it.
    case 'heart': impact(Haptics.ImpactFeedbackStyle.Soft); impact(Haptics.ImpactFeedbackStyle.Light, 480); impact(Haptics.ImpactFeedbackStyle.Medium, 920); break;
    // A page note: the page turn already ticks.
    case 'tone1': case 'tone2': case 'tone3': case 'tone4': case 'tone5': case 'tone6': case 'tone7': break;
  }
}

// A sound with its touch, each only if the person has left it on: the
// Eye's moments use this, so a phone on silent still feels them.
export function ritual(cue: Cue, volume = 0.4): void {
  const sound = prefValue('sound', true);
  const buzz = prefValue('buzz', true);
  if (sound) playCue(cue, volume, buzz);
  else if (buzz) cueHaptic(cue);
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
