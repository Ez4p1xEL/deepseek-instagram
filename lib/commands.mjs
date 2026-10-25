/**
 * 主人私信指令：解析 + 发送者校验。
 *
 * 设计原则（README「谁在管这个助理」）：
 * - 只认 @ez4p1xel 的私信；校验依据是 IG 消息里的发送者 user id（ownerPk），不是昵称、不是文本自称。
 * - 解析是纯函数，任何不认识的话都返回 unknown，绝不猜测。
 * - 指令故意做得很窄：状态 / 暂停 / 恢复 / 发一条 Story / 发 Note / 切模式 / 帮助。
 */

const COMMANDS = [
  {
    cmd: 'status',
    re: /^(状态|status|情况|怎么样了?|最近怎么样|最近怎样|在干嘛|在干什么|忙什么|忙什么呢)$/,
  },
  { cmd: 'log', re: /^(日志|运行日志|最近日志|最近的运行日志|查看日志|查看最近运行日志|查看你最近的运行日志|日志呢)$/ },
  { cmd: 'pause', re: /^(暂停|停|别发了?|pause|stop)$/ },
  { cmd: 'resume', re: /^(恢复|继续|开工|resume|start)$/ },
  { cmd: 'story', re: /^(发一条|来一条|发个?story|story|发个?故事)$/ },
  { cmd: 'note', re: /^(发个?note|note|发个?状态)$/ },
  { cmd: 'draft', re: /^(草稿|draft)$/ },
  { cmd: 'auto', re: /^(自动|全自动|auto)$/ },
  { cmd: 'help', re: /^(帮助|help|\?|？|能做什么)$/ },
];

/** 归一化：去空白、去 emoji/标点、统一小写。 */
export function normalizeCommand(text) {
  return String(text || '')
    .replace(/^\s*@[\w.]+/, '')            // 群里/私信里 @ 助理时，先去掉开头的 @
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[，。！？、,.!?;:：；"'“”‘’()（）\[\]【】]/g, ' ')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

/**
 * @param {string} text 私信正文
 * @returns {{cmd:string, raw:string}} cmd 为 unknown 表示不认识
 */
export function parseCommand(text) {
  const normalized = normalizeCommand(text);
  if (!normalized) return { cmd: 'unknown', raw: String(text || '') };
  for (const { cmd, re } of COMMANDS) {
    if (re.test(normalized)) return { cmd, raw: String(text || '') };
  }
  return { cmd: 'unknown', raw: String(text || '') };
}

/** 发送者是不是主人：只比 user id，绝不比昵称/文本。 */
export function isOwnerSender({ userId, ownerPk } = {}) {
  const a = String(userId ?? '').trim();
  const b = String(ownerPk ?? '').trim();
  return Boolean(a) && a === b;
}

/**
 * 把一条私信变成「可执行/不可执行」的判定结果，Host 只按结果执行，不自己解释文本。
 * @param {{id?:string|number, userId?:string|number, text?:string, timestamp?:number}} message
 * @param {{ownerPk?:string|number, lastHandledId?:string|number}} state
 */
export function decideMessage(message, state = {}) {
  const id = String(message?.id ?? '');
  const lastHandledId = String(state.lastHandledId ?? '');
  if (!id) return { execute: false, reason: 'no-id' };
  if (lastHandledId && id === lastHandledId) return { execute: false, reason: 'already-handled' };
  if (!isOwnerSender({ userId: message?.userId, ownerPk: state.ownerPk })) {
    return { execute: false, reason: 'not-owner', id };
  }
  const { cmd } = parseCommand(message?.text);
  if (cmd === 'unknown') return { execute: false, reason: 'unknown-command', id };
  return { execute: true, cmd, id, text: String(message?.text || '') };
}

/**
 * 群聊该不该回：纯决策，方便单测。
 * 只有「主人在的群」+「被 @ 或叫名字（mention 模式）」+ 过了冷却/每小时上限才回。
 * @returns {{reply:boolean, reason:string}}
 */
export function groupDecision({
  cfg = {}, threadRow = null, message = {}, state = {}, now = Date.now(), hourKey = '',
} = {}) {
  const group = { enabled: true, mode: 'mention', onlyOwnerGroups: true, cooldownSeconds: 90, hourlyCap: 8, ...(cfg.group || {}) };
  if (group.enabled === false) return { reply: false, reason: 'group-disabled' };
  if (!message.isGroup) return { reply: false, reason: 'not-group' };
  const ownerPk = String(cfg.ownerPk || '');
  const members = (threadRow?.memberPks || []).map(String);
  if (group.onlyOwnerGroups !== false && (!ownerPk || !members.includes(ownerPk))) {
    return { reply: false, reason: 'owner-not-in-group' };
  }
  const text = String(message.text || '');
  const assistant = String(cfg.username || '').replace(/^@/, '').toLowerCase();
  const name = String(cfg.personaName || '小 p');
  const called = (assistant && text.toLowerCase().includes('@' + assistant))
    || text.includes(name) || text.includes('小p');
  if (group.mode === 'mention' && !called) return { reply: false, reason: 'not-mentioned' };
  const threadId = String(message.threadId || '');
  if (now - Number(state.groupLast?.[threadId] || 0) < Number(group.cooldownSeconds || 90) * 1000) {
    return { reply: false, reason: 'group-cooldown' };
  }
  const bucketCount = state.groupHour && state.groupHour.key === hourKey ? Number(state.groupHour.count || 0) : 0;
  if (bucketCount >= Number(group.hourlyCap || 8)) return { reply: false, reason: 'group-hourly-cap' };
  return { reply: true, reason: 'ok' };
}

export const HELP_TEXT = [
  '主人，我是你的助理号。能做的事：',
  '状态 / 暂停 / 恢复 / 发一条 / 发note / 草稿 / 自动 / 帮助',
  '也可以直接说人话：回未读私信 / 让本机 DSH 干活 / 在本机执行命令。',
  '会对外发消息或在本机跑东西的，我先把草稿给你，你回「发」我才做，回「取消」就算了。',
].join('\n');

export const __commands = { COMMANDS, groupDecision };
