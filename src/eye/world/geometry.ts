// The geometry of the worlds that hold hundreds of Eyes (01.10, Alex: at five
// hundred the stair shows thirty-six people and hides the rest behind a
// chevron). Pure numbers and strings, no React, so the same code is run by
// the phone and by the tests (scripts/test-world.mjs).
//
// Three rules the whole file keeps:
//  - Nobody's place comes from a running index. The first guess is a hash of
//    the mint number and a fixed number of neighbour pushes keep Eyes from
//    sitting on each other, so one newcomer moves the few Eyes beside them and
//    nothing else (the old radar drifted; this must not).
//  - An Eye is drawn with the mark's own almond, in batches: a few hundred
//    Eyes are a few dozen Paths, never a few hundred views.
//  - You are never dropped: your label walks outward until it fits.

export const DESIGN_W = 376;
export const IRIS_H = 432;
// The Iris's own middle and radius, in the world's coordinates.
export const IRIS_CX = DESIGN_W / 2;
export const IRIS_CY = 204;
export const IRIS_R = 176;

// The streak each step stands for, innermost first (the service's src/iris.mjs).
export const STEP_DAYS = [30, 21, 14, 10, 7, 5, 3, 2, 1] as const;
export const STEPS = STEP_DAYS.length;

export const stepOf = (streak: number): number => {
  const at = STEP_DAYS.findIndex((day) => streak >= day);
  return at === -1 ? STEPS - 1 : at;
};

export type WorldEye = {
  serial: number;
  name: string;
  streak: number;
  awake: boolean;
  perfect: boolean;
  me: boolean;
  // Position in the order of the world: longest streak first, then the earlier mint.
  rank: number;
};

export type Placed = { x: number; y: number; w: number; eye: WorldEye; step: number; t: number; bnd?: Bound | null };

export const hash = (n: number): number => {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
};

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// Longest streak first; on a tie the earlier mint stands higher.
export function toWorldEyes(
  eyes: ReadonlyArray<{ serial: number; name: string; streak: number; blinkedToday: boolean; perfect: boolean }>,
  meSerial: number | null,
): WorldEye[] {
  const list: WorldEye[] = eyes.map((eye) => ({
    serial: eye.serial, name: eye.name, streak: eye.streak, awake: eye.blinkedToday, perfect: eye.perfect, me: eye.serial === meSerial, rank: 0,
  }));
  list.sort((a, b) => b.streak - a.streak || a.serial - b.serial);
  list.forEach((eye, index) => { eye.rank = index; });
  return list;
}

/* ---- colour: gold at the pupil, mint in the middle, cyan on the rim ---- */
type RGB = [number, number, number];
const RAMP: Array<[number, RGB]> = [[0, [236, 210, 148]], [0.4, [140, 232, 186]], [1, [98, 226, 255]]];
export const RAMP_BUCKETS = 12;
export function rampRGB(t: number): RGB {
  const u = clamp(t, 0, 1);
  for (let i = 1; i < RAMP.length; i += 1) {
    const [t1, c1] = RAMP[i]!;
    if (u <= t1) {
      const [t0, c0] = RAMP[i - 1]!;
      const k = (u - t0) / (t1 - t0);
      return [Math.round(c0[0] + (c1[0] - c0[0]) * k), Math.round(c0[1] + (c1[1] - c0[1]) * k), Math.round(c0[2] + (c1[2] - c0[2]) * k)];
    }
  }
  return RAMP[RAMP.length - 1]![1];
}
export const rgba = (c: RGB, a = 1): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const lighten = (c: RGB, f: number): RGB => [Math.round(c[0] + (255 - c[0]) * f), Math.round(c[1] + (255 - c[1]) * f), Math.round(c[2] + (255 - c[2]) * f)];
export const bucketColor = (bucket: number, a = 1): string => rgba(rampRGB(bucket / RAMP_BUCKETS), a);
const h2 = (n: number): string => n.toString(16).padStart(2, '0');
export const bucketHex = (bucket: number): string => { const c = rampRGB(bucket / RAMP_BUCKETS); return `#${h2(c[0])}${h2(c[1])}${h2(c[2])}`; };

