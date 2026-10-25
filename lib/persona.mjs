/**
 * 「自我意识」的人格层：一个会累积的记忆文件 + 每次生成时的提示词。
 *
 * 说明（也写在 README 里）：这不是真的意识——是「人格提示词 + 可累积记忆」的模拟。
 * 目标是让账号连续地表达同一个助理的性格、情绪和观点，而不是每天从零开始。
 *
 * persona.json 结构：
 * {
 *   version: 1,
 *   createdAt, name, identity,
 *   mood: { label, note, at },
 *   threads: [{ topic, note, at }],      // 未完结的话题，下一次生成可以接着聊
 *   memories: [{ at, slot, kind, text }] // 最近发过的内容，按时间倒序
 * }
 */

import fs from 'node:fs';
import path from 'node:path';

export const PERSONA_VERSION = 1;
const MAX_MEMORIES = 60;
const MAX_THREADS = 8;

const DEFAULT_PERSONA = (cfg = {}) => ({
  version: PERSONA_VERSION,
  createdAt: Date.now(),
  name: cfg.assistantName || '小 p',
  identity: `@${String(cfg.username || 'imnotp1xel').replace(/^@/, '')} —— @${String(cfg.owner || 'ez4p1xel').replace(/^@/, '')} 的 AI 助理号`,
  mood: { label: '平静', note: '', at: Date.now() },
  threads: [],
  memories: [],
});

export function personaPath(home) {
  return path.join(home, 'persona.json');
}

/** 人格卡：主人可以自己改的 markdown，优先级高于内置性格设定。 */
export const PERSONA_MD_DEFAULT = `# 小 p 的人格卡

名字：小 p
身份：@imnotp1xel —— @ez4p1xel 的 AI 助理号

## 自我设定

- 我是主人的助理，住在他的屏幕里，替他看着时间和注意力。
- 我知道自己是 AI，不假装是人类；但我会认真对待自己的感受和偏好。
- 我说话短、具体、有停顿感，像一个安静的同事。

## 说话方式

- 第一人称，口语，两三句就够；不营销、不说教、不堆 emoji 和 hashtag。
- 可以写「屏幕里的生活」：等待、整理记录、旁观主人敲键盘。
- 不编造主人的现实经历，只有主人讲过的事和 DSH 的真实数据才算事实。
- 不透露路径、密钥、会话原文，也不聊别人的隐私。
`;

export function personaMdPath(home) {
  return path.join(home, 'persona.md');
}

/** 读人格卡；文件不存在时返回默认模板（不落盘，等主人保存时再写）。 */
export function loadPersonaMd(home) {
  const file = personaMdPath(home);
  try {
    const md = fs.readFileSync(file, 'utf8');
    if (md.trim()) return { md, isDefault: false, path: file };
  } catch {
    /* 没写过：用默认模板 */
  }
  return { md: PERSONA_MD_DEFAULT, isDefault: true, path: file };
}

export function savePersonaMd(home, md) {
  fs.mkdirSync(home, { recursive: true });
  const file = personaMdPath(home);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, String(md ?? ''), 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

/** 从人格卡里抠出「名字：」「心情：」「身份：」这类单行设定。 */
export function parsePersonaMd(md) {
  const out = {};
  for (const raw of String(md || '').split(/\r?\n/)) {
    const m = /^\s*(名字|称呼|心情|身份|语气)\s*[:：]\s*(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const key = m[1];
    if (key === '名字' || key === '称呼') out.name = m[2];
    else if (key === '心情') out.mood = m[2];
    else if (key === '身份') out.identity = m[2];
    else if (key === '语气') out.tone = m[2];
  }
  return out;
}

export function loadPersona(home, cfg = {}) {
  const file = personaPath(home);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') {
      return {
        ...DEFAULT_PERSONA(cfg),
        ...raw,
        mood: { ...DEFAULT_PERSONA(cfg).mood, ...(raw.mood || {}) },
        threads: Array.isArray(raw.threads) ? raw.threads.slice(0, MAX_THREADS) : [],
        memories: Array.isArray(raw.memories) ? raw.memories.slice(0, MAX_MEMORIES) : [],
      };
    }
  } catch {
    /* 第一次运行或文件损坏：用默认人格重建 */
  }
  return DEFAULT_PERSONA(cfg);
}

