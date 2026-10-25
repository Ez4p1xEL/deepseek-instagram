import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { buildStats, decompressSession, listSessionFiles, loadSamples, parseSessionText, readUsageLedger } from '../lib/dshusage.mjs';

const hasZstd = typeof zlib.zstdCompressSync === 'function' && typeof zlib.zstdDecompressSync === 'function';

function writeSession(home, name, rows) {
  const dir = path.join(home, 'sessions', 'workspace-a');
  fs.mkdirSync(dir, { recursive: true });
  const text = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const file = path.join(dir, name);
  if (hasZstd) fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from(text, 'utf8')));
  return file;
}

function fixture(now) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-instagram-'));
  const day = (iso) => Date.parse(iso);
  writeSession(home, 'session.v4.jsonl.zstd', [
    { type: 'session', version: 4, id: 'sess-1', createdAt: day('2026-10-25T09:00:00Z') },
    { type: 'turn/start', seq: 1, time: day('2026-10-25T10:00:00Z'), data: { turn: 1 } },
    { type: 'user/message', seq: 2, time: day('2026-10-25T10:00:20Z'), data: { content: [] } },
    { type: 'assistant/message', seq: 3, time: day('2026-10-25T10:04:00Z'), data: { message: { role: 'assistant', content: [] }, usage: { totalTokens: 1500 } } },
    { type: 'turn/end', seq: 4, time: day('2026-10-25T10:04:05Z'), data: { turn: 1 } },
    { type: 'not json at all' },
    { type: 'tool/call', seq: 5, time: day('2026-10-24T10:00:00Z'), data: {} },
  ]);
  fs.writeFileSync(path.join(home, '.dshw-usage.json'), JSON.stringify({
    date: '2026-10-25',
    todayUsage: 1.5,
    history: { '2026-10-24': 0.5, '2026-10-25': 1.5, garbage: 9 },
    events: [
      { ts: day('2026-10-25T10:05:00Z'), day: '2026-10-25', model: 'deepseek-flash', cost: 1, tokens: 1000 },
      { ts: day('2026-10-25T10:15:00Z'), day: '2026-10-25', model: 'deepseek-flash', cost: 0.5, tokens: 500 },
      { ts: day('2026-10-24T10:00:00Z'), day: '2026-10-24', model: 'deepseek-flash', cost: 0.5, tokens: 300 },
    ],
  }));
  return home;
}

test('parseSessionText keeps time/tokens and survives broken lines', () => {
  const rows = [
    { type: 'session' },
    { type: 'assistant/message', time: 1000, data: { usage: { totalTokens: 7 } } },
    { bad: true },
    { type: 'user/message', time: 2000 },
  ];
  const samples = parseSessionText(rows.map((r) => JSON.stringify(r)).join('\n') + '\n{bad');
  assert.deepEqual(samples, [{ time: 1000, tokens: 7 }, { time: 2000, tokens: 0 }]);
});

test('readUsageLedger reads per-day cost and tokens defensively', () => {
  const home = fixture(Date.parse('2026-10-25T12:00:00Z'));
  const ledger = readUsageLedger(home);
  assert.equal(ledger.costByDay['2026-10-25'], 1.5);
  assert.equal(ledger.tokensByDay['2026-10-25'], 1500);
  assert.equal(ledger.costByDay.garbage, undefined);
});

test('listSessionFiles finds nested session logs', { skip: !hasZstd && 'node has no zstd' }, () => {
  const home = fixture(Date.parse('2026-10-25T12:00:00Z'));
  const files = listSessionFiles(path.join(home, 'sessions'));
  assert.equal(files.length, 1);
  assert.match(files[0].path, /session\.v4\.jsonl\.zstd$/);
});

test('buildStats merges activity blocks and billing data', { skip: !hasZstd && 'node has no zstd' }, () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const home = fixture(now);
  const stats = buildStats({ home, now, timeZone: 'UTC' });
  // 10:00 → 10:04:05 activity + 1 min tail ⇒ 5 minutes today
  assert.equal(stats.todayMinutes, 5);
  assert.equal(stats.todayTokens, 1500);
  assert.equal(stats.todayCost, 1.5);
  assert.equal(stats.streakDays, 2);
  assert.equal(stats.weekMinutes, 6); // today 5 + yesterday's 1 tail minute
  assert.equal(stats.last7.length, 7);
  assert.equal(stats.last7[0].tokens, 1500);
  assert.equal(stats.scan.errors, 0);
});

test('buildStats works on a machine without session logs yet', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-instagram-empty-'));
  const stats = buildStats({ home, now: Date.parse('2026-10-25T12:00:00Z'), timeZone: 'UTC' });
  assert.equal(stats.todayMinutes, 0);
  assert.equal(stats.todayTokens, 0);
  assert.equal(stats.streakDays, 0);
  assert.equal(stats.weekMinutes, 0);
});

test('decompressSession reads every frame of an append-only session log', () => {
  // DSH 的会话日志是多帧 zstd（追加写）。桌面版内置 Node 24.21 一次只解第一帧 ⇒ 必须逐帧解。
  const rows = [
    { type: 'session', version: 4 },
    { type: 'assistant/message', seq: 1, time: 1000, data: { usage: { totalTokens: 7 } } },
    { type: 'user/message', seq: 2, time: 2000 },
  ];
  const raw = Buffer.concat(rows.map((row) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n', 'utf8'))));
  const text = decompressSession('demo.jsonl.zstd', raw);
  assert.equal(text.split('\n').filter(Boolean).length, 3);
  assert.equal(parseSessionText(text).length, 2);
});

test('loadSamples ignores cache entries from an older CACHE_VERSION', { skip: !hasZstd && 'node has no zstd' }, () => {
  // 2026-10-25 事故的回归测试：长驻 Host 里存着一批 samples: [] 的旧缓存（按老解析逻辑算的），
  // 文件 mtime/size 没变就永远命中空缓存 ⇒ 统计恒为 0 分钟。版本号一变就必须重新解析。
  const now = Date.parse('2026-10-25T12:00:00Z');
  const home = fixture(now);
  const file = listSessionFiles(path.join(home, 'sessions'))[0];
  const cache = new Map();
  cache.set(`v1\u0000${file.path}`, { mtime: file.mtime, size: file.size, samples: [] });

  const { samples, stats } = loadSamples({ home, now, timeZone: 'UTC', cache });
  assert.equal(stats.parsed, 1, 'stale cache entry must not be reused');
  assert.ok(samples.length > 0, 'samples must be re-parsed');
  assert.equal(cache.has(`v1\u0000${file.path}`), false, 'stale key is dropped');
});


