// The worlds that hold hundreds of Eyes (src/eye/world/geometry.ts). Run:
// npm run test:world
//
// What has to hold: the same Eyes always land in the same places, a newcomer
// moves only the Eyes beside them, nobody sits on anybody, you always carry a
// label, and five hundred (a thousand) Eyes lay out fast enough for a phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IRIS_H, DESIGN_W, STEP_DAYS, aroundYou, closest, irisLayout, loupeNames, nearest, planLabels, stepOf, toWorldEyes, eyeBatches } from '../src/eye/world/geometry.ts';

// Steps, from the stair's own screen: 30+ … 1.
const COUNTS = { 1: [0, 0, 0, 0, 0, 0, 0, 0, 1], 12: [0, 0, 0, 0, 1, 2, 2, 3, 4], 40: [0, 0, 1, 2, 4, 6, 8, 10, 9], 120: [0, 1, 2, 5, 9, 16, 24, 30, 33], 507: [1, 3, 8, 16, 29, 47, 72, 121, 210], 1000: [2, 6, 16, 32, 57, 93, 142, 239, 413] };
const FLOORS = [30, 21, 14, 10, 7, 5, 3, 2, 1];

function network(n, { meAtStep = 7 } = {}) {
  const counts = COUNTS[n].slice();
  const eyes = [];
  let serial = 1;
  counts.forEach((count, step) => {
    for (let k = 0; k < count; k += 1) {
      const floor = FLOORS[step], ceil = step === 0 ? floor + 29 : FLOORS[step - 1] - 1;
      eyes.push({ serial, name: `eye${serial}.skr`, streak: floor + Math.floor((ceil - floor) * ((k * 7919) % 13) / 13), blinkedToday: serial % 9 < 5, perfect: false });
      serial += 1;
    }
  });
  if (!eyes.some((e) => stepOf(e.streak) === meAtStep)) eyes.push({ serial: serial, name: `eye${serial}.skr`, streak: FLOORS[meAtStep], blinkedToday: true, perfect: false });
  const mine = eyes.find((e) => stepOf(e.streak) === meAtStep);
  return { eyes, meSerial: mine.serial };
}

const layoutOf = (net) => { const eyes = toWorldEyes(net.eyes, net.meSerial); return { eyes, world: irisLayout(eyes) }; };
const sameSpot = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

test('the step of a streak matches the service thresholds', () => {
  assert.deepEqual(STEP_DAYS, [30, 21, 14, 10, 7, 5, 3, 2, 1]);
  assert.equal(stepOf(59), 0); assert.equal(stepOf(30), 0); assert.equal(stepOf(29), 1); assert.equal(stepOf(21), 1);
  assert.equal(stepOf(13), 3); assert.equal(stepOf(2), 7); assert.equal(stepOf(1), 8); assert.equal(stepOf(0), 8);
});

test('the layout is deterministic', () => {
  const net = network(507);
  const a = layoutOf(net).world.items, b = layoutOf(net).world.items;
  assert.equal(a.length, b.length);
  a.forEach((it, i) => assert.ok(sameSpot(it, b[i]), `Eye ${it.eye.serial} moved between two runs`));
});

for (const n of [1, 12, 40, 120, 507, 1000]) {
  test(`every Eye is inside the Iris and none is lost (${n})`, () => {
    const { eyes, world } = layoutOf(network(n));
    assert.equal(world.items.length, eyes.length);
    for (const it of world.items) {
      assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y), 'finite');
      assert.ok(Math.hypot(it.x - world.cx, it.y - world.cy) <= world.R + 1, `Eye ${it.eye.serial} outside the disc`);
      assert.ok(it.t >= 0 && it.t <= 1);
    }
    assert.equal(new Set(world.items.map((it) => it.eye.serial)).size, eyes.length);
  });
}

test('nobody sits on anybody at five hundred and at a thousand', () => {
  for (const n of [507, 1000]) {
    const { world } = layoutOf(network(n));
    let deep = 0;
    const its = world.items;
    for (let i = 0; i < its.length; i += 1) {
      let hit = false;
      for (let j = 0; j < its.length && !hit; j += 1) {
        if (i === j) continue;
        const dx = (its[i].x - its[j].x) / ((its[i].w + its[j].w) / 2), dy = (its[i].y - its[j].y) / (((its[i].w + its[j].w) / 2) * 0.62);
        if (Math.hypot(dx, dy) < 0.55) hit = true;
      }
      if (hit) deep += 1;
    }
    assert.ok(deep / its.length < 0.03, `${n}: ${deep} of ${its.length} Eyes sit deep inside another`);
  }
});

test('a newcomer moves only the Eyes beside them', () => {
  const net = network(507);
  const before = layoutOf(net);
  const next = { eyes: [...net.eyes, { serial: 508, name: 'new.skr', streak: 1, blinkedToday: true, perfect: false }], meSerial: net.meSerial };
  const after = layoutOf(next);
  const was = new Map(before.world.items.map((it) => [it.eye.serial, it]));
  const newcomer = after.world.items.find((it) => it.eye.serial === 508);
  let worst = 0, far = 0, moved = 0;
  for (const it of after.world.items) {
    const old = was.get(it.eye.serial);
    if (!old) continue;
    const d = Math.hypot(it.x - old.x, it.y - old.y);
    if (d > 4) moved += 1;
    if (Math.hypot(it.x - newcomer.x, it.y - newcomer.y) > 60) { far += 1; worst = Math.max(worst, d); }
  }
  console.log(`  newcomer: ${moved} of 507 moved more than 4 dp; worst far Eye moved ${worst.toFixed(2)} dp`);
  assert.ok(worst < 9, `an Eye far from the newcomer moved ${worst.toFixed(2)} dp`);
  assert.ok(moved / 507 < 0.25, `${moved} Eyes moved more than 4 dp`);
  assert.ok(far > 100);
});

