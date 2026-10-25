// DeepSeek 官方价目表与峰谷时段（人民币 / 百万 token）。
//
// 价格来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// 与本机鲸鱼挂件（dsh-whale-widget）写 .dshw-usage.json 的口径一致，
// 所以这里算出来的「助理花费」和整个 DSH 的账本可以对得上。
//
// 计价规则（2026-09 现行）：
//   - Flash（正式名 deepseek-flash = DeepSeek-V4.1-Flash）：缓存命中 ¥0.02、未命中 ¥1、输出 ¥4 / 百万 token；
//   - Pro（deepseek-v4-pro）为 Flash 的 3 倍价：缓存命中 ¥0.15、未命中 ¥4.5、输出 ¥13.5；
//   - 高峰时段（北京时间周一至周五 9:00–12:00、14:00–18:00，法定节假日除外）三项价格翻倍；
//     其余时段（晚/午休/周末/法定节假日全天）按空闲价。
//
// 注意：每年 11 月国务院发布次年放假安排后，要把新一年的 HOLIDAY_VALLEY 补上。

/** 价格档位：[空闲时段价, 高峰时段价]（CNY / 百万 token）。 */
export const PRICES = Object.freeze({
  'deepseek-flash': { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  'deepseek-v4-flash-vision-exp': { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  'deepseek-v4-flash': { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  'deepseek-v4-pro': { hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] },
});

export const DEFAULT_MODEL = 'deepseek-flash';

/** 高峰时段（北京时间小时数，左闭右开）。 */
export const PEAK_HOURS = [[9, 12], [14, 18]];

/** 法定节假日（全天按空闲价计费）。只需列放假日；调休上班日都在周末，本来就按空闲价。 */
export const HOLIDAY_VALLEY = Object.freeze({
  '2026-01-01': 1, '2026-01-02': 1, '2026-01-03': 1, // 元旦
  '2026-02-15': 1, '2026-02-16': 1, '2026-02-17': 1, '2026-02-18': 1, // 春节
  '2026-02-19': 1, '2026-02-20': 1, '2026-02-21': 1, '2026-02-22': 1, '2026-02-23': 1,
  '2026-04-04': 1, '2026-04-05': 1, '2026-04-06': 1, // 清明
  '2026-05-01': 1, '2026-05-02': 1, '2026-05-03': 1, '2026-05-04': 1, '2026-05-05': 1, // 劳动节
  '2026-06-19': 1, '2026-06-20': 1, '2026-06-21': 1, // 端午
  '2026-09-25': 1, '2026-09-26': 1, '2026-09-27': 1, // 中秋
  '2026-10-01': 1, '2026-10-02': 1, '2026-10-03': 1, '2026-10-04': 1, // 国庆
  '2026-10-05': 1, '2026-10-06': 1, '2026-10-07': 1,
});

/** 周末全天空闲价从这一刻生效（北京时间 2026-08-23 00:00）。 */
const WEEKEND_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000);
/** 「法定节假日全天空闲」规则从这一刻生效（北京时间 2026-09-19 00:00）。 */
const HOLIDAY_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 8, 18, 16, 0, 0) / 1000);

/** 把 epoch 毫秒/秒换成北京日历（用「+8h 后按 UTC 读」的办法，避免依赖本机时区）。 */
function beijingOf(timeSec) {
  return new Date(Number(timeSec) * 1000 + 8 * 3600 * 1000);
}

/**
 * 这个时刻是否处于高峰时段（北京时间，周一至周五 9–12 / 14–18，法定节假日不算）。
 * @param {number} timeSec epoch 秒
 */
export function isPeakTime(timeSec) {
  const n = Number(timeSec);
  if (!Number.isFinite(n)) return false;
  const bj = beijingOf(n);
  const yy = bj.toISOString().slice(0, 10);
  if (n >= WEEKEND_VALLEY_FROM_SEC) {
    const dow = bj.getUTCDay();
    if (dow === 0 || dow === 6) return false;
  }
  if (n >= HOLIDAY_VALLEY_FROM_SEC && HOLIDAY_VALLEY[yy]) return false;
  const hour = bj.getUTCHours();
  return PEAK_HOURS.some(([start, end]) => hour >= start && hour < end);
}

/** 按模型名（子串匹配，最长优先）取价格档位；未知模型按 Flash 计。 */
export function priceFor(model) {
  const name = String(model || '').toLowerCase();
  const keys = Object.keys(PRICES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (name.includes(key)) return PRICES[key];
  }
  return PRICES[DEFAULT_MODEL];
}

/**
 * 一次模型调用的花费（人民币）。
 * 口径与鲸鱼挂件一致：inputTokens 是「未命中缓存」的输入，cacheReadTokens 是命中缓存的输入，output 是输出。
 * @param {{model?: string, inputTokens?: number, cacheReadTokens?: number, outputTokens?: number, ts?: number}} usage
 * @returns {number} CNY
 */
export function costCny({ model = DEFAULT_MODEL, inputTokens = 0, cacheReadTokens = 0, outputTokens = 0, ts = Date.now() } = {}) {
  const price = priceFor(model);
  // ts 可以是毫秒（Date.now()）也可以是秒（epoch），两种都收。
  const raw = Number(ts) || Date.now();
  const sec = raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw);
  const peak = isPeakTime(sec) ? 1 : 0;
  const input = Math.max(0, Number(inputTokens) || 0);
  const cache = Math.max(0, Number(cacheReadTokens) || 0);
  const output = Math.max(0, Number(outputTokens) || 0);
  return (cache / 1e6) * price.hit[peak] + (input / 1e6) * price.miss[peak] + (output / 1e6) * price.out[peak];
}

/** 展示用金额：小于 1 分保留 4 位，小于 1 元保留 3 位，其余 2 位。 */
export function formatCny(cny) {
  const n = Number(cny) || 0;
  if (n === 0) return '¥0.00';
  if (n < 0.01) return `¥${n.toFixed(4)}`;
  if (n < 1) return `¥${n.toFixed(3)}`;
  return `¥${n.toFixed(2)}`;
}
