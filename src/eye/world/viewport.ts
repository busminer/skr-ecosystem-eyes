// How the explorer looks at the Iris (01.10, Alex: "I like the little world; let me zoom it,
// turn it and look around with my fingers, but keep it in the same place").
//
// The world keeps its own coordinates (geometry.ts). A viewport is the way a person looks at
// it: how much it is magnified, how far it is turned, and where its centre has been dragged to.
// Everything here is plain numbers, so the phone and the tests run the same code.
//
//   screen = IRIS + s * R(a) * (world - IRIS) + (x, y)
//
// The frame never moves and the Iris never drifts: nothing changes the viewport but a finger,
// one of the buttons, or a flight to somebody a person asked to see.

import { DESIGN_W, IRIS_CX, IRIS_CY, IRIS_H, IRIS_R, Labeler, type Box, type Placed, type Side, type WorldEye } from './geometry.ts';

export type Viewport = { s: number; a: number; x: number; y: number };
export type Pt = { x: number; y: number };

export const IDENTITY: Viewport = { s: 1, a: 0, x: 0, y: 0 };
export const S_MIN = 1;
export const S_MAX = 6;
// The frame's own middle: the place a flight brings somebody to.
export const FRAME_CENTER: Pt = { x: DESIGN_W / 2, y: IRIS_H / 2 };
// Below this much magnification a one-finger drag belongs to the page (it scrolls), above it to
// the Iris (it looks around).
export const ZOOMED = 1.05;
// A twist smaller than this is a pinch that wobbled, not a turn.
export const TURN_DEADZONE = 0.14;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const TAU = Math.PI * 2;
export const wrapAngle = (a: number): number => a - TAU * Math.round(a / TAU);

export const isHome = (v: Viewport): boolean => v.s < ZOOMED && Math.abs(v.a) < 0.04;

export function project(v: Viewport, x: number, y: number): Pt {
  'worklet';
  const c = Math.cos(v.a) * v.s, d = Math.sin(v.a) * v.s;
  const dx = x - IRIS_CX, dy = y - IRIS_CY;
  return { x: IRIS_CX + c * dx - d * dy + v.x, y: IRIS_CY + d * dx + c * dy + v.y };
}

export function unproject(v: Viewport, px: number, py: number): Pt {
  const c = Math.cos(v.a) / v.s, d = Math.sin(v.a) / v.s;
  const dx = px - IRIS_CX - v.x, dy = py - IRIS_CY - v.y;
  return { x: IRIS_CX + c * dx + d * dy, y: IRIS_CY - d * dx + c * dy };
}

// The six numbers react-native-svg wants for a group: [a, b, c, d, e, f] of an SVG matrix. (project,
// viewMatrix and youPointer are worklets: the UI thread runs them for the picture and the names that
// follow a gesture, the JS thread runs the same code for touch and for the tests.)
export function viewMatrix(v: Viewport): [number, number, number, number, number, number] {
  'worklet';
  const c = Math.cos(v.a) * v.s, d = Math.sin(v.a) * v.s;
  return [c, d, -d, c, IRIS_CX - c * IRIS_CX + d * IRIS_CY + v.x, IRIS_CY - d * IRIS_CX - c * IRIS_CY + v.y];
}

// Keep the frame's middle on the Iris, with room to look at its rim: how far the Iris's centre
// may be dragged grows with the magnification and is almost nothing at one.
export function clampView(v: Viewport): Viewport {
  const s = clamp(v.s, S_MIN, S_MAX);
  const slack = Math.max(0, IRIS_R * s - DESIGN_W * 0.43);
  const fx = FRAME_CENTER.x - IRIS_CX, fy = FRAME_CENTER.y - IRIS_CY;
  let ox = v.x - fx, oy = v.y - fy;
  const len = Math.hypot(ox, oy);
  if (len > slack) { const k = slack / len; ox *= k; oy *= k; }
  return { s, a: wrapAngle(v.a), x: fx + ox, y: fy + oy };
}