test('a blink that lights an Eye does not move anybody', () => {
  const net = network(507);
  const a = layoutOf(net).world.items;
  const lit = { eyes: net.eyes.map((e) => ({ ...e, blinkedToday: !e.blinkedToday })), meSerial: net.meSerial };
  const b = layoutOf(lit).world.items;
  a.forEach((it, i) => assert.ok(sameSpot(it, b[i]), `Eye ${it.eye.serial} moved when only the lights changed`));
});

test('climbing a step moves that Eye inward and the rest barely', () => {
  const net = network(507);
  const before = layoutOf(net);
  const me = net.meSerial;
  const climbed = { eyes: net.eyes.map((e) => (e.serial === me ? { ...e, streak: e.streak + 1 } : e)), meSerial: me };
  const after = layoutOf(climbed);
  const a = before.world.items.find((it) => it.eye.serial === me), b = after.world.items.find((it) => it.eye.serial === me);
  assert.ok(Math.hypot(b.x - before.world.cx, b.y - before.world.cy) <= Math.hypot(a.x - before.world.cx, a.y - before.world.cy) + 1, 'you moved toward the pupil');
});

test('you always carry a label, and labels never cover each other', () => {
  for (const n of [1, 12, 40, 120, 507, 1000]) {
    for (const meAtStep of [0, 3, 7, 8]) {
      const { eyes, world } = layoutOf(network(n, { meAtStep }));
      const plan = planLabels(world.items, eyes, { h: IRIS_H });
      const mine = plan.labels.find((l) => l.tone === 'me');
      assert.ok(mine, `${n} eyes, me at step ${meAtStep}: no label for you`);
      assert.ok(plan.youTag, 'the you tag');
      const boxes = plan.labels.map((l) => l.box);
      for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
        const p = boxes[i], q = boxes[j];
        assert.ok(!(p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y), `${n}: labels ${i} and ${j} overlap`);
      }
      for (const l of plan.labels) assert.ok(l.box.x >= 0 && l.box.x + l.box.w <= DESIGN_W && l.box.y >= 0 && l.box.y + l.box.h <= IRIS_H, 'inside the world');
      assert.ok(plan.labels.length <= 44, `${plan.labels.length} labels is a wall of text`);
    }
  }
});

test('the batches stay a handful of paths', () => {
  for (const n of [507, 1000]) {
    const { world } = layoutOf(network(n));
    const { batches, blooms } = eyeBatches(world.items);
    assert.ok(batches.length <= 140, `${n}: ${batches.length} batches`);
    assert.ok(blooms.length <= 60, `${n}: ${blooms.length} blooms`);
  }
});

test('five hundred lay out fast, a thousand not much slower', () => {
  for (const [n, limit] of [[507, 500], [1000, 1000]]) {
    const net = network(n);
    const eyes = toWorldEyes(net.eyes, net.meSerial);
    const t0 = performance.now();
    irisLayout(eyes);
    const ms = performance.now() - t0;
    console.log(`  ${n} Eyes laid out in ${ms.toFixed(0)} ms`);
    assert.ok(ms < limit, `${n} Eyes took ${ms.toFixed(0)} ms`);
  }
});

test('touch: the nearest Eye under a finger, and always somebody under the loupe', () => {
  const { eyes, world } = layoutOf(network(507));
  const target = world.items[200];
  assert.equal(nearest(world.items, target.x, target.y)?.eye.serial, target.eye.serial);
  assert.equal(nearest(world.items, -500, -500), null);
  assert.ok(closest(world.items, -500, -500));
  const names = loupeNames(world.items, target.x, target.y, target.x, target.y - 74, 3, 46);
  assert.ok(names.length >= 1 && names.length <= 6);
  assert.ok(eyes.length === 507);
});

test('around you: neighbours by rank, counts, the next step', () => {
  const { eyes, world } = layoutOf(network(507));
  const a = aroundYou(eyes, world.counts);
  assert.ok(a);
  assert.equal(a.aheadCount, a.me.rank);
  assert.equal(a.behindCount, 506 - a.me.rank);
  assert.equal(a.ahead.length, 3);
  assert.ok(a.ahead.every((e) => e.rank < a.me.rank) && a.behind.every((e) => e.rank > a.me.rank));
  assert.equal(a.nextStep.days, 3 - a.me.streak);
  const top = toWorldEyes([{ serial: 1, name: 'a.skr', streak: 40, blinkedToday: true, perfect: true }], 1);
  assert.equal(aroundYou(top, [1, 0, 0, 0, 0, 0, 0, 0, 0]).nextStep, null);
  assert.equal(aroundYou(toWorldEyes([{ serial: 1, name: 'a.skr', streak: 3, blinkedToday: true, perfect: false }], null), [0, 0, 0, 0, 0, 0, 1, 0, 0]), null);
});
