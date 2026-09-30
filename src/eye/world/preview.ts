import type { EyeNetwork, NetworkEye } from '../api';
import { STEPS, STEP_DAYS, hash, stepOf } from './geometry';

// LAB BUILDS ONLY. A way to look at the world with hundreds of people before
// hundreds arrive: the real Eyes stay (yours among them) and invented ones
// fill the steps the way a network that size fills them. The names are made
// up and the tab says so in plain words while a preview is on. The store
// build never reaches this: EyesLab offers it only when IS_LAB_BUILD.

// Eyes per step, 30+ … 1, for each size.
const PRESETS: Record<number, number[]> = {
  40: [0, 0, 1, 2, 4, 6, 8, 10, 9],
  120: [0, 1, 2, 5, 9, 16, 24, 30, 33],
  507: [1, 3, 8, 16, 29, 47, 72, 121, 210],
  1000: [2, 6, 16, 32, 57, 93, 142, 239, 413],
};
export const PREVIEW_SIZES = [40, 120, 507, 1000] as const;

const WORDS = ['nova', 'sol', 'kim', 'dash', 'yoon', 'ferix', 'sati', 'astro', 'moon', 'pawcio', 'ghost', 'neo', 'zera', 'kosmo', 'led', 'rune',
  'vel', 'onyx', 'pix', 'juno', 'rex', 'mira', 'taro', 'zen', 'echo', 'lux', 'orbit', 'fox', 'wave', 'iris', 'bolt', 'nyx', 'sage', 'volt',
  'skye', 'ash', 'drift', 'flare', 'hope', 'ion', 'kiro', 'brio', 'tala', 'mako', 'quin', 'bree', 'oxa', 'vega', 'lyra', 'cato', 'dune',
  'finn', 'halo', 'jade', 'koa', 'lumo', 'mose', 'nero', 'opal', 'pike', 'rhea', 'sumi', 'tide', 'ume', 'vox', 'wren', 'yuri', 'zeta'];

const nameOf = (serial: number): string => {
  const word = WORDS[Math.floor(hash(serial * 5 + 3) * WORDS.length)] ?? 'eye';
  return `${word}${hash(serial * 5 + 4) < 0.62 ? Math.floor(hash(serial * 5 + 5) * 9000) + 10 : ''}.skr`;
};

export function previewNetwork(base: EyeNetwork, size: number): EyeNetwork {
  const counts = (PRESETS[size] ?? PRESETS[507]!).slice();
  const have = counts.map(() => 0);
  for (const eye of base.eyes) have[stepOf(eye.streak)]! += 1;
  let serial = base.eyes.reduce((most, eye) => Math.max(most, eye.serial), 0) + 1;
  const used = new Set(base.eyes.map((eye) => eye.name));
  const made: NetworkEye[] = [];
  counts.forEach((want, step) => {
    const lo = STEP_DAYS[step]!;
    const hi = step === 0 ? (size >= 1000 ? 80 : 60) : STEP_DAYS[step - 1]!;
    for (let k = have[step]!; k < want; k += 1) {
      const s = serial;
      serial += 1;
      let name = nameOf(s);
      while (used.has(name)) name = `${name.replace(/\.skr$/, '')}x.skr`;
      used.add(name);
      const streak = step === STEPS - 1 ? 1 : lo + Math.floor((hi - lo) * Math.pow(hash(s * 5 + 1), 1.8));
      made.push({ serial: s, name, streak, ring: step, blinkedToday: hash(s * 5 + 2) < 0.554, perfect: false, pool: null, moons: 0 });
    }
  });
  const eyes = [...base.eyes, ...made];
  const top = eyes.reduce((best, eye) => (eye.streak > best.streak ? eye : best), eyes[0]!);
  const listed = eyes.map((eye) => (eye === top && eye.streak >= 30 ? { ...eye, perfect: true } : eye));
  const awake = listed.filter((eye) => eye.blinkedToday).length;
  // With no wallet connected (the emulator) the preview speaks as the first
  // real Eye, so the gold ring, the tag and Around you can be looked at too.
  const first = base.eyes[0];
  const me = base.me ?? (first ? { serial: first.serial, ring: first.ring, streak: first.streak, moons: first.moons } : null);
  return {
    ...base,
    me,
    eyes: listed,
    ringCounts: counts.map((c, i) => Math.max(c, have[i]!)),
    totals: { ...base.totals, eyes: listed.length, watching: listed.length, blinkedToday: awake, perfect: listed.filter((eye) => eye.perfect).length, newToday: Math.max(1, Math.round(listed.length * 0.0237)) },
  };
}