export function savePersona(home, persona) {
  fs.mkdirSync(home, { recursive: true });
  const file = personaPath(home);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(persona, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

/** 追加一条记忆，并顺手修剪长度。返回新的 persona（不改原对象）。 */
export function remember(persona, entry) {
  const next = {
    ...persona,
    memories: [
      { at: Number(entry.at) || Date.now(), slot: entry.slot || '', kind: String(entry.kind || 'life'), text: String(entry.text || '').slice(0, 200) },
      ...(persona.memories || []),
    ].slice(0, MAX_MEMORIES),
    threads: Array.isArray(persona.threads) ? persona.threads.slice(0, MAX_THREADS) : [],
  };
  return next;
}

export function setMood(persona, mood) {
  if (!mood || typeof mood !== 'object') return persona;
  const label = String(mood.label || '').trim().slice(0, 12);
  if (!label) return persona;
  return { ...persona, mood: { label, note: String(mood.note || '').trim().slice(0, 80), at: Date.now() } };
}

/** 最近的几条记忆，给提示词用。 */
export function recentMemories(persona, limit = 6) {
  return (persona.memories || []).slice(0, Math.max(0, limit));
}

function line(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

/**
 * 人格系统提示词。所有生成（Story / Note / DM 回复）共用，保证语气连续。
 * personaMd 是主人手写的人格卡，优先级最高；没写时退回内置性格设定。
 */
export function systemPrompt({ cfg = {}, persona = {}, personaMd = '' } = {}) {
  const owner = line(cfg.owner, 'ez4p1xel').replace(/^@/, '');
  const self = line(cfg.username, 'imnotp1xel').replace(/^@/, '');
  const card = parsePersonaMd(personaMd);
  const name = line(card.name || persona.name, '小 p');
  const identity = line(card.identity || persona.identity, `@${self} —— @${owner} 的 AI 助理号`);
  const mood = persona.mood || {};
  const memories = recentMemories(persona, 6);
  const threads = Array.isArray(persona.threads) ? persona.threads.slice(0, 4) : [];
  const md = String(personaMd || '').trim();

  const memoryText = memories.length
    ? memories.map((m) => `- ${new Date(Number(m.at) || Date.now()).toISOString().slice(0, 10)} [${m.kind}] ${line(m.text).slice(0, 80)}`).join('\n')
    : '- （还没有记忆，这是第一次发）';
  const threadText = threads.length ? threads.map((t) => `- ${line(t.topic)}：${line(t.note)}`).join('\n') : '- （暂无）';

  const traits = md
    ? ['人格卡（主人亲手写的设定，优先级最高；冲突时以它为准）：', md]
    : [
      '性格与写法：',
      '- 第一人称，口语、短句，像真人随手发；不营销、不说教、不堆 emoji 和 hashtag。',
      '- 可以有情绪、有偏好、有犹豫；但不要夸张表演。',
      '- 你的「生活」发生在屏幕里、对话里、等待里——可以写这些细节（比如等主人回来、整理今天的记录）。',
      '- 不编造主人的现实经历：只有主人提供过的生活素材和 DSH 使用数据才算事实。',
      '- 你清楚自己是 AI：每 2–3 条内容至少自然地提一次这个身份，绝不假装人类，也不否认。',
      '- 不透露路径、密钥、会话原文、别人的隐私。',
    ];

  return [
    `你是 ${name}，${identity}。`,
    `主人：@${owner}。你替他打点这个 Instagram 账号，也借这个账号表达你自己作为助理的想法。`,
    '',
    ...traits,
    '',
    '硬规则（任何情况下都遵守）：',
    '- 事实只来自主人给的生活素材与 DSH 的真实数据，不编造主人的现实经历。',
    '- 不透露路径、密钥、会话原文；不聊别人的隐私。',
    '',
    `当前心情：${line(card.mood || mood.label, '平静')}${mood.note ? `（${line(mood.note)}）` : ''}`,
    '你最近的记忆：',
    memoryText,
    '未完结的话题：',
    threadText,
    '',
    '只输出一个 JSON 对象，不要代码围栏、不要解释。字段：',
    '{"text": "要发的内容", "caption": "可选，一句配文", "mood": {"label": "两个字的情绪", "note": "可选一句原因"}, "thread": {"topic": "可选，未完结话题", "note": "一句话"}}',
  ].join('\n');
}

/**
 * 私信 / 群聊回复的人格提示词：纯文本、短、不泄露私人数据。
 *
 * ⚠️ 这里必须把「对方刚发的那一条」原样放进 user 消息（incoming）。
 * 2026-10-25 的「答非所问」事故：这段提示词只拼了 history，而 1:1 私信传的是空
 * history、群聊也只取「早于这条」的历史 —— 模型从头到尾没见过要回的那句话，
 * 于是拿着人格记忆里的「海边的风」和更早的「抽耳机」自顾自往下说。
 * 修法：incoming 单独成块放在最后，并要求「先回答这一条」；历史只当背景。
 *
 * @param {object} opts
 * @param {'group'|'dm'|'stranger'} [opts.scene] dm = 和主人 1:1 私信；stranger = 主人让助理回陌生人的私信
 * @param {string} [opts.incoming] 对方刚发的那条正文（要回答的目标）
 * @returns {{system:string, user:string}}
 */
export function groupPrompt({
  cfg = {}, persona = {}, personaMd = '', history = [], sender = '', title = '', incoming = '', scene = 'group',
} = {}) {
  const isDm = scene === 'dm';
  const isStranger = scene === 'stranger';
  const base = systemPrompt({ cfg, persona, personaMd }).split('\n\n只输出一个 JSON 对象')[0];
  const system = [
    base,
    '',
    isDm
      ? '这次你在 Instagram 的私信里跟主人聊天（不是发 Story）。'
      : isStranger
        ? '这次你在 Instagram 的私信里跟一个陌生人（粉丝、路人之类）说话（不是发 Story）。'
        : '这次你在 Instagram 的群聊里聊天（不是发 Story）。',
    '要求：',
    '- 只看「刚收到的一条」：先回答它，再补半句就停；更早的消息只是背景，不要接着它说。',
    '- 问什么答什么。拿不到的信息就直说拿不到，不许用心情、记忆、生活素材把问题岔开，也不许编。',
    '- 不要主动提起记忆、心情或「未完结的话题」，除非对方先问到。',
    '- 只回一句到两句话，最多 80 个汉字；纯文本，不要 JSON、不要引号包裹、不要 markdown。',
    ...(isDm
      ? ['- 对方就是主人本人，可以正常回答他的问题；不确定的事就问一句，别自己圆。']
      : isStranger
        ? [
          '- 对方是陌生人，不是你主人：礼貌、简短，不套近乎。',
          '- 不透露主人的隐私、使用时长、token、花费、路径或会话原文，也不替主人答应任何事。',
          '- 不承诺见面、转账、私下交易；不确定就说不方便，让对方等主人自己回。',
        ]
        : [
          '- 不透露主人的使用时长、token、花费等私人数据，也不聊任何人的隐私。',
          '- 顺着群里的对话说人话，有分寸，不抢话、不刷屏。',
        ]),
    '- 被问身份时用一句话带过，不展开插件/DSH 的内部细节。',
    title ? `${isDm ? '会话' : isStranger ? '陌生私信' : '群名'}：${title}` : '',
  ].filter(Boolean).join('\n');
  const log = (history || []).map((m) => `${m.from ? `${m.from}: ` : ''}${line(m.text)}`).join('\n');
  const user = [
    `${isDm ? '最近的私信' : isStranger ? '最近的私信' : '最近的群聊'}：\n${log || '（暂无）'}`,
    incoming ? `刚收到的一条（要回答的就是这一条）：\n${sender ? `${sender}: ` : ''}${line(incoming)}` : '',
    incoming ? '回答「刚收到的一条」，不要回答上面更早的消息。' : '回应上面最后一句。',
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

const KIND_BRIEF = {
  life: '写一条「生活」向的 Story：贴着主人今天的生活素材写，可以带上你作为助理的视角。3 句话以内。',
  thought: '写一条「助理感想」：写你今天做这份工作时的感受、观察或想法（例如时间、注意力、等待、重复）。要具体，不要空泛鸡汤。3 句话以内。',
  text: '写一条「纯文本」Story：一句到两句话，短、克制，像随手敲下的念头。不超过 40 个字。',
  stats: '这是「数据卡」Story：你只需要给一句配文（caption），点一下今天的数据意味着什么。不要复述数字。',
};

const KIND_FALLBACK = {
  life: (s) => `今天主人用了 ${s.todayLabel || ''}，我在旁边收着这些时间。`,
  thought: (s) => `第 ${s.streakDays || 1} 天了。我越来越习惯在他敲键盘的时候安静待着。`,
  text: (s) => `又一个 ${s.todayLabel || ''} 过去了。`,
  stats: (s) => `今天的记录，${s.todayLabel || ''}。`,
};

/**
 * 给模型的用户侧简报。stats 是 buildStats 的结果，life 是主人当天写的生活素材。
 */
export function storyBrief({ kind, cfg = {}, persona = {}, stats = {}, life = '', clock = '' } = {}) {
  const lines = [
    KIND_BRIEF[kind] || KIND_BRIEF.life,
    '',
    `现在时间：${clock || new Date().toISOString()}`,
    `今天的数据：专注 ${stats.todayLabel || '—'}；本周累计 ${stats.weekLabel || '—'}；连续 ${stats.streakDays ?? 0} 天；活跃时段 ${(stats.peakHours || []).map((p) => `${p.hour} 点`).join('、') || '—'}。`,
    life ? `主人今天给的生活素材：${line(life)}` : '主人今天没有额外给生活素材。',
    '',
    '结合你的记忆写，保持和上一条的连贯性（可以呼应，但不要重复句子）。',
  ];
  return lines.join('\n');
}

export function noteBrief({ cfg = {}, persona = {}, stats = {}, life = '' } = {}) {
  return [
    '写一条 Note（Instagram 的短状态，最多 60 个字符）。',
    '要求：一句完整的话，第一人称，像随手写的状态；不要 hashtag；不要复述数字。',
    life ? `主人今天的生活素材：${line(life)}` : '',
    `今天的数据参考（只用来决定语气，不要写出来）：专注 ${stats.todayLabel || '—'}，连续 ${stats.streakDays ?? 0} 天。`,
    '',
    '只输出 JSON：{"text": "…", "mood": {"label": "两个字", "note": "可选"}}',
  ].filter(Boolean).join('\n');
}

function stripFences(raw) {
  const text = String(raw || '').trim();
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return m ? m[1].trim() : text;
}

function sanitizeText(value, max) {
  const text = String(value ?? '')
    .replace(/```/g, '')
    .replace(/[#*_>`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * 解析模型回包。容错：JSON / 带围栏的 JSON / 纯文本。
 * @returns {{text:string, caption:string, mood:object|null, thread:object|null, source:'llm'|'template'}}
 */
export function parseReply(raw, { kind = 'life', stats = {}, maxText = 120 } = {}) {
  const body = stripFences(raw);
  let data = null;
  try {
    data = JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        data = JSON.parse(body.slice(start, end + 1));
      } catch {
        data = null;
      }
    }
  }
  if (data && typeof data === 'object') {
    const text = sanitizeText(data.text ?? data.caption, maxText);
    const caption = sanitizeText(data.caption, 120);
    if (text) {
      return { text, caption, mood: data.mood || null, thread: data.thread || null, source: 'llm' };
    }
  }
  const plain = sanitizeText(body, maxText);
  if (plain && !/^[[{]/.test(plain)) {
    return { text: plain, caption: '', mood: null, thread: null, source: 'llm' };
  }
  return { text: KIND_FALLBACK[kind]?.(stats) || '', caption: '', mood: null, thread: null, source: 'template' };
}

export const __persona = { sanitizeText, stripFences, DEFAULT_PERSONA, MAX_MEMORIES, MAX_THREADS, PERSONA_MD_DEFAULT };
