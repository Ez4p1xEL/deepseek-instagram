/**
 * 主人的自然语言指令 → 固定动作清单。
 *
 * 安全模型（2026-10-25 需求）：
 *  - 关键词快路径不经过模型，「回未读私信」这类直白说法一定认得出；
 *  - 模型只负责把「听懂的那句话」映射成清单里的一个动作，**只能从清单里选**，
 *    输出格式固定为 {"action","args"}，在这里做严格校验和截断；
 *  - 拆不开、清单外、参数缺失 → 一律返回 null，调用方退回闲聊，绝不「猜着执行」。
 *  - 有副作用（对外发消息 / 在本机跑东西）的动作标 dangerous，必须主人回「发」才执行。
 */
import { normalizeCommand, parseCommand } from './commands.mjs';

/** 动作清单：label/brief 会原样出现在意图识别的提示词里。 */
export const ACTIONS = Object.freeze({
  status: { label: '看状态', brief: '今天发了多少、还剩多少、专注多久', dangerous: false },
  log: { label: '看运行日志', brief: '最近的运行记录', dangerous: false },
  pause: { label: '暂停', brief: '停止按计划发 Story / Note', dangerous: false },
  resume: { label: '恢复', brief: '恢复按计划发帖', dangerous: false },
  story: { label: '发一条 Story', brief: '立刻发一条 Story', dangerous: false },
  note: { label: '发一条 Note', brief: '发一条 Note', dangerous: false },
  draft: { label: '切草稿模式', brief: '先写好、等主人确认再发', dangerous: false },
  auto: { label: '切全自动', brief: '到点自己发', dangerous: false },
  help: { label: '帮助', brief: '列出可用指令', dangerous: false },
  reply_unread: { label: '回复未读私信', brief: '给没回过的私信各写一条回复（最多 5 条）', dangerous: true, args: ['limit'] },
  dsh_task: { label: '让本机 DSH 干活', brief: '在这台电脑上跑 dsh headless "<任务>"', dangerous: true, args: ['task'] },
  run_command: { label: '在本机执行命令', brief: '在这台电脑上跑一条命令', dangerous: true, args: ['command'] },
});

export const REPLY_LIMIT_DEFAULT = 3;
export const REPLY_LIMIT_MAX = 5;
export const ARG_MAX = 500;

const YES_WORDS = new Set([
  '发', '发送', '发吧', '发出去', '确认', '确定', '可以', '好', '好的', '行', 'ok', 'okay', 'go', 'yes', 'y', '是', '执行',
]);
const NO_WORDS = new Set([
  '取消', '算了', '别发', '不要', '不用', '不发', '停', '停止', 'no', 'n', 'cancel', '不了',
]);

function stripFences(raw) {
  const text = String(raw || '').trim();
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return m ? m[1].trim() : text;
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function argText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.slice(0, ARG_MAX);
}

/**
 * 关键词快路径：先走原有的窄指令，再认几条新的自然语言说法。
 * @returns {{action:string, args:object, via:'keyword'}|null}
 */
export function keywordAction(text) {
  const { cmd } = parseCommand(text);
  if (cmd !== 'unknown') return { action: cmd, args: {}, via: 'keyword' };
  const n = normalizeCommand(text);
  if (!n) return null;
  // 「回复一下你未读的私信内容」「未读消息处理一下」
  if (/未读/.test(n) && /(私信|消息|dm)/.test(n)) {
    return { action: 'reply_unread', args: { limit: REPLY_LIMIT_DEFAULT }, via: 'keyword' };
  }
  // 「回私信」「处理一下私信」「回复消息」
  if (/^(回复|回|处理|清)(一下|下)?(未读)?(私信|消息|dm)$/.test(n)) {
    return { action: 'reply_unread', args: { limit: REPLY_LIMIT_DEFAULT }, via: 'keyword' };
  }
  return null;
}

/** 意图识别的提示词：固定清单 + 固定 JSON 契约。 */
export function intentPrompt({ text = '' } = {}) {
  const lines = [
    '主人会在私信里让你做一件事。把这句话翻译成下面清单里的**一个**动作。',
    '可用动作：',
    ...Object.entries(ACTIONS).map(([name, spec]) => {
      const args = spec.args?.length ? `，参数 ${spec.args.join(' / ')}` : '';
      return `- ${name}：${spec.label}${spec.brief ? `（${spec.brief}）` : ''}${args}`;
    }),
    '',
    '只输出一个 JSON 对象：{"action":"动作名","args":{...}}。',
    '如果主人只是在聊天、或者没有明确让你做事，输出 {"action":"none"}。',
    '不要发明动作名，不要输出清单以外的动作。',
    '',
    `主人的原话：${String(text || '').slice(0, 500)}`,
  ];
  return {
    system: '你把主人的一句话解析成一个 JSON 动作。只输出 JSON 对象，不要解释、不要代码围栏。',
    user: lines.join('\n'),
  };
}

/**
 * 解析模型给的意图。严格到「宁可当没说」：
 *  - 坏 JSON、清单外的动作、缺必填参数 → null
 *  - limit 夹到 1..5；task/command 截到 500 字
 * @returns {{action:string, args:object, via:'llm'}|null}
 */
export function parseIntent(raw) {
  const body = stripFences(raw);
  let data = null;
  try {
    data = JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { data = JSON.parse(body.slice(start, end + 1)); } catch { data = null; }
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const action = String(data.action || '').trim();
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) return null;
  const spec = ACTIONS[action];
  const rawArgs = data.args && typeof data.args === 'object' ? data.args : {};
  const args = {};
  if (spec.args?.includes('limit')) {
    args.limit = clampInt(rawArgs.limit, 1, REPLY_LIMIT_MAX, REPLY_LIMIT_DEFAULT);
  }
  if (spec.args?.includes('task')) {
    const task = argText(rawArgs.task ?? rawArgs.command);
    if (!task) return null;
    args.task = task;
  }
  if (spec.args?.includes('command')) {
    const command = argText(rawArgs.command ?? rawArgs.task);
    if (!command) return null;
    args.command = command;
  }
  return { action, args, via: 'llm' };
}

/** 主人回的这一句是不是「发」。 */
export function confirmWord(text) {
  return YES_WORDS.has(normalizeCommand(text));
}

/** 主人回的这一句是不是「算了」。 */
export function cancelWord(text) {
  return NO_WORDS.has(normalizeCommand(text));
}

/** 这个动作有没有副作用（对外发消息 / 在本机跑东西）。 */
export function needsConfirm(action) {
  return Boolean(ACTIONS[String(action || '')]?.dangerous);
}

export const __actions = { YES_WORDS, NO_WORDS, stripFences, clampInt };
