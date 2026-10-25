import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, localHour, summarize, streakDays, shiftDay, blocksFromSamples } from '../lib/usage.mjs';

const TZ = 'Asia/Hong_Kong';
const at = (iso) => Date.parse(iso);

test('dayKey uses the given time zone', () => {
  // 2026-10-25T17:30:00Z == 2026-10-26 01:30 in Hong Kong
  assert.equal(dayKey(at('2026-10-25T17:30:00Z'), TZ), '2026-10-26');
  assert.equal(dayKey(at('2026-10-25T17:30:00Z'), 'UTC'), '2026-10-25');
  assert.equal(localHour(at('2026-10-25T17:30:00Z'), TZ), 1);
});

test('blocks merge nearby events and add a one minute tail', () => {
  const samples = [
    { time: at('2026-10-25T02:00:00Z') },
    { time: at('2026-10-25T02:03:00Z') }, // 3 min later -> same block
    { time: at('2026-10-25T02:20:00Z') }, // 17 min later -> new block
  ];
  const blocks = blocksFromSamples(samples);
  assert.equal(blocks.length, 2);
  assert.equal((blocks[0].end - blocks[0].start) / 60000, 4); // 3 + 1 tail
  assert.equal((blocks[1].end - blocks[1].start) / 60000, 1); // single event -> 1 tail
});

test('summarize splits blocks across local midnight and sums tokens', () => {
  const samples = [
    { time: at('2026-10-25T15:58:00Z'), tokens: 100 }, // 23:58 HKT
    { time: at('2026-10-25T16:01:00Z'), tokens: 20 }, // 00:01 HKT next day
    { time: at('2026-10-26T02:00:00Z'), tokens: 5 }, // 10:00 HKT
  ];
  const s = summarize(samples, { timeZone: TZ, now: at('2026-10-26T03:00:00Z') });
  // block1: 23:58 -> 00:02 = 4 min split as 2 + 2; block2: 1 min on 10-26
  assert.equal(s.days['2026-10-25'].minutes, 2);
  assert.equal(s.days['2026-10-26'].minutes, 3);
  assert.equal(s.days['2026-10-25'].tokens, 100);
  assert.equal(s.days['2026-10-26'].tokens, 25);
  assert.equal(s.today.day, '2026-10-26');
  assert.equal(s.today.minutes, 3);
});

test('streakDays counts consecutive days ending today or yesterday', () => {
  const days = {
    '2026-10-20': { minutes: 5 },
    '2026-10-21': { minutes: 3 },
    '2026-10-22': { minutes: 0 },
    '2026-10-23': { minutes: 9 },
    '2026-10-24': { minutes: 4 },
  };
  assert.equal(streakDays(days, '2026-10-22'), 2); // today is 0 -> 21,20
  assert.equal(streakDays(days, '2026-10-25'), 2); // 24,23 (today 25 missing)
  assert.equal(streakDays(days, '2026-10-23'), 1); // 23, then 22 is 0
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
});

test('summarize reports week totals and peak hours', () => {
  const samples = [];
  for (let d = 0; d < 5; d++) {
    // 3 one-minute events each day at 21:00 HKT (13:00Z) and 09:00 HKT (01:00Z)
    samples.push({ time: at('2026-10-20T13:00:00Z') + d * 86400000 });
    samples.push({ time: at('2026-10-20T01:00:00Z') + d * 86400000 });
  }
  const s = summarize(samples, { timeZone: TZ, now: at('2026-10-24T15:00:00Z') });
  assert.equal(s.week.minutes, 10);
  assert.deepEqual(s.peakHours.map((p) => p.hour), [9, 21]);
});
