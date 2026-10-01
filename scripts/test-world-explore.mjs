// The explorer of the Iris: zoom, turn and look around (src/eye/world/viewport.ts). Run:
// npm run test:world
//
// What has to hold: what is projected can be unprojected; a pinch keeps the world under the
// fingers; the Iris cannot be dragged away or lost; letting go comes home exactly; a flight
// puts somebody in the middle; the right Eye is under a finger at every magnification; the
// names grow with the magnification without overlapping; you are never hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_W, IRIS_CX, IRIS_CY, IRIS_H, STEP_DAYS, irisLayout, nearest, stepOf, toWorldEyes } from '../src/eye/world/geometry.ts';
import {
  FRAME_CENTER, IDENTITY, S_MAX, clampView, closestOnScreen, cullItems, focusOn, isHome, layerShift, pickOnScreen, planViewLabels,
  project, settled, turnOf, unproject, viewFor, viewMatrix, youPointer, zoomed,
} from '../src/eye/world/viewport.ts';

const COUNT = [1, 3, 8, 16, 29, 47, 72, 121, 210];
const FLOORS = [30, 21, 14, 10, 7, 5, 3, 2, 1];
function crowd(meAtStep = 7) {
  const eyes = [];
  let serial = 1;
  COUNT.forEach((count, step) => {
    for (let k = 0; k < count; k += 1) {
      const floor = FLOORS[step], ceil = step === 0 ? floor + 29 : FLOORS[step - 1] - 1;
      eyes.push({ serial, name: `eye${serial}.skr`, streak: floor + Math.floor((ceil - floor) * ((k * 7919) % 13) / 13), blinkedToday: serial % 9 < 5, perfect: false });
      serial += 1;
    }
  });
  const mine = eyes.find((e) => stepOf(e.streak) === meAtStep);
  const world = toWorldEyes(eyes, mine.serial);
  return { eyes: world, world: irisLayout(world) };
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const VIEWS = [IDENTITY, { s: 2, a: 0, x: 40, y: -20 }, { s: 3.5, a: 0.7, x: -90, y: 60 }, { s: 1.4, a: -2.1, x: 10, y: 10 }, { s: 6, a: 3, x: 300, y: -200 }];

test('the steps are the service thresholds', () => {
  assert.deepEqual(STEP_DAYS, [30, 21, 14, 10, 7, 5, 3, 2, 1]);
});

test('what is projected can be unprojected, and the SVG matrix agrees', () => {
  for (const v of VIEWS) {
    for (const [x, y] of [[0, 0], [188, 204], [300, 100], [57, 390]]) {
      const p = project(v, x, y), w = unproject(v, p.x, p.y);
      assert.ok(near(w.x, x) && near(w.y, y), `round trip at ${JSON.stringify(v)}`);
      const [a, b, c, d, e, f] = viewMatrix(v);
      assert.ok(near(a * x + c * y + e, p.x) && near(b * x + d * y + f, p.y), 'the matrix lands where project does');
    }
  }
  const m = viewMatrix(IDENTITY);
  assert.ok(near(m[0], 1) && near(m[1], 0) && near(m[2], 0) && near(m[3], 1) && near(m[4], 0) && near(m[5], 0));
});

test('the identity is a fixed point of the clamp, and a drag cannot take the Iris away', () => {
  assert.deepEqual(clampView(IDENTITY), IDENTITY);
  assert.ok(isHome(IDENTITY));
  assert.ok(!isHome({ s: 1.5, a: 0, x: 0, y: 0 }));
  assert.ok(!isHome({ s: 1, a: 0.3, x: 0, y: 0 }));
  for (const s of [1, 1.5, 3, 6]) {
    const far = clampView({ s, a: 0, x: 5000, y: -5000 });
    const centre = project(far, IRIS_CX, IRIS_CY);
    assert.ok(Math.hypot(centre.x - FRAME_CENTER.x, centre.y - FRAME_CENTER.y) <= 176 * s + 1e-6, `at ${s}x the Iris stays under the frame`);
  }
  assert.equal(clampView({ s: 99, a: 0, x: 0, y: 0 }).s, S_MAX);
  assert.equal(clampView({ s: 0.2, a: 0, x: 0, y: 0 }).s, 1);
});

test('a pinch keeps the point under the fingers under the fingers', () => {
  const base = { s: 1.6, a: 0.3, x: 20, y: 10 };
  const anchor = unproject(base, 150, 260);
  for (const [scaleBy, turn, mid] of [[1.5, 0, { x: 150, y: 260 }], [1.3, 0.4, { x: 170, y: 250 }], [2.2, -0.5, { x: 200, y: 230 }]]) {
    const v = viewFor(base, anchor, mid, scaleBy, turn);
    const p = project(v, anchor.x, anchor.y);
    assert.ok(Math.hypot(p.x - mid.x, p.y - mid.y) < 1e-6, `anchor stays at the fingers (${scaleBy}, ${turn})`);
    assert.ok(near(v.s, Math.min(Math.max(base.s * scaleBy, 1), S_MAX), 1e-9));
  }
});

test('the buttons magnify about a point and keep it still', () => {
  const v1 = zoomed(IDENTITY, 2, { x: 100, y: 120 });
  const w = unproject(IDENTITY, 100, 120), p = project(v1, w.x, w.y);
  assert.ok(near(p.x, 100) && near(p.y, 120));
  assert.equal(v1.s, 2);
  assert.equal(zoomed(v1, 0.01).s, 1, 'cannot reduce past the whole Iris');
});

test('a turn needs a real twist, then starts smoothly', () => {
  assert.equal(turnOf(0.05), 0);
  assert.equal(turnOf(-0.1), 0);
  assert.ok(turnOf(0.3) > 0 && turnOf(0.3) < 0.3);
  assert.ok(near(turnOf(-0.6), -(0.6 - 0.14)));
  assert.ok(near(turnOf(Math.PI * 2 + 0.3), turnOf(0.3), 1e-9), 'a full circle is no turn');
});

test('letting go: a tiny turn and a magnification of about one come home exactly', () => {
  assert.deepEqual(settled({ s: 1.03, a: 0.05, x: 3, y: -2 }), IDENTITY);
  const kept = settled({ s: 2.4, a: 0.05, x: 40, y: 10 });
  assert.equal(kept.a, 0);
  assert.equal(kept.s, 2.4);
  assert.equal(settled({ s: 2, a: 0.8, x: 0, y: 0 }).a, 0.8);
});

test('a flight to somebody brings them into the frame, upright', () => {
  const { world } = crowd();
  for (const it of world.items.slice(100, 108)) {
    const v = focusOn({ s: 1.2, a: 1, x: 30, y: 30 }, it, 3);
    assert.equal(v.a, 0);
    assert.ok(v.s >= 3);
    const p = project(v, it.x, it.y);
    assert.ok(p.x > 0 && p.x < DESIGN_W && p.y > 0 && p.y < IRIS_H, `Eye ${it.eye.serial} is in the frame after the flight`);
  }
  const middle = world.items.reduce((best, it) => (Math.hypot(it.x - IRIS_CX, it.y - IRIS_CY) < Math.hypot(best.x - IRIS_CX, best.y - IRIS_CY) ? it : best));
  const v = focusOn(IDENTITY, middle, 3), p = project(v, middle.x, middle.y);
  assert.ok(Math.hypot(p.x - FRAME_CENTER.x, p.y - FRAME_CENTER.y) < 1e-6, 'an Eye near the middle lands exactly on the frame centre');
});

test('touch on the screen: at rest it picks what the world picks, magnified it still picks the right Eye', () => {
  const { world } = crowd();
  const target = world.items[250];
  assert.equal(pickOnScreen(world.items, IDENTITY, target.x, target.y)?.eye.serial, nearest(world.items, target.x, target.y)?.eye.serial);
  for (const v of VIEWS.slice(1)) {
    const p = project(v, target.x, target.y);
    assert.equal(pickOnScreen(world.items, v, p.x, p.y)?.eye.serial, target.eye.serial, `the Eye under the finger at ${JSON.stringify(v)}`);
    const c = closestOnScreen(world.items, v, p.x + 2, p.y - 2);
    assert.ok(c && c.d < 8);
  }
  assert.equal(pickOnScreen(world.items, VIEWS[1], -900, -900), null);
});

test('names follow the magnification: more people are named as a person zooms, none overlap, all are inside the frame', () => {
  const { eyes, world } = crowd();
  const me = world.items.find((it) => it.eye.me);
  const counts = [];
  for (const s of [1, 2, 3, 4.5]) {
    const view = s === 1 ? IDENTITY : focusOn(IDENTITY, me, s);
    const plan = planViewLabels(world.items, eyes, view, { h: IRIS_H });
    counts.push(plan.labels.length);
    const abs = plan.labels.map((l) => { const p = project(view, l.at.x, l.at.y); return { x: p.x + l.dx, y: p.y + l.dy, w: l.w, h: l.h }; });
    for (let i = 0; i < abs.length; i += 1) {
      const a = abs[i];
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= DESIGN_W && a.y + a.h <= IRIS_H, `label ${i} inside at ${s}x`);
      for (let j = i + 1; j < abs.length; j += 1) {
        const b = abs[j];
        assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), `labels ${i} and ${j} overlap at ${s}x`);
      }
    }
    assert.ok(plan.labels.length <= 64, 'capped');
  }
  assert.ok(counts[3] > counts[0], `zooming names more people (${counts.join(' → ')})`);
  assert.ok(counts[0] <= 18, `at rest it stays quiet (${counts[0]})`);
});