/* ---- the mark's own almond, in a 100 x 56 box ---- */
const f2 = (n: number): string => n.toFixed(2);
export function almondD(cx: number, cy: number, w: number): string {
  const k = w / 100, x = cx - 50 * k, y = cy - 28 * k;
  const p = (a: number, b: number) => `${f2(x + a * k)} ${f2(y + b * k)}`;
  return `M${p(8, 28)}C${p(17, 10)} ${p(31, 5)} ${p(50, 5)}C${p(69, 5)} ${p(83, 10)} ${p(92, 28)}C${p(83, 46)} ${p(69, 51)} ${p(50, 51)}C${p(31, 51)} ${p(17, 46)} ${p(8, 28)}Z`;
}
export function seamD(cx: number, cy: number, w: number): string {
  const k = w / 100, x = cx - 50 * k, y = cy - 28 * k;
  const p = (a: number, b: number) => `${f2(x + a * k)} ${f2(y + b * k)}`;
  return `M${p(10, 28)}C${p(28, 30)} ${p(72, 30)} ${p(90, 28)}`;
}
export function discD(cx: number, cy: number, r: number): string {
  const rr = +r.toFixed(2);
  return `M${f2(cx - rr)} ${f2(cy)}a${rr} ${rr} 0 1 0 ${f2(2 * rr)} 0a${rr} ${rr} 0 1 0 ${f2(-2 * rr)} 0Z`;
}

/* ---- Eyes, batched ----
   One entry per (state, colour bucket, stroke). The component turns each into a
   Path. Big Eyes get a bloom circle of their own (a radial gradient by colour
   bucket); middling ones a stepped pair of flat halos; tiny ones none. */
export type Batch =
  | { kind: 'halo'; d: string; bucket: number; opacity: number }
  | { kind: 'lid'; d: string; bucket: number; awake: boolean; sw: number }
  | { kind: 'fill'; d: string; color: string }
  | { kind: 'seam'; d: string; bucket: number; sw: number };
export type Bloom = { x: number; y: number; r: number; bucket: number };

export function eyeBatches(items: ReadonlyArray<Placed>, o: { halo?: boolean; irisMin?: number } = {}): { batches: Batch[]; blooms: Bloom[] } {
  const halo = o.halo ?? true, irisMin = o.irisMin ?? 8;
  type G = { bucket: number; sw: number; awake: boolean; lid: string; seam: string; iris: string; pupil: string; glint: string; halo1: string; halo2: string };
  const groups = new Map<string, G>();
  const blooms: Bloom[] = [];
  for (const it of items) {
    if (it.eye.me) continue;
    const awake = it.eye.awake;
    const bucket = Math.round(it.t * RAMP_BUCKETS);
    const sw = clamp(it.w * 0.05, 0.65, 1.7);
    const key = `${awake ? 1 : 0}|${bucket}|${sw.toFixed(1)}`;
    let g = groups.get(key);
    if (!g) { g = { bucket, sw, awake, lid: '', seam: '', iris: '', pupil: '', glint: '', halo1: '', halo2: '' }; groups.set(key, g); }
    g.lid += almondD(it.x, it.y, it.w);
    if (awake) {
      if (it.w >= irisMin) {
        g.iris += discD(it.x, it.y, it.w * 0.14);
        g.pupil += discD(it.x, it.y, it.w * 0.064);
        if (it.w >= 17) g.glint += discD(it.x - it.w * 0.05, it.y - it.w * 0.05, it.w * 0.027);
      } else g.iris += discD(it.x, it.y, Math.max(0.85, it.w * 0.17));
      if (halo) {
        if (it.w >= 24) blooms.push({ x: it.x, y: it.y, r: it.w * 0.95, bucket });
        else if (it.w >= 11) { g.halo1 += discD(it.x, it.y, it.w * 0.56); g.halo2 += discD(it.x, it.y, it.w * 0.86); }
      }
    } else g.seam += seamD(it.x, it.y, it.w);
  }
  const out: Batch[] = [];
  for (const g of groups.values()) if (g.halo2) { out.push({ kind: 'halo', d: g.halo2, bucket: g.bucket, opacity: 0.035 }); out.push({ kind: 'halo', d: g.halo1, bucket: g.bucket, opacity: 0.055 }); }
  for (const g of groups.values()) {
    out.push({ kind: 'lid', d: g.lid, bucket: g.bucket, awake: g.awake, sw: g.sw });
    if (g.awake) {
      if (g.iris) out.push({ kind: 'fill', d: g.iris, color: rgba(lighten(rampRGB(g.bucket / RAMP_BUCKETS), 0.1)) });
      if (g.pupil) out.push({ kind: 'fill', d: g.pupil, color: '#020304' });
      if (g.glint) out.push({ kind: 'fill', d: g.glint, color: 'rgba(244,251,253,0.9)' });
    } else if (g.seam) out.push({ kind: 'seam', d: g.seam, bucket: g.bucket, sw: Math.max(0.6, g.sw * 0.9) });
  }
  return { batches: out, blooms };
}

