// Pure DSH usage aggregation. No IO: callers feed samples { time, tokens?, kind? }.
//
// A "sample" is one observed DSH event (user message, assistant message, tool call…).
// We turn samples into "active blocks" (events closer than IDLE_GAP merge), split those
// blocks at local midnight, and accumulate minutes / tokens per local day.

export const MINUTE = 60_000;
export const DAY = 86_400_000;
export const DEFAULT_TIME_ZONE = 'Asia/Hong_Kong';

// Intl.DateTimeFormat 构造一次要几十微秒；summarize() 会对几万个样本逐个取本地日，
// 每次 new 一个会把 /state 拖到 4 秒以上（2026-10-25 实测），所以按时区缓存。
const formatterCache = new Map();

const partsFormatter = (timeZone) => {
  let fmt = formatterCache.get(timeZone);
  if (fmt) return fmt;
  fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, fmt);
  return fmt;
};

function partsOf(ts, timeZone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ts))) out[p.type] = p.value;
  return out;
}

export function dayKey(ts, timeZone = DEFAULT_TIME_ZONE) {
  const p = partsOf(ts, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localHour(ts, timeZone = DEFAULT_TIME_ZONE) {
  return Number(partsOf(ts, timeZone).hour) % 24;
}

export function timeZoneOffsetMs(ts, timeZone = DEFAULT_TIME_ZONE) {
  const p = partsOf(ts, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute ?? 0, +p.second ?? 0);
  return asUtc - ts;
}

export function nextLocalMidnight(ts, timeZone = DEFAULT_TIME_ZONE) {
  const offset = timeZoneOffsetMs(ts, timeZone);
  const local = new Date(ts + offset);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  return midnight - offset;
}

export function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function daysBetween(fromDay, toDay) {
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((parse(toDay) - parse(fromDay)) / DAY);
}

/**
 * Merge event times into active blocks. A block lasts from its first to its last event
 * plus a one minute tail (activity is assumed to continue briefly after the last event).
 */
export function blocksFromSamples(samples, { idleGapMs = 5 * MINUTE, tailMs = MINUTE, maxBlockMs = 3 * 3_600_000 } = {}) {
  const times = samples
    .map((s) => (typeof s === 'number' ? s : s && s.time))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const merged = [];
  for (const t of times) {
    const last = merged[merged.length - 1];
    if (last && t - last.last <= idleGapMs) last.last = t;
    else merged.push({ start: t, last: t });
  }
  return merged.map(({ start, last }) => {
    const capped = Math.min(last, start + Math.max(0, maxBlockMs - tailMs));
    return { start, end: capped + tailMs };
  });
}

export function splitBlock(block, timeZone = DEFAULT_TIME_ZONE) {
  const out = [];
  let cursor = block.start;
  while (cursor < block.end) {
    const midnight = nextLocalMidnight(cursor, timeZone);
    const end = Math.min(block.end, midnight);
    if (end > cursor) out.push({ day: dayKey(cursor, timeZone), start: cursor, end, ms: end - cursor });
    cursor = end;
    if (cursor <= block.start) break;
  }
  return out;
}

const emptyDay = () => ({
  minutes: 0,
  ms: 0,
  tokens: 0,
  events: 0,
  firstAt: Infinity,
  lastAt: 0,
  hours: new Array(24).fill(0),
});

function addHours(hours, start, end, timeZone) {
  // Blocks are capped at 3h, so minute-stepping stays cheap.
  for (let t = start; t < end; t += MINUTE) hours[localHour(t, timeZone)] += 1;
  const rest = (end - start) % MINUTE;
  if (rest > 0) hours[localHour(end - 1, timeZone)] += rest / MINUTE;
}

/**
 * @param {Array<{time:number, tokens?:number}>} samples
 * @returns {{days: Record<string, object>, today: object, week: {minutes:number,tokens:number}, streakDays:number, peakHours:Array<{hour:number,minutes:number}>, generatedAt:number}}
 */
export function summarize(samples, { timeZone = DEFAULT_TIME_ZONE, now = Date.now(), idleGapMs, tailMs, maxBlockMs } = {}) {
  const days = {};
  const ensure = (day) => (days[day] ??= emptyDay());
  const todayDay = dayKey(now, timeZone);
  ensure(todayDay);

  for (const s of samples) {
    const t = typeof s === 'number' ? s : s && s.time;
    if (!Number.isFinite(t)) continue;
    const day = ensure(dayKey(t, timeZone));
    day.tokens += Number(s?.tokens) || 0;
    day.events += 1;
    day.firstAt = Math.min(day.firstAt, t);
    day.lastAt = Math.max(day.lastAt, t);
  }

  for (const block of blocksFromSamples(samples, { idleGapMs, tailMs, maxBlockMs })) {
    for (const seg of splitBlock(block, timeZone)) {
      const d = ensure(seg.day);
      d.ms += seg.ms;
      d.firstAt = Math.min(d.firstAt, seg.start);
      d.lastAt = Math.max(d.lastAt, seg.end);
      addHours(d.hours, seg.start, seg.end, timeZone);
    }
  }

  for (const d of Object.values(days)) {
    d.minutes = Math.round(d.ms / MINUTE);
    if (!Number.isFinite(d.firstAt)) d.firstAt = 0;
  }

  const today = days[todayDay];
  const week = { minutes: 0, tokens: 0 };
  for (let i = 0; i < 7; i++) {
    const d = days[shiftDay(todayDay, -i)];
    if (!d) continue;
    week.minutes += d.minutes;
    week.tokens += d.tokens;
  }

  const hours = new Array(24).fill(0);
  const sinceDay = shiftDay(todayDay, -29);
  for (const [day, d] of Object.entries(days)) {
    if (day < sinceDay) continue;
    for (let h = 0; h < 24; h++) hours[h] += d.hours[h];
  }
  const peakHours = hours
    .map((minutes, hour) => ({ hour, minutes: Math.round(minutes) }))
    .filter((x) => x.minutes > 0)
    .sort((a, b) => (b.minutes - a.minutes) || (a.hour - b.hour))
    .slice(0, 3);

  return {
    days,
    today: { day: todayDay, ...today },
    week,
    streakDays: streakDays(days, todayDay),
    peakHours,
    generatedAt: now,
    timeZone,
  };
}

export function streakDays(days, todayDay, minMinutes = 1) {
  let cursor = todayDay;
  if (!((days[cursor]?.minutes ?? 0) >= minMinutes)) cursor = shiftDay(cursor, -1);
  let n = 0;
  while ((days[cursor]?.minutes ?? 0) >= minMinutes) {
    n += 1;
    cursor = shiftDay(cursor, -1);
  }
  return n;
}

export function hourLabel(hour) {
  if (hour < 5) return `凌晨 ${hour} 点`;
  if (hour < 8) return `清晨 ${hour} 点`;
  if (hour < 11) return `早上 ${hour} 点`;
  if (hour < 13) return `中午 ${hour} 点`;
  if (hour < 18) return `下午 ${hour - 12} 点`;
  if (hour < 23) return `晚上 ${hour - 12} 点`;
  return '深夜';
}
