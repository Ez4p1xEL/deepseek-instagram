/**
 * 从 dm-poll 的结果里挑出「还没回的私信」。
 *
 * 规则（和 README 的安全边界一致）：
 *  - 只处理 1:1 会话，群聊永远不算；
 *  - 跳过主人自己的会话（那是主人在跟助理说话，不是「未读私信」）；
 *  - 最后一句是助理自己发的 → 已经回过了，跳过；
 *  - 只回 72 小时内的，最多 limit 条；
 *  - replied 是「已回水位」：threadId → 已回到的那条时间戳，比它新的才算新消息。
 *
 * 纯函数，方便单测；Host 只负责发。
 */

export const UNREAD_LIMIT_DEFAULT = 3;
export const UNREAD_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/**
 * @param {object} opts
 * @param {Array<object>} opts.messages dm-poll 返回的消息
 * @param {Array<object>} opts.threadRows dm-poll 返回的会话
 * @param {string} [opts.selfPk] 助理自己的 pk
 * @param {string} [opts.ownerPk] 主人 pk（这个人的会话不算未读私信）
 * @param {number} [opts.limit]
 * @param {Record<string, number>} [opts.replied] 已回水位
 * @param {number} [opts.maxAgeMs]
 * @param {number} [opts.now]
 * @returns {Array<{threadId:string,title:string,username:string,incoming:string,timestamp:number}>}
 */
export function pickUnreadDm({
  messages = [], threadRows = [], selfPk = '', ownerPk = '',
  limit = UNREAD_LIMIT_DEFAULT, replied = {}, maxAgeMs = UNREAD_MAX_AGE_MS, now = Date.now(),
} = {}) {
  const rows = new Map();
  for (const row of threadRows || []) {
    const id = String(row?.id ?? '');
    if (id) rows.set(id, row);
  }

  const byThread = new Map();
  for (const m of messages || []) {
    const id = String(m?.threadId ?? '');
    if (!id) continue;
    if (!String(m?.text ?? '').trim()) continue; // 图片/贴纸这类没有文字的，回不了
    if (!byThread.has(id)) byThread.set(id, []);
    byThread.get(id).push(m);
  }

  const out = [];
  for (const [threadId, list] of byThread) {
    const row = rows.get(threadId);
    if (!row || row.isGroup) continue;
    const members = (row.memberPks || []).map(String);
    if (ownerPk && members.includes(String(ownerPk))) continue; // 和主人的会话走指令通道，不算未读私信
    const last = list.slice().sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0)).pop();
    const ts = Number(last?.timestamp) || 0;
    if (!ts || now - ts > maxAgeMs) continue;
    if (selfPk && String(last.userId) === String(selfPk)) continue; // 我最后说的 → 已回
    if (Number(replied[threadId] || 0) >= ts) continue; // 这条已经回过了
    out.push({
      threadId,
      title: String(row.title || ''),
      username: String(last.username || last.userId || ''),
      incoming: String(last.text).trim(),
      timestamp: ts,
    });
  }
  out.sort((a, b) => b.timestamp - a.timestamp);
  const max = Math.max(0, Number.isFinite(Number(limit)) ? Number(limit) : UNREAD_LIMIT_DEFAULT);
  return out.slice(0, max);
}
