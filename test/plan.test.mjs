import test from 'node:test';
import assert from 'node:assert/strict';
import { clockOf, dayPlan, hashSeed, kindQuota, localDayStart, makeRng } from '../lib/plan.mjs';

const TZ = 'Asia/Hong_Kong';

test('rng is reproducible for a fixed seed', () => {
  const a = makeRng(hashSeed('2026-10-25'));
  const b = makeRng(hashSeed('2026-10-25'));
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((n) => n >= 0 && n < 1));
});

test('localDayStart matches the local midnight in the given time zone', () => {
  // 2026-10-25 00:00 HKT == 2026-10-24T16:00Z
  assert.equal(localDayStart('2026-10-25', TZ), Date.parse('2026-10-24T16:00:00Z'));
});

test('day plan is deterministic, inside the window and spaced out', () => {
  const input = { day: '2026-10-25', count: 10, start: '08:00', end: '23:00', minGapMinutes: 30, timeZone: TZ };
  const a = dayPlan(input);
  const b = dayPlan(input);
  assert.deepEqual(a.slots.map((s) => [s.at, s.kind]), b.slots.map((s) => [s.at, s.kind]));
  assert.equal(a.slots.length, 10);
  const start = localDayStart('2026-10-25', TZ) + 8 * 3600_000;
  const end = localDayStart('2026-10-25', TZ) + 23 * 3600_000;
  for (const s of a.slots) {
    assert.ok(s.at >= start && s.at < end, `${clockOf(s.at, TZ)} outside window`);
  }
  for (let i = 1; i < a.slots.length; i += 1) {
    const gapMin = (a.slots[i].at - a.slots[i - 1].at) / 60000;
    assert.ok(gapMin >= 30, `gap ${gapMin}min too small`);
  }
});

test('kind quota keeps text and thought while capping stats', () => {
  const kinds = kindQuota(10);
  assert.equal(kinds.length, 10);
  const count = (k) => kinds.filter((x) => x === k).length;
  assert.ok(count('text') >= 2);
  assert.ok(count('thought') >= 2);
  assert.ok(count('stats') <= 2);
  assert.equal(count('life') + count('text') + count('thought') + count('stats'), 10);
  assert.ok(kindQuota(4).length === 4);
});

test('a different day reshuffles the plan', () => {
  const a = dayPlan({ day: '2026-10-25', timeZone: TZ });
  const b = dayPlan({ day: '2026-10-26', timeZone: TZ });
  assert.notDeepEqual(a.slots.map((s) => s.at), b.slots.map((s) => s.at));
});

test('clockOf renders zero-padded local time', () => {
  assert.match(clockOf(Date.parse('2026-10-25T01:05:00Z'), TZ), /^09:05$/);
});
