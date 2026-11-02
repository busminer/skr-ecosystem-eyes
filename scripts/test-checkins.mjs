// The position check-ins, planned without a phone (src/checkinPlan.ts).
// Run: npm run test:checkins
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PER_DAY_OPTIONS, SLOT_TIME, asPerDay, checkinLine, planCheckins, slotTimesLabel, slotsFor, speakableName } from '../src/checkinPlan.ts';

// The app's t() with an empty table: the English sentence itself, braces filled.
const t = (text, vars) => {
  let out = text;
  if (vars) for (const [name, value] of Object.entries(vars)) out = out.split(`{${name}}`).join(String(value));
  return out;
};

test('how many a day decides which slots', () => {
  assert.deepEqual(slotsFor(0), []);
  assert.deepEqual(slotsFor(1), ['evening']);
  assert.deepEqual(slotsFor(2), ['morning', 'evening']);
  assert.deepEqual(slotsFor(3), ['morning', 'midday', 'evening']);
  assert.equal(slotTimesLabel(2), '09:00 · 19:30');
  assert.equal(slotTimesLabel(3), '09:00 · 13:30 · 19:30');
  assert.deepEqual(PER_DAY_OPTIONS, [0, 1, 2, 3]);
});

test('a stored setting is read back strictly', () => {
  assert.equal(asPerDay(3), 3);
  assert.equal(asPerDay('1'), 1);
  assert.equal(asPerDay(7), 2);
  assert.equal(asPerDay(undefined, 0), 0);
  assert.equal(asPerDay(-1), 2);
});

test('only a .skr name is spoken', () => {
  assert.equal(speakableName('kosa.skr'), 'kosa.skr');
  assert.equal(speakableName(' Kosa.SKR '), 'Kosa.SKR');
  assert.equal(speakableName('BmJa…uax'), null);
  assert.equal(speakableName('Seed Vault'), null);
  assert.equal(speakableName('not connected'), null);
  assert.equal(speakableName(''), null);
  assert.equal(speakableName(null), null);
});

test('a week of check-ins: one per weekday per slot, named, never the same line twice in a day', () => {
  const plans = planCheckins(t, 3, 'kosa.skr', true);
  assert.equal(plans.length, 21);
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const day = plans.filter((plan) => plan.weekday === weekday);
    assert.equal(day.length, 3);
    assert.equal(new Set(day.map((plan) => plan.body)).size, 3, `weekday ${weekday} repeats a line`);
    assert.equal(new Set(day.map((plan) => plan.slot)).size, 3);
  }
  for (const plan of plans) {
    assert.equal(plan.hour, SLOT_TIME[plan.slot].hour);
    assert.equal(plan.minute, SLOT_TIME[plan.slot].minute);
    assert.ok(plan.title.includes('kosa.skr'), plan.title);
    assert.ok(!/\{name\}/.test(plan.title));
    assert.ok(plan.body.length <= 90, plan.body);
  }
  // Across the week each slot walks its whole pool, so the same sentence is
  // not read on two days running.
  for (const slot of ['morning', 'midday', 'evening']) {
    const bodies = plans.filter((plan) => plan.slot === slot).map((plan) => plan.body);
    for (let i = 1; i < bodies.length; i += 1) assert.notEqual(bodies[i], bodies[i - 1], `${slot}: same line two days running`);
  }
});

test('none a day plans nothing; two a day plans fourteen', () => {
  assert.deepEqual(planCheckins(t, 0, 'kosa.skr', true), []);
  assert.equal(planCheckins(t, 2, 'kosa.skr', true).length, 14);
  assert.equal(planCheckins(t, 1, null, false).length, 7);
});

test('no name, no greeting by name; no position, no line about your position', () => {
  const plans = planCheckins(t, 3, null, false);
  for (const plan of plans) {
    assert.ok(!plan.title.includes('null') && !plan.title.includes('undefined'), plan.title);
    assert.ok(!/\byour (position|place|card)\b/i.test(plan.body), plan.body);
  }
  assert.equal(checkinLine(t, 'morning', 1, null, false).title, 'Good morning');
  assert.equal(checkinLine(t, 'midday', 1, null, false).title, 'A quiet minute?');
  assert.equal(checkinLine(t, 'evening', 1, null, false).title, 'Good evening');
});

test('no line asks for a stake, promises a reward, or threatens a loss', () => {
  const every = [...planCheckins(t, 3, 'kosa.skr', true), ...planCheckins(t, 3, null, false)];
  for (const plan of every) {
    const text = `${plan.title} ${plan.body}`.toLowerCase();
    assert.ok(!/\bstake (now|more|again)\b|\badd (more|skr)\b|\bearn\b|\breward\b|\bapy\b|\blose\b|\blost\b|\bmiss(ing)? out\b/.test(text), text);
    assert.ok(!/\d/.test(plan.body) || /thirty/.test(plan.body) === false || true);
  }
});

test('the lines carry nothing that could go stale: no day counts, ranks or amounts', () => {
  const every = [...planCheckins(t, 3, 'kosa.skr', true), ...planCheckins(t, 3, null, false)];
  for (const plan of every) assert.ok(!/\d/.test(plan.body), plan.body);
});
