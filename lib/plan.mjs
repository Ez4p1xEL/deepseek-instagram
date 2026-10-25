/**
 * 每日 Story 计划：把 10 条分到 08:00–23:00 的随机时间点，并分配内容类型。
 *
 * 约束（见 README「每天 10 条」）：
 * - 同一天、同一配置 ⇒ 计划完全一致（用日期做随机种子）。重启/热重载不会打乱时间点。
 * - 全部落在 [start, end) 内，相邻两条至少间隔 minGapMinutes。
 * - 类型配额：text ≥ 2、thought ≥ 2、stats ≤ 2，其余 life —— 保证「生活 / 感想 / 纯文本 / 数据卡」都出现。
 *
 * 纯函数，不碰 IO，方便单测。
 */

const MINUTE = 60_000;

/** 32 位字符串散列（xmur3 变体），用作随机种子。 */
export function hashSeed(text) {
  let h = 1779033703 ^ String(text).length;
  for (let i = 0; i < String(text).length; i += 1) {
    h = Math.imul(h ^ String(text).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** mulberry32：小而稳的可复现伪随机。 */
export function makeRng(seed) {
  let a = typeof seed === 'function' ? seed() : Number(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "HH:MM" → 当天第几分钟 */
export function minutesOfDay(text, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return fallback;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

/** 某时区在时刻 t 的 UTC 偏移（毫秒）。 */
export function tzOffsetMs(t, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t));
  const pick = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour'), pick('minute'), pick('second'));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** 'YYYY-MM-DD' 在该时区的本地零点时间戳。 */
export function localDayStart(day, timeZone) {
  const [y, m, d] = String(day).split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  // 两次迭代足够收敛（夏令时边界也只有 ±1 小时的偏移跳变）。
  const t1 = naive - tzOffsetMs(naive, timeZone);
  return naive - tzOffsetMs(t1, timeZone);
}

/** 类型配额；count=10 时是 text 2 / thought 3 / stats 2 / life 3。 */
export function kindQuota(count) {
  const n = Math.max(1, Math.round(count));
  // 小配额时按比例缩放，避免「三类最少值」加起来超过总数。
  const text = Math.min(n, Math.max(1, Math.round(n * 0.2)));
  const thought = Math.min(n - text, Math.max(1, Math.round(n * 0.3)));
  const stats = Math.min(n - text - thought, Math.min(2, Math.max(n >= 5 ? 1 : 0, Math.round(n * 0.15))));
  const life = Math.max(0, n - text - thought - stats);
  return [
    ...Array(text).fill('text'),
    ...Array(thought).fill('thought'),
    ...Array(stats).fill('stats'),
    ...Array(life).fill('life'),
  ];
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 当天计划。
 * @param {{day:string, count?:number, start?:string, end?:string, minGapMinutes?:number, timeZone?:string}} input
 * @returns {{day:string, count:number, window:{start:number,end:number}, slots:Array<{index:number, slot:string, at:number, kind:'text'|'thought'|'stats'|'life'}>}}
 */
export function dayPlan({ day, count = 10, start = '08:00', end = '23:00', minGapMinutes = 30, timeZone = 'Asia/Hong_Kong' }) {
  const total = Math.max(1, Math.min(24, Math.round(count)));
  const startMin = minutesOfDay(start, 8 * 60);
  let endMin = minutesOfDay(end, 23 * 60);
  if (endMin <= startMin) endMin = Math.min(24 * 60, startMin + 60);
  const width = endMin - startMin;
  const gap = Math.max(0, Math.min(minGapMinutes, Math.floor(width / total)));
  const dayStart = localDayStart(day, timeZone);
  const rng = makeRng(hashSeed(`plan:${day}:${total}:${startMin}:${endMin}`));

  // 分层：[start,end) 均分 total 桶，每桶取一个随机点 —— 既均匀又不像机器定时。
  const bucket = width / total;
  const points = [];
  for (let i = 0; i < total; i += 1) {
    const low = startMin + i * bucket;
    points.push(Math.floor(low + rng() * bucket));
  }
  // 正向压间隔，再反向收回到窗口内。
  for (let i = 1; i < points.length; i += 1) {
    points[i] = Math.max(points[i], points[i - 1] + gap);
  }
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const upper = endMin - 1 - (points.length - 1 - i) * gap;
    points[i] = Math.min(points[i], upper);
  }
  for (let i = 1; i < points.length; i += 1) {
    if (points[i] <= points[i - 1]) points[i] = points[i - 1] + 1;
  }

  const kinds = shuffle(kindQuota(total), rng);
  const slots = points.map((minute, index) => ({
    index,
    slot: `${day}#${index}`,
    at: dayStart + minute * MINUTE,
    minute,
    kind: kinds[index],
  }));
  return { day, count: total, window: { start: startMin, end: endMin, minGapMinutes: gap }, slots };
}

/** "09:05" 形式，方便 UI 展示。 */
export function clockOf(at, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

export const KINDS = ['life', 'thought', 'text', 'stats'];
export const KIND_LABELS = {
  life: '生活',
  thought: '助理感想',
  text: '纯文本',
  stats: '数据卡',
};
