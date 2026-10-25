import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dayKey } from '../lib/usage.mjs';
import {
  emptySpend, normalizeSpend, addCall, summarizeSpend, spendPath,
  loadSpendFile, saveSpendFile,
} from '../lib/spend.mjs';

const TZ = 'Asia/Hong_Kong';

function mkCall(ts, extra = {}) {
  const base = { ts, kind: 'dm', model: 'deepseek-flash', input: 1000, cache: 0, output: 100, tokens: 1100, cost: 0.0011 };
  return { ...base, ...extra };
}

test('addCall 累计到当天并保持 recent 最新在前', () => {
  const t1 = Date.UTC(2026, 9, 25, 1, 0, 0);
  const t2 = t1 + 60_000;
  let u = emptySpend();
  u = addCall(u, mkCall(t1));
  u = addCall(u, mkCall(t2, { tokens: 2200, cost: 0.0022 }));
  const day = dayKey(t2, TZ);
  assert.equal(u.days[day].calls, 2);
  assert.equal(u.days[day].tokens, 3300);
  assert.equal(u.days[day].cost.toFixed(4), '0.0033');
  assert.equal(u.recent.length, 2);
  assert.equal(u.recent[0].ts, t2);
});

test('recent 只保留最近 N 次', () => {
  let u = emptySpend();
  const base = Date.UTC(2026, 9, 25, 1, 0, 0);
  for (let i = 0; i < 5; i++) u = addCall(u, mkCall(base + i * 1000), { keep: 3 });
  assert.equal(u.recent.length, 3);
  assert.equal(u.recent[0].ts, base + 4000);
});

test('normalizeSpend 容忍垃圾数据', () => {
  assert.deepEqual(normalizeSpend(null), emptySpend());
  assert.deepEqual(normalizeSpend({ days: 'x', recent: 5 }), emptySpend());
  const norm = normalizeSpend({
    days: { '2026-10-25': { calls: 1, tokens: 10, cost: 0.1 }, bad: 'nope' },
    recent: [mkCall(1)],
  });
  assert.equal(norm.days['2026-10-25'].calls, 1);
  assert.equal(norm.days.bad, undefined);
  assert.equal(norm.recent.length, 1);
});

test('summarizeSpend：今日 / 近 7 天 / 按日列表', () => {
  const today = Date.UTC(2026, 9, 25, 6, 0, 0); // 北京 14:00
  const yesterday = today - 24 * 3600_000;
  let u = emptySpend();
  u = addCall(u, mkCall(today, { tokens: 1100, cost: 0.0011 }));
  u = addCall(u, mkCall(today + 1000, { tokens: 2200, cost: 0.0022 }));
  u = addCall(u, mkCall(yesterday, { tokens: 4400, cost: 0.0044 }));
  const out = summarizeSpend(u, { now: today + 5000, timeZone: TZ });
  assert.equal(out.today.calls, 2);
  assert.equal(out.today.tokens, 3300);
  assert.equal(out.today.cost.toFixed(4), '0.0033');
  assert.equal(out.week.tokens, 7700);
  assert.equal(out.week.cost.toFixed(4), '0.0077');
  assert.equal(out.days.length, 7);
  assert.equal(out.days[6].day, dayKey(today, TZ));
  assert.equal(out.days[5].tokens, 4400);
  assert.equal(out.recent[0].tokens, 2200);
});

test('空账本摘要为 0，不抛错', () => {
  const out = summarizeSpend(emptySpend(), { now: Date.now(), timeZone: TZ });
  assert.equal(out.today.calls, 0);
  assert.equal(out.today.cost, 0);
  assert.equal(out.week.tokens, 0);
  assert.equal(out.days.length, 7);
  assert.deepEqual(out.recent, []);
});

test('spendPath 指到插件家目录', () => {
  assert.equal(spendPath('C:/Users/x/.dsh'), join('C:/Users/x/.dsh', 'instagram-assistant', 'usage.json'));
});

test('文件读写：保存后可读回、损坏文件当空账本', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ig-spend-'));
  const file = spendPath(dir);
  try {
    const u = addCall(emptySpend(), mkCall(Date.UTC(2026, 9, 25, 1, 0, 0)));
    saveSpendFile(file, u);
    assert.equal(loadSpendFile(file).recent.length, 1);
    writeFileSync(file, '{ not json', 'utf8');
    assert.deepEqual(loadSpendFile(file), emptySpend());
    assert.deepEqual(loadSpendFile(join(dir, 'missing', 'usage.json')), emptySpend());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