/* ---- stable scatter ---- */
export type Bound = (p: { x: number; y: number }) => void;
export type Body = { x: number; y: number; w: number; bnd?: Bound | null };

// A fixed number of neighbour pushes. The metric is the almond's own: wide and
// flat, so two Eyes side by side need their width and stacked only their height.
export function relax(items: Body[], o: { iters?: number; aspect?: number; gap?: number; damp?: number; pull?: ((p: Body) => [number, number]) | null } = {}): void {
  const iters = o.iters ?? 30, aspect = o.aspect ?? 0.62, gap = o.gap ?? 1.02, damp = o.damp ?? 0.72, pull = o.pull ?? null;
  const n = items.length;
  for (const p of items) p.bnd?.(p);
  if (n < 2) return;
  let widest = 0;
  for (const p of items) widest = Math.max(widest, p.w);
  const cell = widest * gap + 0.5;
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let round = 0; round < iters; round += 1) {
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i += 1) {
      const p = items[i]!;
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / aspect / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(i); else grid.set(key, [i]);
    }
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i += 1) {
      const p = items[i]!;
      const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / aspect / cell);
      for (let a = -1; a <= 1; a += 1) for (let b = -1; b <= 1; b += 1) {
        const bucket = grid.get(`${gx + a},${gy + b}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const q = items[j]!;
          let ex = p.x - q.x, ey = (p.y - q.y) / aspect;
          const m = (p.w + q.w) / 2 * gap;
          let d = Math.hypot(ex, ey);
          if (d >= m) continue;
          if (d < 1e-6) { const ang = (i * 12.9898 + j * 78.233) % 6.283; ex = Math.cos(ang) * 0.01; ey = Math.sin(ang) * 0.01; d = 0.01; }
          const push = (m - d) / 2, ux = ex / d, uy = ey / d;
          dx[i]! += ux * push; dy[i]! += uy * push * aspect;
          dx[j]! -= ux * push; dy[j]! -= uy * push * aspect;
        }
      }
    }
    for (let i = 0; i < n; i += 1) {
      const p = items[i]!;
      if (pull) { const g = pull(p); dx[i]! += g[0]; dy[i]! += g[1]; }
      p.x += dx[i]! * damp; p.y += dy[i]! * damp;
      p.bnd?.(p);
    }
  }
}

export const annulus = (cx: number, cy: number, rmin: number, rmax: number): Bound => (q) => {
  const ex = q.x - cx, ey = q.y - cy;
  const r = Math.hypot(ex, ey) || 1e-6;
  const rr = clamp(r, rmin, rmax);
  q.x = cx + (ex / r) * rr; q.y = cy + (ey / r) * rr;
};

/* ---- the Iris: an eye made of Eyes ----
   Nine annuli, one per step, innermost the gold pupil. Each step's ring is as
   wide as its crowd needs (radii follow the cumulative count, softened toward
   even spacing so the rare Eyes keep room), and inside its ring an Eye starts at
   a hash of its mint number. Size follows density: a rare Eye is big and
   named, a crowd is small. */
export type IrisWorld = {
  cx: number; cy: number; R: number; h: number;
  rOut: number[]; counts: number[];
  items: Placed[];
};

export function irisLayout(eyes: ReadonlyArray<WorldEye>): IrisWorld {
  const cx = IRIS_CX, cy = IRIS_CY, R = IRIS_R, N = eyes.length;
  const counts = new Array<number>(STEPS).fill(0);
  const byStep: WorldEye[][] = Array.from({ length: STEPS }, () => []);
  for (const eye of eyes) { const at = stepOf(eye.streak); byStep[at]!.push(eye); counts[at]! += 1; }
  const cum: number[] = [];
  let run = 0;
  for (const c of counts) { run += c; cum.push(run); }
  const a = N > 1 ? 0.8 : 0;
  const rOut = cum.map((c, i) => R * (a * Math.sqrt(c / Math.max(1, N)) + (1 - a) * (i + 1) / STEPS));
  const items: Placed[] = [];
  byStep.forEach((list, i) => {
    const n = list.length;
    if (!n) return;
    const rin = i === 0 ? 0 : rOut[i - 1]!, rout = rOut[i]!;
    const s = Math.sqrt(Math.PI * (rout * rout - rin * rin) / n);
    let w = clamp(s * 0.86, 7, 46);
    if (i === 0) w = clamp(Math.max(w, 26), 26, 40);
    const m = Math.min(w * 0.55, (rout - rin) * 0.3);
    for (const eye of list) {
      const single = N === 1 || (i === 0 && n === 1);
      const rr = Math.sqrt(rin * rin + (rout * rout - rin * rin) * hash(eye.serial * 2 + 2));
      const th = hash(eye.serial * 2 + 1) * Math.PI * 2;
      items.push({ x: single ? cx : cx + rr * Math.cos(th), y: single ? cy : cy + rr * Math.sin(th), w, eye, step: i, t: 0, bnd: single ? null : annulus(cx, cy, rin + m, Math.max(rin + m, rout - m)) });
    }
  });
  relax(items, { iters: 44 });
  for (const it of items) it.t = Math.pow(clamp(Math.hypot(it.x - cx, it.y - cy) / R, 0, 1), 0.82);
  return { cx, cy, R, h: IRIS_H, rOut, counts, items };
}

/* ---- touch ---- */
export function nearest(items: ReadonlyArray<Placed>, x: number, y: number, reach = 0): Placed | null {
  let best: Placed | null = null, bd = Infinity;
  for (const it of items) {
    const d = Math.hypot(it.x - x, it.y - y);
    const lim = Math.max(9, it.w * 0.7 + 3) + reach;
    if (d < lim && d < bd) { bd = d; best = it; }
  }
  return best;
}
// The closest Eye to a point, however far: a finger on the night always lands on someone.
export function closest(items: ReadonlyArray<Placed>, x: number, y: number): Placed | null {
  let best: Placed | null = null, bd = Infinity;
  for (const it of items) { const d = Math.hypot(it.x - x, it.y - y); if (d < bd) { bd = d; best = it; } }
  return best;
}

/* ---- labels ----
   Placed most important first; whatever would cover another label is dropped,
   except yours, which walks outward until it fits and draws a leader line. */
export type Box = { x: number; y: number; w: number; h: number };
export type Side = 'below' | 'above' | 'right' | 'left';
export type Label = {
  text: string; size: number; box: Box; side: Side | 'far';
  tone: 'me' | 'gold' | 'plain';
  // a ring drawn around the Eye the label belongs to
  ring: { x: number; y: number; r: number } | null;
  leader: { x: number; y: number } | null;
};

export const textWidth = (text: string, size: number): number => text.length * size * 0.585 + 2;

export class Labeler {
  boxes: Box[] = [];
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number) { this.w = w; this.h = h; }
  fits(b: Box): boolean {
    if (b.x < 2 || b.x + b.w > this.w - 2 || b.y < 2 || b.y + b.h > this.h - 2) return false;
    return !this.boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  }
  reserve(b: Box): void { this.boxes.push(b); }
  private boxAt(it: { x: number; y: number; w: number }, text: string, size: number, side: Side): Box {
    const tw = textWidth(text, size) + 5, th = size + 4.5, h = it.w * 0.56;
    if (side === 'below') return { x: it.x - tw / 2, y: it.y + h / 2 + 2, w: tw, h: th };
    if (side === 'above') return { x: it.x - tw / 2, y: it.y - h / 2 - th - 2, w: tw, h: th };
    if (side === 'right') return { x: it.x + it.w / 2 + 3, y: it.y - th / 2, w: tw, h: th };
    return { x: it.x - it.w / 2 - 3 - tw, y: it.y - th / 2, w: tw, h: th };
  }
  place(it: { x: number; y: number; w: number }, text: string, size: number, prefer: Side[], inside?: (b: Box) => boolean): { box: Box; side: Side } | null {
    for (const side of prefer) {
      const box = this.boxAt(it, text, size, side);
      if (this.fits(box) && (!inside || inside(box))) { this.boxes.push(box); return { box, side }; }
    }
    return null;
  }
  placeFar(it: { x: number; y: number }, text: string, size: number): Box | null {
    const tw = textWidth(text, size) + 5, th = size + 4.5;
    for (const dist of [26, 38, 52, 70, 92]) {
      for (const deg of [-90, 90, 0, 180, -45, -135, 45, 135, -65, -115, 65, 115]) {
        const rad = (deg * Math.PI) / 180;
        const cx = it.x + Math.cos(rad) * dist, cy = it.y + Math.sin(rad) * dist;
        const box = { x: cx - tw / 2, y: cy - th / 2, w: tw, h: th };
        if (this.fits(box)) { this.boxes.push(box); return box; }
      }
    }
    return null;
  }
}

export type LabelPlan = { labels: Label[]; youTag: Box | null };

// You first (never dropped), then the summit, your neighbours by rank, then
// everybody while the world is small, or the biggest Eyes while it is middling.
export function planLabels(items: ReadonlyArray<Placed>, eyes: ReadonlyArray<WorldEye>, o: { h: number; everyoneUpTo?: number; summit?: number; meScale?: number } = { h: IRIS_H }): LabelPlan {
  const everyoneUpTo = o.everyoneUpTo ?? 40, summit = o.summit ?? 3, meScale = o.meScale ?? 1.25;
  const L = new Labeler(DESIGN_W, o.h);
  const by = new Map<number, Placed>();
  for (const it of items) by.set(it.eye.serial, it);
  const labels: Label[] = [];
  let youTag: Box | null = null;
  const me = eyes.find((e) => e.me);
  const meIt = me ? by.get(me.serial) : undefined;
  if (me && meIt) {
    const w = meIt.w * meScale;
    youTag = { x: meIt.x + w * 0.4 - 1, y: meIt.y - w * 0.52 - 14, w: 24, h: 14 };
    L.reserve(youTag);
    const side: Side[] = meIt.x > DESIGN_W / 2 ? ['left', 'below', 'above', 'right'] : ['right', 'below', 'above', 'left'];
    const big = { x: meIt.x, y: meIt.y, w };
    const at = L.place(big, me.name, 10.5, side);
    const box = at ? at.box : L.placeFar(big, me.name, 10.5);
    if (box) labels.push({ text: me.name, size: 10.5, box, side: at ? at.side : 'far', tone: 'me', ring: null, leader: at ? null : { x: meIt.x, y: meIt.y } });
  }
  const asked = new Set<number>(me ? [me.serial] : []);
  const ask = (eye: WorldEye, text: string, size: number, prefer: Side[], ring: boolean) => {
    if (asked.has(eye.serial)) return;
    asked.add(eye.serial);
    const it = by.get(eye.serial);
    if (!it) return;
    const at = L.place(it, text, size, prefer);
    if (!at) return;
    labels.push({ text, size, box: at.box, side: at.side, tone: eye.perfect ? 'gold' : 'plain', ring: ring && it.w < 24 ? { x: it.x, y: it.y, r: it.w * 0.62 + 3 } : null, leader: null });
  };
  const sides: Side[] = ['right', 'left', 'below', 'above'], under: Side[] = ['below', 'above', 'right', 'left'];
  eyes.slice(0, summit).forEach((e) => ask(e, `${e.name} · ${e.streak}d`, 9.5, sides, true));
  if (me) [-2, -1, 1, 2].forEach((k) => { const e = eyes[me.rank + k]; if (e) ask(e, e.name, 9, sides, true); });
  if (eyes.length <= everyoneUpTo) eyes.forEach((e) => ask(e, e.name, 9, under, false));
  else if (eyes.length <= 160) [...items].sort((p, q) => q.w - p.w || p.eye.rank - q.eye.rank).slice(0, 8).forEach((it) => ask(it.eye, it.eye.name, 9, under, false));
  return { labels, youTag };
}

// The loupe: the Eyes under the finger, enlarged and named, the names placed
// so none covers another.
export function loupeNames(items: ReadonlyArray<Placed>, px: number, py: number, lcx: number, lcy: number, zoom: number, radius: number): Array<{ text: string; me: boolean; box: Box; side: Side }> {
  const near = items.map((it) => ({ it, d: Math.hypot(it.x - px, it.y - py) })).filter((q) => q.d < radius / zoom - 1).sort((p, q) => p.d - q.d).slice(0, 6);
  const L = new Labeler(DESIGN_W, 1e4);
  const out: Array<{ text: string; me: boolean; box: Box; side: Side }> = [];
  // A name is kept only if the whole plate sits inside the glass.
  const inGlass = (b: Box) => [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].every(([cx, cy]) => Math.hypot(cx! - lcx, cy! - lcy) <= radius - 2);
  for (const q of near) {
    const at = L.place({ x: lcx + (q.it.x - px) * zoom, y: lcy + (q.it.y - py) * zoom, w: q.it.w * zoom }, q.it.eye.name, 9.5, ['below', 'above', 'right', 'left'], inGlass);
    if (at) out.push({ text: q.it.eye.name, me: q.it.eye.me, box: at.box, side: at.side });
  }
  return out;
}

/* ---- around you ---- */
export type AroundYou = { ahead: WorldEye[]; behind: WorldEye[]; me: WorldEye; aheadCount: number; behindCount: number; nextStep: { days: number; label: string; count: number } | null };

export function aroundYou(eyes: ReadonlyArray<WorldEye>, counts: ReadonlyArray<number>): AroundYou | null {
  const me = eyes.find((e) => e.me);
  if (!me) return null;
  const ahead: WorldEye[] = [], behind: WorldEye[] = [];
  for (const k of [3, 2, 1]) { const e = eyes[me.rank - k]; if (e) ahead.push(e); }
  for (const k of [1, 2]) { const e = eyes[me.rank + k]; if (e) behind.push(e); }
  const at = stepOf(me.streak);
  const up = at > 0 ? STEP_DAYS[at - 1]! : null;
  return {
    ahead, behind, me, aheadCount: me.rank, behindCount: eyes.length - 1 - me.rank,
    nextStep: up == null ? null : { days: up - me.streak, label: up >= 30 ? 'gold' : String(up), count: counts[at - 1] ?? 0 },
  };
}
