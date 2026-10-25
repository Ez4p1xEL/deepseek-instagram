// 助理自己的用量账本：每次模型调用的 token 与花费，按日聚合 + 最近 N 次明细。
//
// 文件：$DSH_HOME/instagram-assistant/usage.json
//   { v: 1, days: { 'YYYY-MM-DD': { calls, input, cache, output, tokens, cost } }, recent: [ {ts, day, kind, model, input, cache, output, tokens, cost} ] }
//
// 只记「助理自己发起的调用」（发帖文案 / 私信 / 群聊 / 陌生人 / 意图识别），
// 与 DSH 整机账本 .dshw-usage.json 分开：那是所有会话合计。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { dayKey, shiftDay, DEFAULT_TIME_ZONE } from './usage.mjs';

export const RECENT_KEEP = 200;

export function emptySpend() {
  return { v: 1, days: {}, recent: [] };
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 把磁盘上的（可能损坏/老版本）账本归一化成安全形状；坏就当成空账本。 */
export function normalizeSpend(raw) {
  const out = emptySpend();
  if (!raw || typeof raw !== 'object') return out;
  if (raw.days && typeof raw.days === 'object') {
    for (const [day, row] of Object.entries(raw.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (!row || typeof row !== 'object') continue;
      out.days[day] = {
        calls: num(row.calls),
        input: num(row.input),
        cache: num(row.cache),
        output: num(row.output),
        tokens: num(row.tokens),
        cost: num(row.cost),
      };
    }
  }
  if (Array.isArray(raw.recent)) {
    out.recent = raw.recent
      .filter((c) => c && typeof c === 'object' && Number.isFinite(Number(c.ts)))
      .map((c) => ({
        ts: Number(c.ts),
        day: typeof c.day === 'string' ? c.day : '',
        kind: String(c.kind || 'other'),
        model: String(c.model || ''),
        input: num(c.input),
        cache: num(c.cache),
        output: num(c.output),
        tokens: num(c.tokens),
        cost: num(c.cost),
      }));
  }
  return out;
}

/**
 * 记一次调用（返回新对象，不修改入参）。
 * call: { ts, kind, model, input, cache, output, tokens, cost }
 */
export function addCall(spend, call, { keep = RECENT_KEEP } = {}) {
  const base = normalizeSpend(spend);
  const ts = Number(call?.ts) || Date.now();
  const day = String(call?.day || dayKey(ts, call?.timeZone || DEFAULT_TIME_ZONE));
  const input = num(call?.input);
  const cache = num(call?.cache);
  const output = num(call?.output);
  const tokens = Number.isFinite(Number(call?.tokens)) ? Math.max(0, Number(call.tokens)) : input + cache + output;
  const cost = num(call?.cost);
  const entry = { ts, day, kind: String(call?.kind || 'other'), model: String(call?.model || ''), input, cache, output, tokens, cost };
  const days = { ...base.days };
  const prev = days[day] || { calls: 0, input: 0, cache: 0, output: 0, tokens: 0, cost: 0 };
  days[day] = {
    calls: prev.calls + 1,
    input: prev.input + input,
    cache: prev.cache + cache,
    output: prev.output + output,
    tokens: prev.tokens + tokens,
    cost: prev.cost + cost,
  };
  const recent = [entry, ...base.recent].slice(0, Math.max(1, Number(keep) || RECENT_KEEP));
  return { v: 1, days, recent };
}

const ZERO_DAY = () => ({ calls: 0, input: 0, cache: 0, output: 0, tokens: 0, cost: 0 });

/**
 * 前端要的摘要：今日、近 N 天合计、近 N 天逐日（旧→新）、最近几次明细（新→旧）。
 * @param {{now?: number, timeZone?: string, windowDays?: number, recentLimit?: number}} opts
 */
export function summarizeSpend(spend, { now = Date.now(), timeZone = DEFAULT_TIME_ZONE, windowDays = 7, recentLimit = 8 } = {}) {
  const base = normalizeSpend(spend);
  const todayDay = dayKey(now, timeZone);
  const window = Math.max(1, Number(windowDays) || 7);
  const days = [];
  let week = ZERO_DAY();
  for (let i = window - 1; i >= 0; i--) {
    const day = shiftDay(todayDay, -i);
    const row = base.days[day] || ZERO_DAY();
    days.push({ day, ...row });
    week = {
      calls: week.calls + row.calls,
      input: week.input + row.input,
      cache: week.cache + row.cache,
      output: week.output + row.output,
      tokens: week.tokens + row.tokens,
      cost: week.cost + row.cost,
    };
  }
  const today = base.days[todayDay] || ZERO_DAY();
  const recent = [...base.recent].sort((a, b) => b.ts - a.ts).slice(0, Math.max(0, Number(recentLimit) || 8));
  return {
    today: { day: todayDay, ...today },
    week: { days: window, ...week },
    days,
    recent,
  };
}

export function spendPath(home) {
  return join(String(home || ''), 'instagram-assistant', 'usage.json');
}

export function loadSpendFile(file) {
  try {
    return normalizeSpend(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return emptySpend();
  }
}

export function saveSpendFile(file, spend) {
  const body = JSON.stringify(normalizeSpend(spend));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body, 'utf8');
}