// The viewport a gesture asks for: the point of the world that was under the fingers when they
// went down (`anchor`) stays under their middle (`mid`), magnified by `scaleBy` and turned by
// `turnBy` from the viewport the gesture started in.
export function viewFor(base: Viewport, anchor: Pt, mid: Pt, scaleBy: number, turnBy: number): Viewport {
  const s = clamp(base.s * scaleBy, S_MIN, S_MAX);
  const a = base.a + turnBy;
  const c = Math.cos(a) * s, d = Math.sin(a) * s;
  const dx = anchor.x - IRIS_CX, dy = anchor.y - IRIS_CY;
  return clampView({ s, a, x: mid.x - IRIS_CX - (c * dx - d * dy), y: mid.y - IRIS_CY - (d * dx + c * dy) });
}

// A twist counts only past the dead zone, and then from the edge of it, so a turn starts smoothly.
export const turnOf = (raw: number): number => {
  const w = wrapAngle(raw);
  return (Math.sign(w) * Math.max(0, Math.abs(w) - TURN_DEADZONE)) || 0;
};

// The buttons: magnify (or reduce) about a point of the screen.
export function zoomed(v: Viewport, factor: number, about: Pt = FRAME_CENTER): Viewport {
  return viewFor(v, unproject(v, about.x, about.y), about, factor, 0);
}

// A flight to somebody: upright, magnified, and in the middle of the frame.
export function focusOn(v: Viewport, at: Pt, scale: number): Viewport {
  const s = clamp(Math.max(v.s, scale), S_MIN, S_MAX);
  return viewFor({ s, a: 0, x: 0, y: 0 }, at, FRAME_CENTER, 1, 0);
}

// After a gesture: a tiny leftover turn and a magnification that is practically one are
// undone, so the Iris comes home exactly.
export function settled(v: Viewport): Viewport {
  const a = Math.abs(v.a) < 0.1 ? 0 : v.a;
  if (v.s < 1.06 && Math.abs(a) < 0.1) return IDENTITY;
  return clampView({ ...v, a });
}

/* ---- the picture and the viewport ----
   Drawing the Iris takes the CPU a few hundred milliseconds (react-native-svg rasterises its tree
   into a bitmap each time it changes), far too slow to redo on every frame of a gesture. So a
   picture is drawn once for a viewport (`baked`), and while a finger moves the live viewport the
   picture is only moved by the GPU: scaled, turned and shifted so that it lands where the live
   viewport wants it. When the finger rests, a fresh picture is drawn for where the viewport is
   now, off screen, and crossfaded in (MassWorld keeps two such layers).

   layerShift gives that move for a layer: the way to show a picture baked for `b` as if it had
   been drawn for `v`, as a scale, a turn and a shift of the view about the middle of the frame. */
export const OVERSCAN_X = DESIGN_W * 0.4;
export const OVERSCAN_Y = IRIS_H * 0.4;

export function layerShift(v: Viewport, b: Viewport): { s: number; a: number; dx: number; dy: number } {
  'worklet';
  const s = v.s / b.s, a = v.a - b.a;
  const c = Math.cos(a) * s, d = Math.sin(a) * s;
  const tx = v.x - (c * b.x - d * b.y), ty = v.y - (d * b.x + c * b.y);
  const fx = FRAME_CENTER.x - IRIS_CX, fy = FRAME_CENTER.y - IRIS_CY;
  return { s, a, dx: -fx + (c * fx - d * fy) + tx, dy: -fy + (d * fx + c * fy) + ty };
}

// The Eyes a picture baked for `v` can show: those whose centre is inside the frame, the margin the
// layer is drawn beyond it (so a drag can slide in what is just outside), and an Eye's own size.
// At home that is everybody; magnified it is a small part, and drawing it is correspondingly quick.
export function cullItems(items: ReadonlyArray<Placed>, v: Viewport): Placed[] {
  let widest = 0;
  for (const it of items) if (it.w > widest) widest = it.w;
  const m = widest * v.s * 0.75 + 8;
  const x0 = -OVERSCAN_X - m, x1 = DESIGN_W + OVERSCAN_X + m, y0 = -OVERSCAN_Y - m, y1 = IRIS_H + OVERSCAN_Y + m;
  const out: Placed[] = [];
  for (const it of items) {
    const p = project(v, it.x, it.y);
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) out.push(it);
  }
  return out;
}

