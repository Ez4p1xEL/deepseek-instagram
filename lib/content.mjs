// Caption / story-card building. Pure functions so they can be unit tested
// without a browser, a model, or an Instagram account.

const NOTE_MAX = 60;

export function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`;
}

export function formatTokens(tokens) {
  const n = Math.max(0, Math.round(Number(tokens) || 0));
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)} 亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万`;
  return String(n);
}

export function clampText(text, max = NOTE_MAX) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1).trimEnd() + '…';
}

/** Default note text: one short line, always <= 60 chars. */
export function defaultNote(stats, cfg = {}) {
  const parts = [`今日 DSH ${formatMinutes(stats.todayMinutes)}`];
  if (stats.streakDays > 1) parts.push(`连续 ${stats.streakDays} 天`);
  if (cfg.lifeNote) parts.push(String(cfg.lifeNote));
  return clampText(parts.join(' · '));
}

/** Default story caption: short, warm, mentions day + streak + week total. */
export function defaultStoryCaption(stats, cfg = {}) {
  const lines = [`今天在 DSH 里待了 ${formatMinutes(stats.todayMinutes)} ⏳`];
  if (stats.streakDays > 1) lines.push(`连续第 ${stats.streakDays} 天在线。`);
  if (stats.weekMinutes > stats.todayMinutes) lines.push(`本周累计 ${formatMinutes(stats.weekMinutes)}。`);
  if (stats.peakHours?.length) lines.push(`最常在${stats.peakHours.map((p) => hourLabel(p.hour)).slice(0, 2).join('和')}出现。`);
  if (cfg.lifeNote) lines.push(String(cfg.lifeNote));
  return lines.join('\n');
}

function hourLabel(hour) {
  if (hour < 5) return `凌晨 ${hour} 点`;
  if (hour < 8) return `清晨 ${hour} 点`;
  if (hour < 11) return `早上 ${hour} 点`;
  if (hour < 13) return `中午 ${hour} 点`;
  if (hour < 18) return `下午 ${hour - 12} 点`;
  if (hour < 23) return `晚上 ${hour - 12} 点`;
  return '深夜';
}

export function buildStoryCard(stats, cfg = {}) {
  const handle = cfg.handle || cfg.igUsername || '';
  const footer = [handle ? `@${String(handle).replace(/^@/, '')}` : '', 'DeepSeek Harness'].filter(Boolean).join(' · ');
  return {
    width: 1080,
    height: 1920,
    kicker: 'DSH DAILY',
    date: stats.dateLabel || '',
    weekday: stats.weekday || '',
    headline: '今天也在认真用 AI',
    stats: [
      { label: '今日专注', value: formatMinutes(stats.todayMinutes) },
      { label: '连续天数', value: `${stats.streakDays || 0} 天` },
      { label: '本周累计', value: formatMinutes(stats.weekMinutes) },
      { label: '今日 Token', value: formatTokens(stats.todayTokens) },
    ],
    peaks: (stats.peakHours || []).map((p) => ({ hour: p.hour, label: hourLabel(p.hour) })),
    life: cfg.lifeNote ? String(cfg.lifeNote) : String(stats.life || ''),
    footer,
    theme: {
      bg1: '#0B1026',
      bg2: '#221046',
      accent: '#FF4D8D',
      accent2: '#7C5CFF',
      text: '#FFFFFF',
      muted: '#A9A6C8',
    },
  };
}

export function buildStoryPrompt(stats, cfg = {}) {
  const system = [
    '你是一个 Instagram Story 文案助手。',
    '风格：轻松、像账号主人随手发的，不要营销腔，不要 emoji 堆砌（最多 2 个）。',
    '只输出文案本身，不要引号、不要解释。',
    '约束：3 行以内，总长不超过 120 个字符。',
    cfg.tone ? `语气要求：${cfg.tone}` : '',
  ].filter(Boolean).join('\n');
  const user = [
    `今天是 ${stats.dateLabel || ''} ${stats.weekday || ''}。`,
    `我在 DeepSeek Harness 里今天用了 ${formatMinutes(stats.todayMinutes)}，本周累计 ${formatMinutes(stats.weekMinutes)}，连续 ${stats.streakDays} 天。`,
    stats.peakHours?.length ? `最常在${stats.peakHours.map((p) => hourLabel(p.hour)).slice(0, 2).join('和')}使用。` : '',
    cfg.lifeNote ? `今天的生活素材：${cfg.lifeNote}` : '没有额外生活素材，就围绕使用数据写。',
    '写一条 Story 文案。',
  ].filter(Boolean).join('\n');
  return { system, user };
}

export function buildNotePrompt(stats, cfg = {}) {
  const system = [
    '你是一个 Instagram Note 文案助手（Note 最多 60 个字符）。',
    '风格：轻松、像本人随手写的一句话，不要营销腔。',
    '只输出一句话，不要引号、不要解释，不要换行。',
    cfg.tone ? `语气要求：${cfg.tone}` : '',
  ].filter(Boolean).join('\n');
  const user = [
    `今天在 DSH 用了 ${formatMinutes(stats.todayMinutes)}，连续 ${stats.streakDays} 天，本周 ${formatMinutes(stats.weekMinutes)}。`,
    cfg.lifeNote ? `生活素材：${cfg.lifeNote}` : '',
    '写一条 Note（不超过 60 字符）。',
  ].filter(Boolean).join('\n');
  return { system, user };
}

export { NOTE_MAX };
