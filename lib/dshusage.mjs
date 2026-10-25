// Reading the real DSH activity: session logs (activity minutes) + the usage ledger
// (`$DSH_HOME/.dshw-usage.json`, tokens & cost). All IO lives here; the maths lives in usage.mjs.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { summarize, dayKey, shiftDay, daysBetween, DAY, DEFAULT_TIME_ZONE } from './usage.mjs';

const LEDGER = '.dshw-usage.json';

/** Decompress a `.jsonl.zstd` (or plain `.jsonl`) export and keep event times we care about. */
export function parseSessionText(text) {
  const samples = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object' || row.type === 'session') continue;
    const time = Number(row.time);
    if (!Number.isFinite(time)) continue;
    const usage = row.type === 'assistant/message' ? row.data?.usage : null;
    samples.push({ time, tokens: Number(usage?.totalTokens) || 0 });
  }
  return samples;
}

export function decompressSession(file, buf) {
  const raw = buf ?? fs.readFileSync(file);
  if (!String(file).endsWith('.zstd')) return raw.toString('utf8');
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('当前 Node 没有 zstdDecompressSync（需要 Node >= 23.8），无法读取 DSH 会话日志');
  }
  // DSH 的会话日志是**追加写的多帧 zstd**（每一帧 = 一两个事件）。
  // 不同 Node 版本行为不一样（实测：DSH 桌面版内置的 v24.21.0 一次只解第一帧，
  // 而系统装的 v24.22.0 一次能解完），所以必须自己逐帧解，不能赌单次调用。
  const parts = [];
  let pos = 0;
  let first = null;
  while (pos < raw.length) {
    const res = zlib.zstdDecompressSync(raw.subarray(pos), { info: true });
    const used = res.engine?.bytesWritten ?? 0;
    if (first === null) first = res.buffer;
    parts.push(res.buffer);
    if (!used) break;
    pos += used;
  }
  // 逐帧路径完全拿不到消费字节数时，退回「一次性解压」的结果
  return (parts.length ? Buffer.concat(parts) : first ?? Buffer.alloc(0)).toString('utf8');
}

export function listSessionFiles(dir, depth = 0, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < 4) listSessionFiles(p, depth + 1, out);
      continue;
    }
    if (!/\.jsonl(\.zstd)?$/.test(entry.name)) continue;
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    out.push({ path: p, mtime: st.mtimeMs, size: st.size });
  }
  return out;
}

/**
 * Merge every session file that could touch the window into one sample list.
 * A file untouched for longer than the window cannot contain activity inside it.
 * `cache` is a Map(filePath -> {mtime, size, samples}) so a long-running host only re-parses what changed.
 *
 * 缓存键带上 CACHE_VERSION：解析逻辑一改，旧进程里那些「按老逻辑解析出来的样本」立刻作废。
 * 2026-10-25 踩过：Host 里缓存着一批 samples: [] 的旧条目（当时解析器有 bug），文件 mtime/size
 * 没变 ⇒ 永远命中空缓存 ⇒ 统计一直是 0 分钟。改解析器时必须 bump 这个版本号。
 */
export const CACHE_VERSION = 'v3';

export function loadSamples({ home, now = Date.now(), timeZone = DEFAULT_TIME_ZONE, windowDays = 35, cache = new Map() } = {}) {
  const dir = path.join(home, 'sessions');
  const cutoff = now - (windowDays + 2) * DAY;
  const files = listSessionFiles(dir);
  const samples = [];
  const stats = { files: files.length, parsed: 0, skipped: 0, bytes: 0, errors: 0 };
  const keyOf = (file) => `${CACHE_VERSION}\u0000${file.path}`;
  for (const file of files) {
    stats.bytes += file.size;
    if (file.mtime < cutoff) { stats.skipped += 1; continue; }
    const key = keyOf(file);
    const hit = cache.get(key);
    let parsed = hit && hit.mtime === file.mtime && hit.size === file.size ? hit.samples : null;
    if (!parsed) {
      try {
        parsed = parseSessionText(decompressSession(file.path));
        cache.set(key, { mtime: file.mtime, size: file.size, samples: parsed });
        stats.parsed += 1;
      } catch {
        stats.errors += 1;
        continue;
      }
    }
    for (const s of parsed) samples.push(s);
  }
  // Drop cache entries for files that disappeared (or from an older CACHE_VERSION), so a long-lived host does not grow forever.
  const alive = new Set(files.map(keyOf));
  for (const key of cache.keys()) if (!alive.has(key)) cache.delete(key);
  return { samples, stats };
}

