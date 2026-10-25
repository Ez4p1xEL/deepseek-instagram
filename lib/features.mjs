/**
 * 设置页「功能开关」背后的纯逻辑。
 *
 * 这里只放判定：自动回复档位、提醒主人节流、远程控制、发布开关。
 * Host 层负责读配置、调 IG 接口与落盘，保持这里可单测。
 */

/** 自动回复他人的四档 */
export const AUTO_REPLY_MODES = Object.freeze(['off', 'all', 'mutual', 'follower']);

export function normalizeAutoReply(value) {
  const mode = String(value || '').trim().toLowerCase();
  return AUTO_REPLY_MODES.includes(mode) ? mode : 'off';
}

/**
 * 这条 1:1 私信要不要自动回。
 * relationship: { following, followedBy }
 *   following  = 我关注了对方
 *   followedBy = 对方关注我
 *   - all      ：谁都回
 *   - mutual   ：仅互关（双向都关注）
 *   - follower ：未被关注不回复 = 对方关注我就回（单向即可）
 */
export function autoReplyAllowed(mode, relationship) {
  const m = normalizeAutoReply(mode);
  if (m === 'off') return false;
  if (m === 'all') return true;
  const following = !!relationship?.following;
  const followedBy = !!relationship?.followedBy;
  if (m === 'mutual') return following && followedBy;
  if (m === 'follower') return followedBy;
  return false;
}

/** 同一个发送者的提醒间隔：30 分钟内最多一条 */
export const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

export function shouldNotifyOwner(state, userId, now = Date.now(), cooldownMs = NOTIFY_COOLDOWN_MS) {
  const key = String(userId || '');
  if (!key) return false;
  const last = Number(state?.notifyLast?.[key]) || 0;
  const at = Number(now) || Date.now();
  if (!last) return true;
  return at - last >= cooldownMs;
}

/** 记下「已经提醒过这个人」，返回新 state（不改原对象） */
export function markNotified(state, userId, now = Date.now()) {
  const key = String(userId || '');
  if (!key) return state;
  const next = { ...(state || {}) };
  next.notifyLast = { ...(next.notifyLast || {}), [key]: Number(now) || Date.now() };
  return next;
}

/** 私信总开关 × 远程控制开关：都开着才允许执行自然语言动作 */
export function remoteControlAllowed(cfg) {
  if (!cfg) return true;
  if (cfg.dm?.enabled === false) return false;
  if (cfg.dm?.intents === false) return false;
  return true;
}

/** 自动调度能不能发这一类；缺字段按「开」处理（兼容旧 config.json） */
export function publishAllowed(cfg, kind) {
  if (!cfg || cfg.enabled === false) return false;
  return cfg.publish?.[kind] !== false;
}

/**
 * 「完全权限」：主人说过之后，让电脑干活的两类动作不再走草稿确认。
 * 只有严格 `dm.fullAccess === true` 才放开（缺字段/'true' 字符串都算关）；
 * 且私信总开关与远程控制都得开着；对外发消息（reply_unread 等）永不放开。
 */
export function fullAccessAllowed(cfg, action) {
  if (!cfg) return false;
  if (cfg.dm?.fullAccess !== true) return false;
  if (cfg.dm?.enabled === false || cfg.dm?.intents === false) return false;
  return action === 'run_command' || action === 'dsh_task';
}

// ── 私信回复冷却（设置页可改，默认 30 秒）─────────────────────────────────

export const DM_COOLDOWN_DEFAULT_S = 30;
export const DM_COOLDOWN_MAX_S = 3600;

/**
 * 把设置页/配置里的冷却秒数归一成整数。
 * - 缺字段（undefined/null/''）→ fallback（默认 30）
 * - 非法值（NaN、'oops'）→ fallback
 * - 0 表示不冷却；负数按 0；超过 1 小时按 3600
 */
export function normalizeCooldownSeconds(value, fallback = DM_COOLDOWN_DEFAULT_S) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(DM_COOLDOWN_MAX_S, Math.max(0, Math.round(n)));
}

/** 从 config 里取冷却毫秒数（读不到就用默认 30 秒） */
export function dmCooldownMs(cfg) {
  return normalizeCooldownSeconds(cfg?.dm?.cooldownSeconds) * 1000;
}

/**
 * 这个私信会话现在能不能回：距上次回复要满 cooldownMs。
 * 读 state.replyLast[threadId]；旧版状态里的 strangerLast 也认。
 */
export function dmCooldownReady(state, threadId, now = Date.now(), cooldownMs = DM_COOLDOWN_DEFAULT_S * 1000) {
  const key = String(threadId || '');
  const ms = Math.max(0, Number(cooldownMs) || 0);
  if (ms <= 0) return true;
  const last = Number(state?.replyLast?.[key] ?? state?.strangerLast?.[key]) || 0;
  if (!last) return true;
  return (Number(now) || Date.now()) - last >= ms;
}

/** 记下「这个会话刚回过」，返回新 state（不改原对象） */
export function markDmReply(state, threadId, now = Date.now()) {
  const key = String(threadId || '');
  if (!key) return state;
  const next = { ...(state || {}) };
  next.replyLast = { ...(next.replyLast || {}), [key]: Number(now) || Date.now() };
  return next;
}