/* ---- touch, on the screen ---- */
export function pickOnScreen(items: ReadonlyArray<Placed>, v: Viewport, sx: number, sy: number, reach = 0): Placed | null {
  let best: Placed | null = null, bd = Infinity;
  for (const it of items) {
    const p = project(v, it.x, it.y);
    const d = Math.hypot(p.x - sx, p.y - sy);
    const lim = Math.max(9, it.w * v.s * 0.7 + 3) + reach;
    if (d < lim && d < bd) { bd = d; best = it; }
  }
  return best;
}

export function closestOnScreen(items: ReadonlyArray<Placed>, v: Viewport, sx: number, sy: number): { it: Placed; d: number } | null {
  let best: Placed | null = null, bd = Infinity;
  for (const it of items) {
    const p = project(v, it.x, it.y);
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d < bd) { bd = d; best = it; }
  }
  return best ? { it: best, d: bd } : null;
}

/* ---- names, for the viewport ----
   The same order as at rest (you, the summit, your neighbours by rank, then the biggest and the
   most central), but measured on the screen: the more a person zooms the more room each Eye has,
   so the more names fit. Each label remembers which Eye it belongs to and how far from that Eye's
   screen position it was drawn, so it can follow the Eye while a gesture is still moving. */
export type ViewLabel = {
  serial: number;
  text: string;
  size: number;
  tone: 'me' | 'gold' | 'plain';
  at: Pt;            // the Eye's place in the world
  dx: number;        // from the Eye's screen position, when planned, to the plate's left edge
  dy: number;        // ... and to its top edge
  w: number;
  h: number;
  side: Side | 'far';
};
export type ViewPlan = {
  labels: ViewLabel[];
  youTag: { at: Pt; dx: number; dy: number; w: number; h: number } | null;
};

export const YOU_TAG_W = 24;
export const YOU_TAG_H = 14;

