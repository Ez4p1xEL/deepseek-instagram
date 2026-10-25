import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePublish } from '../lib/safety.mjs';

const TZ = 'Asia/Hong_Kong';
// 2026-10-26 12:00 HKT == 04:00Z
const NOON = Date.parse('2026-10-26T04:00:00Z');
const NIGHT = Date.parse('2026-10-26T16:30:00Z'); // 2026-10-27 00:30 HKT

const cfg = {
  paused: false,
  dailyCap: 11,
  storyCap: 10,
  noteCap: 1,
  onePerKind: true,
  minIntervalMinutes: 30,
  quietStart: '23:00',
  quietEnd: '08:00',
  failureCooldownMinutes: 120,
};

test('paused blocks everything', () => {
  const r = evaluatePublish({ kind: 'story', now: NOON, timeZone: TZ, cfg: { ...cfg, paused: true }, history: [] });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'paused');
});

test('legacy dailyCap no longer caps the whole day (storyCap wins)', () => {
  const history = [
    { kind: 'story', at: NOON - 3600000, status: 'published' },
    { kind: 'note', at: NOON - 7200000, status: 'published' },
  ];
  const r = evaluatePublish({ kind: 'story', now: NOON, timeZone: TZ, cfg: { ...cfg, dailyCap: 2 }, history });
  assert.equal(r.ok, true);
});

test('story cap allows ten stories a day and blocks the eleventh', () => {
  const history = Array.from({ length: 9 }, (_, i) => ({ kind: 'story', at: NOON - (i + 1) * 3600000, status: 'published' }));
  assert.equal(evaluatePublish({ kind: 'story', now: NOON, timeZone: TZ, cfg, history }).ok, true);
  const full = [...history, { kind: 'story', at: NOON - 11 * 3600000, status: 'published' }];
  const r = evaluatePublish({ kind: 'story', now: NOON, timeZone: TZ, cfg, history: full });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'kind-cap');
});

test('note cap is one a day while stories continue', () => {
  const history = [{ kind: 'note', at: NOON - 3600000, status: 'published' }];
  const note = evaluatePublish({ kind: 'note', now: NOON, timeZone: TZ, cfg, history });
  assert.equal(note.ok, false);
  assert.equal(note.code, 'kind-cap');
  const story = evaluatePublish({ kind: 'story', now: NOON, timeZone: TZ, cfg, history });
  assert.equal(story.ok, true);
});

test('minimum interval between two posts', () => {
  const history = [{ kind: 'note', at: NOON - 10 * 60000, status: 'published' }];
  const r = evaluatePublish({ kind: 'story', now: NOON, timeZone: TZ, cfg, history });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'min-interval');
});

test('quiet hours wrap around midnight and can be ignored', () => {
  const r = evaluatePublish({ kind: 'story', now: NIGHT, timeZone: TZ, cfg, history: [] });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'quiet-hours');
  const forced = evaluatePublish({ kind: 'story', now: NIGHT, timeZone: TZ, cfg, history: [], ignoreQuiet: true });
  assert.equal(forced.ok, true);
});

test('transient failures trigger a cooldown', () => {
  const history = [{ kind: 'note', at: NOON - 30 * 60000, status: 'failed', code: 'rate-limit', error: '请求太频繁被限流' }];
  const r = evaluatePublish({ kind: 'note', now: NOON, timeZone: TZ, cfg, history });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'cooldown');
});

test('auth failures do not start a cooldown (fix and retry immediately)', () => {
  const history = [
    { kind: 'note', at: NOON - 10 * 60000, status: 'failed', code: 'not-logged-in', error: '尚未登录：请先在设置页用 sessionid 登录' },
    { kind: 'note', at: NOON - 9 * 60000, status: 'failed', code: 'challenge', error: 'Instagram 要求人机验证：请在手机 App 里处理后再试' },
  ];
  const r = evaluatePublish({ kind: 'note', now: NOON, timeZone: TZ, cfg, history });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('legacy auth failures recorded as generic "error" do not start a cooldown', () => {
  // 2026-10-25 线上记录：登录前点发布，code 是 'error'，只有消息里带「尚未登录」。
  const history = [{ kind: 'note', at: NOON - 5 * 60000, status: 'failed', code: 'error', error: 'RuntimeError: 尚未登录：请先在设置页用 sessionid 登录' }];
  const r = evaluatePublish({ kind: 'note', now: NOON, timeZone: TZ, cfg, history });
  assert.equal(r.ok, true, JSON.stringify(r));
});