/** The hosted usage ledger: per-day cost (CNY) and per-day token counts from billing events. */
export function readUsageLedger(home) {
  const out = { todayCost: 0, costByDay: {}, tokensByDay: {}, events: 0 };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(home, LEDGER), 'utf8')); } catch { return out; }
  const history = raw?.history;
  if (history && typeof history === 'object') {
    for (const [day, value] of Object.entries(history)) {
      const n = Number(value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(n)) out.costByDay[day] = n;
    }
  }
  const todayKey = typeof raw?.date === 'string' ? raw.date : null;
  if (todayKey && Number.isFinite(Number(raw?.todayUsage))) out.costByDay[todayKey] = Number(raw.todayUsage);
  if (Number.isFinite(Number(raw?.todayUsage))) out.todayCost = Number(raw.todayUsage);
  const events = Array.isArray(raw?.events) ? raw.events : [];
  out.events = events.length;
  for (const e of events) {
    const day = typeof e?.day === 'string' ? e.day : null;
    const tokens = Number(e?.tokens);
    if (!day || !Number.isFinite(tokens)) continue;
    out.tokensByDay[day] = (out.tokensByDay[day] || 0) + tokens;
  }
  return out;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function dateLabel(now, timeZone = DEFAULT_TIME_ZONE) {
  const p = {};
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const part of fmt.formatToParts(new Date(now))) p[part.type] = part.value;
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'short' }).format(new Date(now));
  const month = Number(p.month);
  const day = Number(p.day);
  return { dateLabel: `${month} 月 ${day} 日`, weekday: WEEKDAYS[new Date(Date.UTC(+p.year, month - 1, day)).getUTCDay()] || weekday };
}

/**
 * One stop for everything the caption/card needs.
 * @returns stats consumed by lib/content.mjs plus the raw day table for the settings page.
 */
export function buildStats({ home, now = Date.now(), timeZone = DEFAULT_TIME_ZONE, cache = new Map(), ledger = null } = {}) {
  const { samples, stats: scan } = loadSamples({ home, now, timeZone, cache });
  const summary = summarize(samples, { timeZone, now });
  const usage = ledger || readUsageLedger(home);
  const today = dayKey(now, timeZone);
  const weekDays = Array.from({ length: 7 }, (_, i) => shiftDay(today, -i));
  const weekTokens = weekDays.reduce((a, d) => a + (usage.tokensByDay[d] || 0), 0);
  const weekCost = weekDays.reduce((a, d) => a + (usage.costByDay[d] || 0), 0);
  const { dateLabel: label, weekday } = dateLabel(now, timeZone);

  const last7 = weekDays.map((day) => ({
    day,
    minutes: summary.days[day]?.minutes || 0,
    tokens: usage.tokensByDay[day] || 0,
    cost: Number((usage.costByDay[day] || 0).toFixed(4)),
  }));

  return {
    now,
    timeZone,
    today: { day: today, minutes: summary.days[today]?.minutes || 0, tokens: usage.tokensByDay[today] || 0, cost: Number((usage.costByDay[today] || 0).toFixed(4)) },
    todayMinutes: summary.days[today]?.minutes || 0,
    todayTokens: usage.tokensByDay[today] || 0,
    todayCost: Number((usage.costByDay[today] || 0).toFixed(4)),
    weekMinutes: summary.week.minutes,
    weekTokens,
    weekCost: Number(weekCost.toFixed(4)),
    streakDays: summary.streakDays,
    peakHours: summary.peakHours,
    dateLabel: label,
    weekday,
    last7,
    scan: { ...scan, samples: samples.length },
    generatedAt: now,
  };
}

export { dayKey, shiftDay, daysBetween, DAY, DEFAULT_TIME_ZONE };