export function planViewLabels(
  items: ReadonlyArray<Placed>,
  eyes: ReadonlyArray<WorldEye>,
  v: Viewport,
  o: { h?: number; everyoneUpTo?: number; summit?: number; cap?: number; reserved?: Box[]; meScale?: number } = {},
): ViewPlan {
  const W = DESIGN_W, H = o.h ?? IRIS_H;
  const everyoneUpTo = o.everyoneUpTo ?? 40, summit = o.summit ?? 3, cap = o.cap ?? 64, meScale = o.meScale ?? 1.25;
  const L = new Labeler(W, H);
  for (const b of o.reserved ?? []) L.reserve(b);
  type Q = { it: Placed; x: number; y: number; w: number };
  const at = new Map<number, Q>();
  for (const it of items) { const p = project(v, it.x, it.y); at.set(it.eye.serial, { it, x: p.x, y: p.y, w: it.w * v.s }); }
  const inside = (q: Q, margin: number) => q.x > margin && q.x < W - margin && q.y > margin && q.y < H - margin;
  const labels: ViewLabel[] = [];
  let youTag: ViewPlan['youTag'] = null;
  const asked = new Set<number>();

  const me = eyes.find((e) => e.me);
  const meQ = me ? at.get(me.serial) : undefined;
  if (me && meQ && inside(meQ, 2)) {
    asked.add(me.serial);
    const w = meQ.w * meScale;
    const tag: Box = { x: meQ.x + w * 0.4 - 1, y: meQ.y - w * 0.52 - YOU_TAG_H, w: YOU_TAG_W, h: YOU_TAG_H };
    if (tag.x >= 2 && tag.y >= 2 && tag.x + tag.w <= W - 2) {
      L.reserve(tag);
      youTag = { at: { x: meQ.it.x, y: meQ.it.y }, dx: tag.x - meQ.x, dy: tag.y - meQ.y, w: tag.w, h: tag.h };
    }
    const side: Side[] = meQ.x > W / 2 ? ['left', 'below', 'above', 'right'] : ['right', 'below', 'above', 'left'];
    const big = { x: meQ.x, y: meQ.y, w };
    const placed = L.place(big, me.name, 10.5, side);
    const box = placed ? placed.box : L.placeFar(big, me.name, 10.5);
    if (box) labels.push({ serial: me.serial, text: me.name, size: 10.5, tone: 'me', at: { x: meQ.it.x, y: meQ.it.y }, dx: box.x - meQ.x, dy: box.y - meQ.y, w: box.w, h: box.h, side: placed ? placed.side : 'far' });
  }

  const ask = (eye: WorldEye, text: string, size: number, prefer: Side[]) => {
    if (asked.has(eye.serial)) return;
    asked.add(eye.serial);
    const q = at.get(eye.serial);
    if (!q || !inside(q, 3) || labels.length >= cap) return;
    const placed = L.place({ x: q.x, y: q.y, w: q.w }, text, size, prefer);
    if (!placed) return;
    labels.push({ serial: eye.serial, text, size, tone: eye.perfect ? 'gold' : 'plain', at: { x: q.it.x, y: q.it.y }, dx: placed.box.x - q.x, dy: placed.box.y - q.y, w: placed.box.w, h: placed.box.h, side: placed.side });
  };
  const sides: Side[] = ['right', 'left', 'below', 'above'], under: Side[] = ['below', 'above', 'right', 'left'];
  eyes.slice(0, summit).forEach((e) => ask(e, `${e.name} · ${e.streak}d`, 9.5, sides));
  if (me) [-2, -1, 1, 2].forEach((k) => { const e = eyes[me.rank + k]; if (e) ask(e, e.name, 9, sides); });
  if (eyes.length <= everyoneUpTo) eyes.forEach((e) => ask(e, e.name, 9, under));
  else {
    // The more it is magnified, the more people are named: eight at rest, then twenty, forty, all.
    const quota = v.s < 1.3 ? 8 : v.s < 2 ? 20 : v.s < 3 ? 40 : cap;
    const pool = [...at.values()]
      .filter((q) => inside(q, 6) && q.w >= 9)
      .sort((p, q) => q.w - p.w || Math.hypot(p.x - FRAME_CENTER.x, p.y - FRAME_CENTER.y) - Math.hypot(q.x - FRAME_CENTER.x, q.y - FRAME_CENTER.y) || p.it.eye.rank - q.it.eye.rank);
    let named = 0;
    for (const q of pool) {
      if (named >= quota) break;
      const before = labels.length;
      ask(q.it.eye, q.it.eye.name, 9, under);
      if (labels.length > before) named += 1;
    }
  }
  return { labels, youTag };
}

// Where to draw the sign that points at you when you are out of the frame: on its edge, along the
// line from the frame's middle to you. Null while you are in view (or when there is no you).
export function youPointer(v: Viewport, me: Pt | null, margin = 16): { x: number; y: number; angle: number } | null {
  'worklet';
  if (!me) return null;
  const p = project(v, me.x, me.y);
  const W = DESIGN_W, H = IRIS_H;
  if (p.x > 6 && p.x < W - 6 && p.y > 6 && p.y < H - 6) return null;
  const dx = p.x - FRAME_CENTER.x, dy = p.y - FRAME_CENTER.y;
  const kx = dx === 0 ? Infinity : (dx > 0 ? W - margin - FRAME_CENTER.x : margin - FRAME_CENTER.x) / dx;
  const ky = dy === 0 ? Infinity : (dy > 0 ? H - margin - FRAME_CENTER.y : margin - FRAME_CENTER.y) / dy;
  const k = Math.min(kx, ky);
  return { x: FRAME_CENTER.x + dx * k, y: FRAME_CENTER.y + dy * k, angle: Math.atan2(dy, dx) };
}