test('you keep your name and tag while you are in the frame, and a pointer while you are not', () => {
  const { eyes, world } = crowd();
  const me = world.items.find((it) => it.eye.me);
  const home = planViewLabels(world.items, eyes, IDENTITY, { h: IRIS_H });
  assert.ok(home.labels.some((l) => l.tone === 'me') && home.youTag, 'at rest');
  assert.equal(youPointer(IDENTITY, me), null);
  const away = focusOn(IDENTITY, { x: IRIS_CX * 2 - me.x, y: IRIS_CY * 2 - me.y }, 4);
  const there = planViewLabels(world.items, eyes, away, { h: IRIS_H });
  assert.ok(!there.labels.some((l) => l.tone === 'me'), 'no label for somebody who is not in the frame');
  const pointer = youPointer(away, me);
  assert.ok(pointer, 'but a pointer');
  assert.ok(pointer.x >= 0 && pointer.x <= DESIGN_W && pointer.y >= 0 && pointer.y <= IRIS_H, 'on the frame');
  assert.ok(Math.min(pointer.x, DESIGN_W - pointer.x, pointer.y, IRIS_H - pointer.y) < 17, 'on its edge');
  assert.equal(youPointer(away, null), null);
});

test('a picture baked for one viewport is moved by the GPU to look like it was drawn for another', () => {
  const F = FRAME_CENTER;
  for (const baked of VIEWS) {
    for (const live of VIEWS) {
      const m = layerShift(live, baked);
      for (const [x, y] of [[0, 0], [188, 204], [300, 100], [57, 390]]) {
        const q = project(baked, x, y);
        // the view is scaled and turned about the frame's middle, then shifted
        const c = Math.cos(m.a) * m.s, d = Math.sin(m.a) * m.s;
        const ux = q.x - F.x, uy = q.y - F.y;
        const shown = { x: F.x + c * ux - d * uy + m.dx, y: F.y + d * ux + c * uy + m.dy };
        const want = project(live, x, y);
        assert.ok(Math.hypot(shown.x - want.x, shown.y - want.y) < 1e-6, `baked ${JSON.stringify(baked)} shown as ${JSON.stringify(live)}`);
      }
    }
  }
  const same = layerShift(VIEWS[2], VIEWS[2]);
  assert.ok(near(same.s, 1) && near(same.a, 0) && near(same.dx, 0) && near(same.dy, 0), 'a picture for the live viewport is not moved at all');
});

test('culling keeps everybody at home and a small part when magnified, never losing an Eye that is in view', () => {
  const { world } = crowd();
  assert.equal(cullItems(world.items, IDENTITY).length, world.items.length);
  for (const s of [2, 3.5, 6]) {
    const v = { s, a: 0.4, x: 0, y: 0 };
    const kept = cullItems(world.items, v);
    // the layer is drawn 40% beyond the frame on every side, so up to about 2x almost everybody is inside it
    assert.ok(kept.length <= world.items.length * (s >= 6 ? 0.3 : s >= 3.5 ? 0.6 : 1), `at ${s}x ${kept.length} of ${world.items.length} are drawn`);
    const keptSet = new Set(kept.map((it) => it.eye.serial));
    for (const it of world.items) {
      const p = project(v, it.x, it.y);
      if (p.x > 0 && p.x < DESIGN_W && p.y > 0 && p.y < IRIS_H) assert.ok(keptSet.has(it.eye.serial), `Eye ${it.eye.serial} is in view at ${s}x and must be drawn`);
    }
  }
});
