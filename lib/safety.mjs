// Publishing safety rules. Pure: the caller passes the clock, config and post history.
import { dayKey, DEFAULT_TIME_ZONE } from './usage.mjs';

export const DEFAULT_SAFETY = {
  paused: false,
  dryRun: false,
  dailyCap: 11, // 旧字段：总量上限，保留兼容；新的按类型上限见 storyCap / noteCap
  storyCap: 10,
  noteCap: 1,
  onePerKind: true, // 只对 note 生效（Story 每天最多 storyCap 条，不存在「一类一条」）
  minIntervalMinutes: 30,
  failureCooldownMinutes: 120,
  quietStart: '23:00',
  quietEnd: '08:00',
};

/** 某类内容当天的上限。story 默认 10，note 默认 1。 */
export function capFor(kind, cfg = {}) {
  const c = { ...DEFAULT_SAFETY, ...cfg };
  if (kind === 'story') return Number.isFinite(Number(c.storyCap)) ? Number(c.storyCap) : Number(c.dailyCap) || 1;
  if (kind === 'note') return Number.isFinite(Number(c.noteCap)) ? Number(c.noteCap) : Number(c.dailyCap) || 1;
  return Number(c.dailyCap) || 1;
}

function minutesOfDay(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function inQuietHours(now, timeZone, quietStart, quietEnd) {
  const start = minutesOfDay(quietStart);
  const end = minutesOfDay(quietEnd);
  if (start == null || end == null || start === end) return false;
  const d = new Date(now);
  // local minutes since midnight
  const local = new Date(now + timeZoneOffset(now, timeZone));
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function timeZoneOffset(ts, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date(ts))) p[part.type] = part.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}

// 只有「重试可能自愈」的失败才值得冷却：网络抖动、限流、未知错误。
// 识别得出来的问题（未登录 / 人机验证 / 凭证被拒 / 卡片缺失 / 输入为空）不冷却 ——
// 人被叫来处理完就该立刻能重试，否则业务上像是「点了发布没反应」（2026-10-25 线上踩过）。
const COOLDOWN_CODES = new Set(['network', 'timeout', 'rate-limit', 'throttled', 'error', 'unknown']);
const AUTH_FAILURE = /尚未登录|not-logged-in|login_required|login-required|challenge_required|bad-password|会话文件/i;

function isTransientFailure(record) {
  const code = String(record?.code || 'error').toLowerCase();
  if (!COOLDOWN_CODES.has(code)) return false;
  return !AUTH_FAILURE.test(String(record?.error || ''));
}

/**
 * @param {{kind:'story'|'note'|'post', now:number, timeZone?:string, cfg?:object, history?:Array<{kind:string,at:number,status:'published'|'failed'}>, ignoreQuiet?:boolean}} input
 * @returns {{ok:true} | {ok:false, code:string, reason:string}}
 */
export function evaluatePublish({ kind, now = Date.now(), timeZone = DEFAULT_TIME_ZONE, cfg = {}, history = [], ignoreQuiet = false }) {
  const c = { ...DEFAULT_SAFETY, ...cfg };
  const today = dayKey(now, timeZone);
  const todays = history.filter((h) => Number.isFinite(h.at) && dayKey(h.at, timeZone) === today);
  const publishedToday = todays.filter((h) => h.status === 'published');
  const lastFailed = todays
    .filter((h) => h.status === 'failed' && isTransientFailure(h))
    .sort((a, b) => b.at - a.at)[0];

  if (c.paused) return { ok: false, code: 'paused', reason: '发布已暂停' };

  if (lastFailed && now - lastFailed.at < c.failureCooldownMinutes * 60_000) {
    return { ok: false, code: 'cooldown', reason: `上次失败后冷却中（${c.failureCooldownMinutes} 分钟）` };
  }

  const cap = capFor(kind, c);
  const sameKind = publishedToday.filter((h) => h.kind === kind).length;
  if (sameKind >= cap) {
    return { ok: false, code: 'kind-cap', reason: `今天已经发过 ${cap} 条 ${kind} 了` };
  }

  if (c.onePerKind && kind === 'note' && sameKind >= 1) {
    return { ok: false, code: 'kind-cap', reason: '今天已经发过 note 了' };
  }

  const lastPublished = publishedToday.map((h) => h.at).sort((a, b) => b - a)[0];
  if (lastPublished && now - lastPublished < c.minIntervalMinutes * 60_000) {
    return { ok: false, code: 'min-interval', reason: `距上一条不足 ${c.minIntervalMinutes} 分钟` };
  }

  if (!ignoreQuiet && inQuietHours(now, timeZone, c.quietStart, c.quietEnd)) {
    return { ok: false, code: 'quiet-hours', reason: `现在是安静时段（${c.quietStart}–${c.quietEnd}）` };
  }

  return { ok: true };
}
