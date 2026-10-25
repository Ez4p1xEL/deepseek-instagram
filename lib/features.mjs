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
