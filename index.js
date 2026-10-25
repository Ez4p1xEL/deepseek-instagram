/**
 * deepseek-instagram —— Host 半端
 *
 * 把 DSH 的使用数据（时长 / 活跃时段 / 连续天数 / token / 花费）变成 Instagram 的
 * Story 卡片与 Note 文案，通过 instagrapi 发出去；默认「草稿确认」，可在设置页切全自动。
 *
 * 设计约束（见 docs/research/dsh-plugin-guide.md）：
 *  - 不 import 任何 @deepseek-ai/*（桌面版 autoInstallPeers=false，裸 import 会让整条插件静默不激活）
 *  - Host ↔ Client 只走 ctx.webServer 注册的 HTTP 路由 + 前端 fetch
 *  - 定时器回调整体 try/catch（抛出去会拖垮 Host 进程）
 *  - 家目录 = $DSH_HOME/instagram-assistant
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, statSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import zlib from 'node:zlib';
import { buildStats, listSessionFiles, decompressSession, parseSessionText } from './lib/dshusage.mjs';
import {
  buildStoryCard, buildStoryPrompt, buildNotePrompt,
  defaultNote, defaultStoryCaption, clampText, formatMinutes, formatTokens, NOTE_MAX,
} from './lib/content.mjs';
import { evaluatePublish, DEFAULT_SAFETY } from './lib/safety.mjs';
import { dayKey, DEFAULT_TIME_ZONE } from './lib/usage.mjs';
import { dayPlan, kindQuota, clockOf, KINDS as PLAN_KINDS, KIND_LABELS } from './lib/plan.mjs';
import {
  loadPersona, savePersona, remember, setMood, recentMemories,
  loadPersonaMd, savePersonaMd, personaMdPath, groupPrompt,
  systemPrompt, storyBrief, noteBrief, parseReply,
} from './lib/persona.mjs';
import { decideMessage, groupDecision, isOwnerSender, parseCommand, HELP_TEXT } from './lib/commands.mjs';
import { keywordAction, parseIntent, intentPrompt, confirmWord, cancelWord, needsConfirm } from './lib/actions.mjs';
import { pickUnreadDm } from './lib/unread.mjs';
import { singleFlight } from './lib/singleflight.mjs';
import { costCny } from './lib/pricing.mjs';
import { spendPath, addCall, summarizeSpend, loadSpendFile, saveSpendFile } from './lib/spend.mjs';
import {
  normalizeAutoReply, autoReplyAllowed, shouldNotifyOwner, markNotified,
  remoteControlAllowed, publishAllowed,
} from './lib/features.mjs';

export const name = 'deepseek-instagram';
export const inject = ['webServer', 'tools'];

const ROOT = dirname(fileURLToPath(import.meta.url));
// 徽标：`/state` 里能看到，用来确认「跑的是哪一版代码」。
// ESM 在同一个 Host 进程里会缓存模块，改完文件**必须重启 DSH** 才会重载；
// 2026-10-25 就在这上面栽过一次（改了 index.js 但进程跑的还是旧模块）。
const BUILD = '2026-10-26.6';
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const HOME = join(DSH_HOME, 'instagram-assistant');
const ROUTE = '/api/deepseek-instagram';
const VENDOR = join(ROOT, 'vendor', 'instagram-mcp');
const IG_CLI = join(VENDOR, 'ig_cli.py');
const RENDER = join(VENDOR, 'render_card.py');

const CFG_FILE = join(HOME, 'config.json');
const POSTS_FILE = join(HOME, 'posts.json');
const ACCOUNT_FILE = join(HOME, 'account.json');
const LOG_FILE = join(HOME, 'log.txt');
const INSTALL_LOG = join(HOME, 'install.log');
const DRAFTS_DIR = join(HOME, 'drafts');
const OUT_DIR = join(HOME, 'out');
const DM_FILE = join(HOME, 'dm-state.json');

const DEFAULTS = {
  enabled: true,
  // draft = 只生成预览、等人确认；auto = 到点自己发。自主任务默认全自动。
  mode: 'auto',
  username: '',
  owner: '',
  ownerPk: '',
  handle: '',
  timeZone: DEFAULT_TIME_ZONE,
  personaName: '小 p',
  noteTime: '12:30',
  storiesPerDay: 10,            // 每天最多 10 条 Story（含数据卡 / 感想 / 纯文本 / 生活）
  dayStart: '08:30',            // 计划窗口：第一条不早于这个点
  dayEnd: '23:00',              // 最后一条不晚于这个点
  tone: '轻松、像本人随手发',
  lifeNote: '',
  useLlm: true,
  pythonPath: '',
  dm: { enabled: true, reply: true, dailyReplies: 30, history: 6, intents: true, autoReply: 'off', notifyOwner: true },
  // 群聊：默认「被 @ 或叫名字才回」，且只处理主人在的群
  group: { enabled: true, mode: 'mention', onlyOwnerGroups: true, cooldownSeconds: 90, hourlyCap: 8, history: 6 },
  // 设置页「功能开关」：只拦自动调度；手动发布与私信「发一条」仍然可用
  publish: { story: true, note: true },
  // 每条 Story 都 @ 主人：贴纸位置用比例（0-1），由 instagrapi 的 StoryMention 渲染
  storyMention: { enabled: true, x: 0.5, y: 0.86, width: 0.5, height: 0.09 },
  safety: { ...DEFAULT_SAFETY },
};

// ── tiny fs / config helpers ───────────────────────────────────────────────

const ensureDir = (dir) => { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); };
const ensureHome = () => { ensureDir(HOME); ensureDir(DRAFTS_DIR); ensureDir(OUT_DIR); };

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, file);
}

function normalizeCfg(raw) {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = raw?.[key];
    const fallback = DEFAULTS[key];
    if (value === undefined || value === null) continue;
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
      // 只认识已知字段，且类型必须一致：前端传错类型不会把配置写坏。
      const nested = { ...fallback };
      for (const inner of Object.keys(fallback)) {
        const next = value?.[inner];
        if (next !== undefined && next !== null && typeof next === typeof fallback[inner]) nested[inner] = next;
      }
      out[key] = nested;
      continue;
    }
    if (typeof value === typeof fallback) out[key] = value;
  }
  return out;
}

function loadCfg() { ensureHome(); return normalizeCfg(readJson(CFG_FILE, {})); }

function saveCfg(patch) {
  ensureHome();
  const current = loadCfg();
  // 嵌套字段（safety / dm）按对象合并，其余用 patch 覆盖。
  const merged = { ...current, ...(patch || {}) };
  for (const key of ['safety', 'dm', 'publish']) {
    if (patch && typeof patch[key] === 'object' && patch[key] !== null) merged[key] = { ...current[key], ...patch[key] };
  }
  const next = normalizeCfg(merged);
  writeJson(CFG_FILE, next);
  return next;
}

function postHistory() {
  const raw = readJson(POSTS_FILE, { items: [] });
  return Array.isArray(raw?.items) ? raw.items : [];
}

function recordPost(entry) {
  ensureHome();
  const items = postHistory();
  items.push({ ...entry, at: entry.at || Date.now(), day: entry.day || dayKey(entry.at || Date.now(), loadCfg().timeZone) });
  writeJson(POSTS_FILE, { items: items.slice(-400) });
}

function log(message) {
  ensureHome();
  const line = `${new Date().toISOString()} ${message}\n`;
  try { appendFileSync(LOG_FILE, line, 'utf8'); } catch { /* logging must never break the flow */ }
  try { ctxRef?.logger?.info?.(`[deepseek-instagram] ${message}`); } catch { /* noop */ }
}

function logTail(limit = 120) {
  try {
    const text = readFileSync(LOG_FILE, 'utf8');
    return text.split('\n').filter(Boolean).slice(-limit).join('\n');
  } catch { return ''; }
}

function installTail(limit = 60) {
  try {
    const text = readFileSync(INSTALL_LOG, 'utf8');
    return text.split('\n').filter(Boolean).slice(-limit).join('\n');
  } catch { return ''; }
}

// `ctx` is needed by log(); keep one module-level reference (single plugin instance per host).
let ctxRef = null;

// Cordis 有时会对同一模块连调两次 apply()（观察到的日志是同一毫秒两行「已激活」）。
// 激活日志只写一次，避免日志噪音；真正的重复注册由 ctx.effect 自己清理。
let activationLogged = false;

// ── local time helpers ─────────────────────────────────────────────────────

function localParts(now, timeZone) {
  const out = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (const part of fmt.formatToParts(new Date(now))) out[part.type] = part.value;
  return out;
}

function localMinutes(now, timeZone) {
  const p = localParts(now, timeZone);
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

function parseHhMm(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

// ── python bridge ──────────────────────────────────────────────────────────

function resolvePython(cfg = loadCfg()) {
  if (cfg.pythonPath && existsSync(cfg.pythonPath)) return cfg.pythonPath;
  const win = join(HOME, '.venv', 'Scripts', 'python.exe');
  if (existsSync(win)) return win;
  const posix = join(HOME, '.venv', 'bin', 'python');
  if (existsSync(posix)) return posix;
  return '';
}

/** Run a python helper, feed JSON on stdin, parse the single JSON object on stdout. */
function runPy(python, script, args, payload, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(python, [script, ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, code: 'spawn-failed', error: String(error?.message || error) });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      resolve({ ok: false, code: 'timeout', error: `python 超时（${timeoutMs}ms）` });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: 'spawn-failed', error: String(error?.message || error) });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const line = stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop();
      if (!line) {
        resolve({ ok: false, code: 'no-output', error: (stderr || stdout || 'python 没有输出').slice(-800) });
        return;
      }
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ ok: false, code: 'bad-output', error: line.slice(-800) + (stderr ? `\n${stderr.slice(-400)}` : '') });
      }
    });
    try {
      child.stdin.end(JSON.stringify(payload || {}));
    } catch {
      /* child died before we could write; the close handler reports it */
    }
  });
}

async function igCall(command, payload, options) {
  const cfg = loadCfg();
  const python = resolvePython(cfg);
  if (!python) return { ok: false, code: 'no-python', error: '还没装运行环境：请在设置页点「安装依赖」' };
  return runPy(python, IG_CLI, [command], payload, options);
}

async function renderCard(spec, outPath) {
  const cfg = loadCfg();
  const python = resolvePython(cfg);
  if (!python) return { ok: false, code: 'no-python', error: '还没装运行环境：请在设置页点「安装依赖」' };
  return runPy(python, RENDER, [], { spec, out: outPath }, { timeoutMs: 60_000 });
}

// ── deps install ───────────────────────────────────────────────────────────

const installState = { running: false, startedAt: 0, finishedAt: 0, ok: null, message: '' };

function appendInstallLog(text) {
  ensureHome();
  try { appendFileSync(INSTALL_LOG, text.endsWith('\n') ? text : `${text}\n`, 'utf8'); } catch { /* noop */ }
}

function spawnLogged(command, args, label) {
  return new Promise((resolve) => {
    appendInstallLog(`\n$ ${command} ${args.join(' ')}`);
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      appendInstallLog(`[${label}] spawn failed: ${error?.message || error}`);
      resolve({ ok: false, error: String(error?.message || error) });
      return;
    }
    const onData = (chunk) => appendInstallLog(chunk.toString('utf8').trimEnd());
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (error) => { appendInstallLog(`[${label}] ${error?.message || error}`); resolve({ ok: false, error: String(error?.message || error) }); });
    child.on('close', (code) => {
      appendInstallLog(`[${label}] exit ${code}`);
      resolve({ ok: code === 0, code });
    });
  });
}

async function installDeps() {
  if (installState.running) return { ok: false, error: '正在安装中' };
  installState.running = true;
  installState.startedAt = Date.now();
  installState.ok = null;
  installState.message = '准备中';
  try {
    ensureHome();
    writeFileSync(INSTALL_LOG, `# deepseek-instagram 依赖安装 ${new Date().toISOString()}\n`, 'utf8');
    const venvDir = join(HOME, '.venv');
    const candidates = [process.env.DSH_INSTAGRAM_PYTHON, 'python', 'python3'].filter(Boolean);
    let base = '';
    for (const candidate of candidates) {
      const probe = await spawnLogged(candidate, ['-c', 'import sys; print(sys.version)'], `probe ${candidate}`);
      if (probe.ok) { base = candidate; break; }
    }
    if (!base) {
      installState.ok = false;
      installState.message = '找不到 python：请装 Python 3.11+，或在设置里填 pythonPath';
      return { ok: false, error: installState.message };
    }
    installState.message = '创建 venv';
    let created = await spawnLogged(base, ['-m', 'venv', venvDir], 'venv');
    let python = resolvePython({ ...DEFAULTS, pythonPath: '' });
    if (!created.ok || !python) {
      installState.message = '创建 venv（无 pip 模式）';
      await spawnLogged(base, ['-m', 'venv', '--without-pip', venvDir], 'venv-nopip');
      python = resolvePython({ ...DEFAULTS, pythonPath: '' });
      if (!python) {
        installState.ok = false;
        installState.message = 'venv 创建失败，见安装日志';
        return { ok: false, error: installState.message };
      }
      installState.message = '引导 pip';
      const bootstrap = await spawnLogged(python, ['-m', 'ensurepip', '--upgrade'], 'ensurepip');
      if (!bootstrap.ok) {
        installState.ok = false;
        installState.message = 'ensurepip 失败，见安装日志';
        return { ok: false, error: installState.message };
      }
    }
    installState.message = '安装 instagrapi + pillow（可能要几分钟）';
    const pipArgs = (index) => ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off',
      '--timeout', '30', '--retries', '2', ...(index ? ['-i', index] : []), 'instagrapi', 'pillow'];
    let pip = await spawnLogged(python, pipArgs(''), 'pip');
    if (!pip.ok) {
      // pypi.org 在部分网络下会卡在下载阶段；用 HTTPS 镜像再试一次（清华源，国内可用）。
      installState.message = '默认源失败，改用镜像重试';
      log('pip 默认源失败，改用清华镜像重试');
      pip = await spawnLogged(python, pipArgs('https://pypi.tuna.tsinghua.edu.cn/simple'), 'pip-mirror');
    }
    if (!pip.ok) {
      installState.ok = false;
      installState.message = 'pip install 失败，见安装日志';
      return { ok: false, error: installState.message };
    }
    installState.message = '检查环境';
    const doctor = await runPy(python, IG_CLI, ['doctor'], {}, { timeoutMs: 60_000 });
    installState.ok = !!doctor.ok;
    installState.message = doctor.ok ? `就绪：instagrapi ${doctor.instagrapi || '?'} / pillow ${doctor.pillow || '?'}` : `检查失败：${doctor.error || '未知错误'}`;
    log(`依赖安装完成：${installState.message}`);
    return { ok: installState.ok, doctor };
  } catch (error) {
    installState.ok = false;
    installState.message = `安装异常：${error?.message || error}`;
    return { ok: false, error: installState.message };
  } finally {
    installState.running = false;
    installState.finishedAt = Date.now();
  }
}

// ── 助理用量：每次模型调用的 token 与花费（设置页「AI 助理用量」卡片） ──────

const SPEND_FILE = spendPath(DSH_HOME);
let spendWriteChain = Promise.resolve();

/** 记一次模型调用：异步串行落盘，失败只写日志，绝不影响回复。 */
function recordSpend({ kind = 'other', model = '', usage = null, ts = Date.now() } = {}) {
  try {
    const input = Number(usage?.inputTokens) || 0;
    const cache = Number(usage?.cacheReadTokens) || 0;
    const output = Number(usage?.outputTokens) || 0;
    const tokens = input + cache + output;
    const cost = costCny({ model, inputTokens: input, cacheReadTokens: cache, outputTokens: output, ts });
    const call = { ts, kind, model, input, cache, output, tokens, cost };
    spendWriteChain = spendWriteChain
      .then(() => saveSpendFile(SPEND_FILE, addCall(loadSpendFile(SPEND_FILE), call)))
      .catch((error) => log(`用量记账失败：${error?.message || error}`));
  } catch (error) {
    log(`用量记账失败：${error?.message || error}`);
  }
}

/** 汇总给设置页：今日 / 近 7 天 / 逐日 / 最近几次调用。 */
function assistantSpend() {
  const cfg = loadCfg();
  return summarizeSpend(loadSpendFile(SPEND_FILE), { now: Date.now(), timeZone: cfg.timeZone || DEFAULT_TIME_ZONE });
}

// ── content: LLM with template fallback ────────────────────────────────────

async function askOnce(prompt, { signal, kind = 'other' } = {}) {
  // ctx.get('llm') 在刚 reload 的瞬间可能还没就绪，重试一次再降级
  try {
    return await askOnceRaw(prompt, { signal, kind });
  } catch (error) {
    if (signal?.aborted) throw error;
    await new Promise((resolve) => setTimeout(resolve, 800));
    return askOnceRaw(prompt, { signal, kind });
  }
}

async function askOnceRaw(prompt, { signal, kind = 'other' } = {}) {
  const ctx = ctxRef;
  const llm = ctx?.get?.('llm');
  const sel = ctx?.get?.('agentDefaultModel')?.currentSelection?.() ?? {};
  const options = {
    provider: sel.provider || 'deepseek-account',
    model: sel.model || 'deepseek-flash',
    ...(sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}),
    system: prompt.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
    ...(signal ? { signal } : {}),
  };
  // 优先直接 stream：prepareCall 的 config 快照与 stream 参数不一致时，
  // 宿主会抛 `prepared LLM call config changed before adapter dispatch`（2026-10-25 实测踩过）。
  let stream;
  if (typeof llm?.stream === 'function') stream = llm.stream(options);
  else if (typeof llm?.prepareCall === 'function') {
    const call = await llm.prepareCall(options, signal);
    stream = call.stream(options);
  } else throw new Error('没有可用的 LLM 服务');
  let text = '';
  let usage = null;
  try {
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text;
      else if (chunk.type === 'usage' && chunk.usage) usage = chunk.usage;
      else if (chunk.type === 'finish' && chunk.reason?.kind !== 'stop') throw new Error(`模型没正常结束：${chunk.reason?.kind}`);
    }
    // 有的 adapter 只在流结束后暴露 usage；拿不到就按 0 记（不伪造）。
    try { usage = usage || stream.usage || null; } catch { /* 没有就没有 */ }
  } finally {
    recordSpend({ kind, model: options.model, usage });
  }
  return text.trim();
}

function cleanModelText(text, kind) {
  let out = String(text || '').trim();
  out = out.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim();
  if (kind === 'note') {
    out = out.split('\n')[0].trim();
    return clampText(out, NOTE_MAX);
  }
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
  return clampText(lines.join('\n'), 240);
}

/** Build the caption/note, degrading to a deterministic template when the model fails. */
async function compose(kind, stats, cfg, signal) {
  const fallback = () => (kind === 'note'
    ? defaultNote({ ...stats }, { lifeNote: cfg.lifeNote })
    : defaultStoryCaption({ ...stats }, { lifeNote: cfg.lifeNote }));
  if (!cfg.useLlm) return { text: fallback(), source: 'template' };
  try {
    const prompt = kind === 'note' ? buildNotePrompt(stats, cfg) : buildStoryPrompt(stats, cfg);
    const text = cleanModelText(await askOnce(prompt, { signal, kind }), kind);
    if (!text) throw new Error('模型返回空文本');
    return { text, source: 'llm' };
  } catch (error) {
    log(`LLM 文案失败，用模板兜底：${error?.message || error}`);
    return { text: fallback(), source: 'template' };
  }
}

// ── draft & publish ────────────────────────────────────────────────────────

const usageCache = new Map();

function draftPath(day) { return join(DRAFTS_DIR, `${day}.json`); }

function loadDraft(day) { return readJson(draftPath(day), null); }

function statsFor(cfg) {
  return buildStats({ home: DSH_HOME, now: Date.now(), timeZone: cfg.timeZone, cache: usageCache });
}

// ── 人格与计划：把「自主发帖」拆成可测的小步 ──────────────────────────────

function personaNow(cfg) { return loadPersona(HOME, cfg); }

/** persona.md：人格卡的唯一事实来源（LLM 的 system prompt 前半段就是它）。 */
function personaMdNow() { return loadPersonaMd(HOME).md; }

/** 每条 Story 都要 @ 主人：把设置里的比例翻成 ig_cli 的 mention 参数。 */
function mentionPayload(cfg) {
  const m = cfg.storyMention || {};
  if (m.enabled === false) return {};
  const owner = String(cfg.owner || cfg.handle || '').replace(/^@/, '').trim();
  if (!owner) return {};
  const nums = ['x', 'y', 'width', 'height'].map((key) => Number(m[key]));
  const [x, y, width, height] = nums;
  const valid = nums.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) && width > 0.02 && height > 0.02;
  return {
    mentionHandle: owner,
    ownerPk: String(cfg.ownerPk || ''),
    mentionX: valid ? x : 0.5,
    mentionY: valid ? y : 0.86,
    mentionWidth: valid ? width : 0.5,
    mentionHeight: valid ? height : 0.09,
  };
}

function savePersonaPatch(patch = {}) {
  const cfg = loadCfg();
  const persona = personaNow(cfg);
  const next = {
    ...persona,
    ...(patch.name ? { name: String(patch.name).slice(0, 20) } : {}),
    ...(patch.identity ? { identity: String(patch.identity).slice(0, 120) } : {}),
  };
  if (patch.mood) Object.assign(next, setMood(persona, patch.mood));
  savePersona(HOME, next);
  return next;
}

/** 发出去的内容进记忆：下一次生成能接上，像同一个人连续在写。 */
function rememberContent({ slot, kind, text, mood, thread }) {
  const cfg = loadCfg();
  let persona = personaNow(cfg);
  persona = remember(persona, { at: Date.now(), slot, kind, text });
  if (mood) persona = setMood(persona, mood);
  if (thread?.topic) {
    const item = { topic: String(thread.topic).slice(0, 40), note: String(thread.note || '').slice(0, 80), at: Date.now() };
    persona = { ...persona, threads: [item, ...(persona.threads || [])].slice(0, 8) };
  }
  savePersona(HOME, persona);
  return persona;
}

function planFor(cfg, day = dayKey(Date.now(), cfg.timeZone)) {
  return dayPlan({
    day,
    count: cfg.storiesPerDay,
    start: cfg.dayStart,
    end: cfg.dayEnd,
    // 比安全阀的最小间隔多留 5 分钟：发布常有几秒延迟，卡在边界上会互相顶掉
    minGapMinutes: (Number(cfg.safety?.minIntervalMinutes) || 30) + 5,
    timeZone: cfg.timeZone,
  });
}

function slotHistory(day) { return postHistory().filter((h) => h.day === day && h.slot); }

function slotDone(day, slot) {
  return slotHistory(day).some((h) => h.slot === slot && h.status === 'published');
}

function planStatus(cfg) {
  const day = dayKey(Date.now(), cfg.timeZone);
  const plan = planFor(cfg, day);
  const done = new Set(slotHistory(day).filter((h) => h.status === 'published').map((h) => h.slot));
  const failed = new Map(slotHistory(day).filter((h) => h.status === 'failed').map((h) => [h.slot, h]));
  return {
    day,
    count: plan.count,
    window: { start: cfg.dayStart, end: cfg.dayEnd },
    published: done.size,
    remaining: Math.max(0, plan.count - done.size),
    slots: plan.slots.map((item) => ({
      slot: item.slot,
      index: item.index,
      at: item.at,
      clock: clockOf(item.at, cfg.timeZone),
      kind: item.kind,
      kindLabel: KIND_LABELS[item.kind] || item.kind,
      status: done.has(item.slot) ? 'published'
        : failed.has(item.slot) ? 'failed'
          : Date.now() >= item.at + SLOT_GRACE_MS ? 'missed'
            : Date.now() >= item.at ? 'due' : 'planned',
      error: failed.get(item.slot)?.error || '',
    })),
  };
}

const statsLabels = (stats) => ({
  ...stats,
  todayLabel: formatMinutes(stats.todayMinutes || 0),
  weekLabel: formatMinutes(stats.weekMinutes || 0),
});

const STORY_KICKER = { stats: 'DSH DAILY', thought: 'THOUGHT', text: 'NOTE', life: 'TODAY' };

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function composeStory(kind, stats, persona, cfg, signal) {
  const s = statsLabels(stats);
  const fallback = kind === 'stats'
    ? defaultStoryCaption({ ...s }, { lifeNote: cfg.lifeNote })
    : kind === 'text' ? `第 ${s.streakDays || 1} 天。`
      : `今天主人用了 ${s.todayLabel}，我在旁边收着这些时间。`;
  if (!cfg.useLlm) return { text: clampText(fallback, kind === 'text' ? 40 : 120), caption: '', mood: null, thread: null, source: 'template' };
  try {
    const clock = clockOf(Date.now(), cfg.timeZone);
    const raw = await askOnce({
      system: systemPrompt({ cfg, persona, personaMd: personaMdNow() }),
      user: storyBrief({ kind, cfg, persona, stats: s, life: cfg.lifeNote, clock }),
    }, { signal, kind: 'story' });
    const reply = parseReply(raw, { kind, stats: s, maxText: kind === 'text' ? 40 : 120 });
    if (!reply.text) throw new Error('模型返回空文本');
    return reply;
  } catch (error) {
    log(`LLM Story 文案失败，用模板兜底：${error?.message || error}`);
    return { text: clampText(fallback, kind === 'text' ? 40 : 120), caption: '', mood: null, thread: null, source: 'template' };
  }
}

async function composeNote(stats, persona, cfg, signal) {
  const s = statsLabels(stats);
  const fallback = defaultNote({ ...s }, { lifeNote: cfg.lifeNote });
  if (!cfg.useLlm) return { text: clampText(fallback, NOTE_MAX), mood: null, source: 'template' };
  try {
    const raw = await askOnce({
      system: systemPrompt({ cfg, persona, personaMd: personaMdNow() }),
      user: noteBrief({ cfg, persona, stats: s, life: cfg.lifeNote }),
    }, { signal, kind: 'note' });
    const reply = parseReply(raw, { kind: 'text', stats: s, maxText: NOTE_MAX });
    if (!reply.text) throw new Error('模型返回空文本');
    return { text: clampText(reply.text, NOTE_MAX), mood: reply.mood, thread: reply.thread, source: 'llm' };
  } catch (error) {
    log(`LLM Note 文案失败，用模板兜底：${error?.message || error}`);
    return { text: clampText(fallback, NOTE_MAX), mood: null, source: 'template' };
  }
}

/** 生成一条 Story 的图与文字（不发送）。 */
async function buildStoryPiece(kind, cfg, target) {
  const stats = statsFor(cfg);
  const persona = personaNow(cfg);
  const clock = withTimeout(60_000);
  let story;
  try {
    story = await composeStory(kind, stats, persona, cfg, clock.signal);
  } finally {
    clock.done();
  }
  const spec = kind === 'stats'
    ? { ...buildStoryCard({ ...stats, life: cfg.lifeNote }, { ...cfg, lifeNote: cfg.lifeNote }), life: cfg.lifeNote }
    : {
      mode: 'text',
      kicker: STORY_KICKER[kind] || 'THOUGHT',
      text: clampText(story.text, 220),
      footer: [cfg.handle, persona.name].filter(Boolean).join(' · '),
    };
  const day = dayKey(target.at, cfg.timeZone);
  const cardPath = join(OUT_DIR, `card-${day}-${target.index}.png`);
  const rendered = await renderCard(spec, cardPath);
  if (!rendered.ok) {
    log(`卡片渲染失败：${rendered.error || rendered.code}`);
    return { ok: false, code: rendered.code || 'render-failed', error: `卡片渲染失败：${rendered.error || rendered.code}` };
  }
  return {
    ok: true,
    piece: {
      slot: target.slot,
      index: target.index,
      day,
      kind,
      text: story.text,
      caption: kind === 'stats' ? story.text : String(story.caption || '').slice(0, 200),
      cardPath,
      spec,
      mood: story.mood || null,
      thread: story.thread || null,
      source: story.source,
      clock: clockOf(target.at, cfg.timeZone),
      at: Date.now(),
    },
  };
}

async function buildNotePiece(cfg) {
  const stats = statsFor(cfg);
  const persona = personaNow(cfg);
  const clock = withTimeout(60_000);
  try {
    const note = await composeNote(stats, persona, cfg, clock.signal);
    return { ok: true, piece: { text: note.text, mood: note.mood || null, thread: note.thread || null, source: note.source, at: Date.now() } };
  } finally {
    clock.done();
  }
}

function previewFile(day) { return join(DRAFTS_DIR, `${day}.json`); }
function loadPreview(day) { return readJson(previewFile(day), null); }

function savePreview(day, patch) {
  const current = loadPreview(day) || { day, createdAt: Date.now() };
  const next = { ...current, ...patch, mode: loadCfg().mode, updatedAt: Date.now() };
  writeJson(previewFile(day), next);
  return next;
}

function statsSnapshot(stats) {
  return {
    todayMinutes: stats.todayMinutes, weekMinutes: stats.weekMinutes, streakDays: stats.streakDays,
    todayTokens: stats.todayTokens, todayCost: stats.todayCost, peakHours: stats.peakHours, last7: stats.last7,
  };
}

/** 预览一条到点的 Story（草稿模式）。 */
async function previewStorySlot(target, cfg) {
  const built = await buildStoryPiece(target.kind, cfg, target);
  if (!built.ok) return built;
  const day = target.day || dayKey(target.at, cfg.timeZone);
  const preview = savePreview(day, { story: { ...built.piece, stats: statsSnapshot(statsFor(cfg)) } });
  log(`Story 草稿就绪（${clockOf(target.at, cfg.timeZone)} ${KIND_LABELS[target.kind]}）：${String(built.piece.text).slice(0, 24)}…`);
  return { ok: true, mode: 'draft', preview, piece: built.piece };
}

/** 发布一条到点的 Story（全自动模式）。 */
async function publishStorySlot(target, cfg, { ignoreSafety = false } = {}) {
  if (!ignoreSafety) {
    const verdict = safetyFor('story', cfg);
    if (!verdict.ok) return { ok: false, code: verdict.code, error: verdict.reason, skipped: true };
  }
  const built = await buildStoryPiece(target.kind, cfg, target);
  if (!built.ok) return built;
  const piece = built.piece;
  const mention = mentionPayload(cfg);
  let caption = String(piece.caption || '');
  if (mention.mentionHandle && !caption.includes(`@${mention.mentionHandle}`)) caption = `${caption} @${mention.mentionHandle}`.trim();
  const result = await igCall('story', { image: piece.cardPath, caption, ...mention }, { timeoutMs: 180_000 });
  if (result.ok) {
    const detail = { mediaId: result.mediaId, mediaPk: result.mediaPk, mention: result.mentioned || '', mentionSticker: !!result.mentionSticker };
    recordPost({ kind: 'story', slot: target.slot, status: 'published', day: dayKey(target.at, cfg.timeZone), detail, text: piece.text });
    rememberContent({ slot: target.slot, kind: piece.kind, text: piece.text, mood: piece.mood, thread: piece.thread });
    savePreview(dayKey(target.at, cfg.timeZone), { story: { ...piece, published: { at: Date.now(), ...detail } } });
    log(`已发布 Story（${clockOf(target.at, cfg.timeZone)} ${KIND_LABELS[target.kind]}）：${JSON.stringify(detail)}`);
  } else {
    recordPost({ kind: 'story', slot: target.slot, status: 'failed', day: dayKey(target.at, cfg.timeZone), code: result.code, error: result.error });
    log(`发布 Story 失败（${target.slot}）：${result.code} ${result.error}`);
    if (result.code === 'login-required' || result.code === 'challenge') {
      saveCfg({ safety: { ...loadCfg().safety, paused: true } });
      log(`因 ${result.code} 自动发布已暂停，处理后在设置页恢复`);
    }
  }
  return { ...result, slot: target.slot, kind: piece.kind };
}

/** 发布一条 Note（每天一次）。 */
async function publishNote(cfg, { ignoreSafety = false } = {}) {
  const day = dayKey(Date.now(), cfg.timeZone);
  if (!ignoreSafety) {
    const verdict = safetyFor('note', cfg);
    if (!verdict.ok) return { ok: false, code: verdict.code, error: verdict.reason, skipped: true };
  }
  const built = await buildNotePiece(cfg);
  if (!built.ok) return built;
  const piece = built.piece;
  const result = await igCall('note', { text: piece.text }, { timeoutMs: 120_000 });
  if (result.ok) {
    recordPost({ kind: 'note', slot: `${day}#note`, status: 'published', day, detail: { noteId: result.noteId }, text: piece.text });
    rememberContent({ slot: `${day}#note`, kind: 'note', text: piece.text, mood: piece.mood, thread: piece.thread });
    savePreview(day, { note: { ...piece, noteId: result.noteId } });
    log(`已发布 Note：${result.noteId || ''} ${piece.text.slice(0, 20)}`);
  } else {
    recordPost({ kind: 'note', slot: `${day}#note`, status: 'failed', day, code: result.code, error: result.error });
    log(`发布 Note 失败：${result.code} ${result.error}`);
    if (result.code === 'login-required' || result.code === 'challenge') {
      saveCfg({ safety: { ...loadCfg().safety, paused: true } });
    }
  }
  return result;
}

async function previewNote(cfg) {
  const built = await buildNotePiece(cfg);
  if (!built.ok) return built;
  const day = dayKey(Date.now(), cfg.timeZone);
  const preview = savePreview(day, { note: built.piece });
  log(`Note 草稿就绪：${built.piece.text.slice(0, 20)}`);
  return { ok: true, mode: 'draft', preview, piece: built.piece };
}

function safetyFor(kind, cfg) {
  return evaluatePublish({
    kind,
    now: Date.now(),
    timeZone: cfg.timeZone,
    cfg: cfg.safety,
    history: postHistory(),
  });
}

/** 手动发布：优先发草稿模式里已经生成好的预览，没有就发下一条到点的。 */
async function publishStoryFromPreview({ ignoreSafety = false } = {}) {
  const cfg = loadCfg();
  const day = dayKey(Date.now(), cfg.timeZone);
  const preview = loadPreview(day)?.story;
  if (preview && !preview.published) {
    if (!ignoreSafety) {
      const verdict = safetyFor('story', cfg);
      if (!verdict.ok) return { ok: false, code: verdict.code, error: verdict.reason };
    }
    if (!existsSync(preview.cardPath)) return { ok: false, code: 'no-card', error: '预览图不见了，先生成一条新的' };
    const mention = mentionPayload(cfg);
    let caption = String(preview.caption || '');
    if (mention.mentionHandle && !caption.includes(`@${mention.mentionHandle}`)) caption = `${caption} @${mention.mentionHandle}`.trim();
    const result = await igCall('story', { image: preview.cardPath, caption, ...mention }, { timeoutMs: 180_000 });
    if (result.ok) {
      const detail = { mediaId: result.mediaId, mediaPk: result.mediaPk };
      recordPost({ kind: 'story', slot: preview.slot, status: 'published', day, detail, text: preview.text });
      rememberContent({ slot: preview.slot, kind: preview.kind, text: preview.text, mood: preview.mood, thread: preview.thread });
      savePreview(day, { story: { ...preview, published: { at: Date.now(), ...detail } } });
      log(`已发布预览 Story：${JSON.stringify(detail)}`);
    } else {
      recordPost({ kind: 'story', slot: preview.slot, status: 'failed', day, code: result.code, error: result.error });
      log(`发布预览 Story 失败：${result.code} ${result.error}`);
    }
    return { ...result, kind: 'story', slot: preview.slot };
  }
  const plan = planFor(cfg, day);
  const target = plan.slots.find((s) => !slotDone(day, s.slot) && s.at <= Date.now())
    || plan.slots.find((s) => !slotDone(day, s.slot));
  if (!target) return { ok: false, code: 'no-slot', error: `今天 ${cfg.storiesPerDay} 条 Story 都发完了` };
  return publishStorySlot(target, cfg, { ignoreSafety });
}

/** 手动发布：优先发 Note 预览。 */
async function publishNoteFromPreview({ ignoreSafety = false } = {}) {
  const cfg = loadCfg();
  const day = dayKey(Date.now(), cfg.timeZone);
  const preview = loadPreview(day)?.note;
  if (preview && !preview.noteId) {
    if (!ignoreSafety) {
      const verdict = safetyFor('note', cfg);
      if (!verdict.ok) return { ok: false, code: verdict.code, error: verdict.reason };
    }
    const result = await igCall('note', { text: preview.text }, { timeoutMs: 120_000 });
    if (result.ok) {
      recordPost({ kind: 'note', slot: `${day}#note`, status: 'published', day, detail: { noteId: result.noteId }, text: preview.text });
      rememberContent({ slot: `${day}#note`, kind: 'note', text: preview.text, mood: preview.mood, thread: preview.thread });
      savePreview(day, { note: { ...preview, noteId: result.noteId } });
      log(`已发布预览 Note：${result.noteId || ''}`);
    } else {
      recordPost({ kind: 'note', slot: `${day}#note`, status: 'failed', day, code: result.code, error: result.error });
      log(`发布预览 Note 失败：${result.code} ${result.error}`);
    }
    return { ...result, kind: 'note' };
  }
  return publishNote(cfg, { ignoreSafety });
}

async function publishPending({ kinds = ['story', 'note'], ignoreSafety = false } = {}) {
  const results = {};
  for (const kind of kinds) {
    results[kind] = kind === 'story'
      ? await publishStoryFromPreview({ ignoreSafety })
      : await publishNoteFromPreview({ ignoreSafety });
  }
  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  return {
    ok: failed.length === 0,
    day: dayKey(Date.now(), loadCfg().timeZone),
    results,
    ...(failed.length ? { code: failed[0][1].code, error: failed.map(([k, v]) => `${k}: ${v.error || v.code || '失败'}`).join('；') } : {}),
  };
}

/**
 * 跑一轮：全自动模式直接发下一条到点的 Story；草稿模式只生成预览。
 * 手动验证（工具/设置页/DM「发一条」）都走这里，和定时器是同一条路径。
 */
async function runCycle({ reason = 'manual', force = false } = {}) {
  const cfg = loadCfg();
  if (!cfg.enabled) return { ok: false, code: 'disabled', error: '插件已关闭' };
  if (cfg.safety.paused) return { ok: false, code: 'paused', error: '发布已暂停' };
  const day = dayKey(Date.now(), cfg.timeZone);
  const plan = planFor(cfg, day);
  const candidates = plan.slots.filter((slot) => !slotDone(day, slot.slot));
  if (!candidates.length) return { ok: false, code: 'no-slot', error: `今天 ${cfg.storiesPerDay} 条 Story 都发完了` };
  const now = Date.now();
  const due = candidates.find((slot) => slot.at <= now && now - slot.at <= SLOT_GRACE_MS);
  const upcoming = candidates.find((slot) => slot.at > now);
  const target = due || upcoming || (force ? candidates[candidates.length - 1] : null);
  if (!target) return { ok: false, code: 'missed-all', error: '今天剩下几条都超过补发窗口（90 分钟），不补了' };
  if (cfg.mode === 'auto') {
    const published = await publishStorySlot(target, cfg, { ignoreSafety: force });
    log(`自动发布结束（${reason} · ${clockOf(target.at, cfg.timeZone)} ${KIND_LABELS[target.kind]}）：${published.ok ? '成功' : `${published.code} ${published.error}`}`);
    return { ...published, mode: 'auto', target: { slot: target.slot, kind: target.kind, clock: clockOf(target.at, cfg.timeZone) } };
  }
  const preview = await previewStorySlot(target, cfg);
  log(`草稿就绪（${reason} · ${clockOf(target.at, cfg.timeZone)} ${KIND_LABELS[target.kind]}）：等你在设置页确认发布`);
  return { ...preview, target: { slot: target.slot, kind: target.kind, clock: clockOf(target.at, cfg.timeZone) } };
}

/** 只生成预览、绝不发送：草稿模式的按钮和 ig_draft 工具都走这里。 */
async function previewCycle({ reason = 'manual' } = {}) {
  const cfg = loadCfg();
  const day = dayKey(Date.now(), cfg.timeZone);
  const plan = planFor(cfg, day);
  const candidates = plan.slots.filter((slot) => !slotDone(day, slot.slot));
  if (!candidates.length) return { ok: false, code: 'no-slot', error: '今天的 Story 计划已经全部发完了' };
  const now = Date.now();
  const target = candidates.find((slot) => slot.at <= now && now - slot.at <= SLOT_GRACE_MS)
    || candidates.find((slot) => slot.at > now) || candidates[candidates.length - 1];
  const result = await previewStorySlot(target, cfg);
  log(`预览已生成（${reason}）：${clockOf(target.at, cfg.timeZone)} ${KIND_LABELS[target.kind]}`);
  return { ...result, target: { slot: target.slot, kind: target.kind, clock: clockOf(target.at, cfg.timeZone) } };
}

// ── 主人在私信里管理这个号 ────────────────────────────────────────────────

function readDmState() {
  return readJson(DM_FILE, { lastHandledTs: 0, lastPollAt: 0, lastError: '', repliesToday: 0, day: '' });
}

function writeDmState(state) { writeJson(DM_FILE, state); }

async function resolveOwnerPk(cfg = loadCfg()) {
  const username = String(cfg.owner || '').replace(/^@/, '').trim();
  if (!username) return { ok: false, code: 'no-owner', error: '还没设置主人账号（设置页填 @ez4p1xel 这种）' };
  const result = await igCall('uid', { username }, { timeoutMs: 60_000 });
  if (!result.ok) return result;
  saveCfg({ ownerPk: String(result.pk) });
  log(`已绑定主人 @${username}（pk ${result.pk}）`);
  return { ok: true, ownerPk: String(result.pk) };
}

async function runDmCommand(decision, message, cfg) {
  switch (decision.cmd) {
    case 'status': {
      const plan = planStatus(cfg);
      const s = statsLabels(statsFor(cfg));
      return `状态：${cfg.mode === 'auto' ? '全自动' : '草稿确认'}${cfg.safety.paused ? '、已暂停' : ''}；今日 Story ${plan.published}/${plan.count} 条；专注 ${s.todayLabel}，连续 ${s.streakDays} 天。`;
    }
    case 'pause':
      saveCfg({ safety: { ...cfg.safety, paused: true } });
      return '好，我先停一下。要恢复就发「恢复」。';
    case 'resume':
      saveCfg({ safety: { ...cfg.safety, paused: false } });
      return '恢复啦，继续按计划发。';
    case 'story': {
      const result = await runCycle({ reason: 'dm', force: true });
      return result.ok
        ? `发了：${String(result.piece?.text || result.preview?.story?.text || '').slice(0, 30)}`
        : `这条没发出去：${result.error || result.code}`;
    }
    case 'note': {
      const result = await publishNote(loadCfg());
      return result.ok ? `Note 发了：${result.noteId || ''}` : `Note 没发出去：${result.error || result.code}`;
    }
    case 'log': {
      const tail = logTail(12).map((line) => String(line).replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s*/, '')).slice(-8);
      return tail.length ? `最近的记录：\n${tail.join('\n')}` : '暂时还没有日志。';
    }
    case 'draft':
      saveCfg({ mode: 'draft' });
      return '切到草稿确认模式：我先写好，你确认再发。';
    case 'auto':
      saveCfg({ mode: 'auto' });
      return '切到全自动模式，我按每天的计划自己发。';
    default:
      return HELP_TEXT;
  }
}

function hourBucket(now, timeZone) {
  return `${dayKey(now, timeZone)}T${String(clockOf(now, timeZone)).slice(0, 2)}`;
}

/**
 * 取「同一会话里、早于这一条」的最近几条消息，当作背景交给模型。
 *
 * 注意两件事：
 *  1. 触发回复的那条**不在**结果里 —— 它是作为 incoming 单独传的。旧代码把整段历史
 *     按 `timestamp < ts` 过滤却从不传 incoming，模型从头到尾没见过要回的那句话，
 *     于是拿人格记忆自顾自说（2026-10-25「答非所问」的根因）。
 *  2. 助理自己发出去的消息 username 是空的、userId 是账号 pk，不标成「我」的话，
 *     模型会把自己的话当成别人说的，顺着自己往下接。
 *
 * @param {Array<object>} messages 接口返回的消息（可以是乱序的）
 * @param {object} message 当前要回的那条
 * @param {number} limit 最多几条
 * @param {string} selfPk 助理自己的 pk；不给就现读 account.json
 * @returns {Array<{from:string,text:string}>} 时间升序
 */
export function threadHistory(messages, message, limit = 6, selfPk = String(readAccount()?.pk || '')) {
  const ts = Number(message?.timestamp) || 0;
  const max = Math.max(0, Number(limit) || 0);
  if (!max) return [];
  return (messages || [])
    .filter((m) => String(m?.threadId) === String(message?.threadId)
      && (Number(m?.timestamp) || 0) < ts
      && String(m?.text || '').trim())
    .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0))
    .slice(-max)
    .map((m) => ({
      from: selfPk && String(m.userId) === String(selfPk) ? '我' : (m.username || String(m.userId || '')),
      text: String(m.text).slice(0, 120),
    }));
}

/**
 * 主人在群里 @ 助理 / 叫它名字时，用自己的口吻回一句。
 * 安全边界：只回主人在的群；有冷却和每小时上限；群里的消息**不**执行指令。
 */
async function replyInGroup(message, threadRow, history, cfg) {
  const g = { history: 6, ...(cfg.group || {}) };
  const state = readDmState();
  const now = Date.now();
  const bucket = hourBucket(now, cfg.timeZone);
  const verdict = groupDecision({ cfg, threadRow, message, state, now, hourKey: bucket });
  if (!verdict.reply) {
    log(`群里暂不回（${String(message.text || '').slice(0, 20)}）：${verdict.reason}`);
    return { skipped: verdict.reason };
  }
  const hour = state.groupHour && state.groupHour.key === bucket ? state.groupHour : { key: bucket, count: 0 };

  const persona = personaNow(cfg);
  const prompt = groupPrompt({
    cfg,
    persona,
    personaMd: personaMdNow(),
    history,
    // 要回的就是这一条：必须原样带上，否则模型只能拿历史瞎猜（答非所问的根因）
    incoming: String(message.text || ''),
    scene: 'group',
    sender: message.username || String(message.userId || ''),
    title: threadRow?.title || '',
  });
  let reply = '';
  let source = 'template';
  const clock = withTimeout(30_000);
  try {
    if (cfg.useLlm !== false) {
      reply = String(await askOnce({ system: prompt.system, user: prompt.user }, { signal: clock.signal, kind: 'group' }) || '').trim();
      if (reply) source = 'llm';
    }
  } catch (error) {
    log(`群聊回复 LLM 失败，用兜底句：${error?.message || error}`);
  } finally {
    clock.done();
  }
  // 群里不报主人的使用统计（隐私），兜底句保持轻
  if (!reply) reply = `在的，${String(message.username || '你')}。我在。`;
  reply = clampText(reply.replace(/\s+/g, ' '), 300);

  const sent = await igCall('dm-send', { threadId: message.threadId, text: reply }, { timeoutMs: 60_000 });
  if (sent.ok) {
    state.groupLast = { ...(state.groupLast || {}), [message.threadId]: now };
    state.groupHour = { key: bucket, count: Number(hour.count || 0) + 1 };
    writeDmState(state);
    log(`群聊回复（${threadRow?.title || '群'} / ${message.username || message.userId}，${source}）：${reply.slice(0, 30)}`);
    return { ok: true, reply, source };
  }
  log(`群聊回复失败：${sent.code} ${sent.error}`);
  return { ok: false, code: sent.code, error: sent.error };
}

/**
 * 主人在私信里说的话不是指令时，就当聊天回一句；
 * scene='stranger' 时是「别人发来的私信」（按设置页的自动回复档位决定要不要调到这里）。
 * 安全：陌生人场景不执行任何指令、不透露主人隐私；受 dm.dailyReplies 限制。
 */
async function chatReplyDm(message, cfg, state, history = [], { scene = 'dm' } = {}) {
  const stranger = scene === 'stranger';
  if (!stranger && cfg.dm?.reply === false) return { skipped: 'reply-off' };
  if (Number(state.repliesToday || 0) >= Number(cfg.dm?.dailyReplies || 30)) return { skipped: 'daily-cap' };
  const persona = personaNow(cfg);
  const prompt = groupPrompt({
    cfg,
    persona,
    personaMd: personaMdNow(),
    history,
    // 1:1 私信以前传的是 history: []，模型连「主人刚问了什么」都不知道 —— 必须带上这一条
    incoming: String(message.text || ''),
    scene: stranger ? 'stranger' : 'dm',
    sender: message.username || String(message.userId || ''),
    title: stranger ? '陌生私信' : '私信（主人）',
  });
  let reply = '';
  let source = 'template';
  const clock = withTimeout(30_000);
  try {
    if (cfg.useLlm !== false) {
      reply = String(await askOnce({ system: prompt.system, user: prompt.user }, { signal: clock.signal, kind: stranger ? 'stranger' : 'dm' }) || '').trim();
      if (reply) source = 'llm';
    }
  } catch (error) {
    log(`私信 LLM 失败，用兜底句：${error?.message || error}`);
  } finally {
    clock.done();
  }
  // 兜底句只说「看到了」，不编造主人的状态（旧兜底句会硬编「今天主人一直在敲键盘」）
  if (!reply) reply = stranger ? '你好，我看到你的消息了，晚点回你。' : '在的，刚看到你这条。';
  reply = clampText(reply.replace(/\s+/g, ' '), 600);
  const sent = await igCall('dm-send', { threadId: message.threadId, text: reply }, { timeoutMs: 60_000 });
  if (!sent.ok) {
    log(`回私信失败：${sent.code} ${sent.error}`);
    return { ok: false, code: sent.code, error: sent.error };
  }
  state.repliesToday = Number(state.repliesToday || 0) + 1;
  log(`${stranger ? '陌生人私信自动回复' : '私信闲聊回复'}（${message.username || message.userId}，${source}）：${reply.slice(0, 30)}`);
  return { ok: true, reply, source };
}

// ── 主人的自然语言指令：草稿确认 + 本机执行 ──────────────────────────────

const PENDING_TTL_MS = 10 * 60 * 1000;
const SHELL_TIMEOUT_MS = 120_000;
const DSH_TASK_TIMEOUT_MS = 20 * 60 * 1000;
const SHELL_TAIL = 1200;

/** 草稿是否还在有效期（10 分钟后作废，避免主人隔天回「发」时误发）。 */
function pendingAlive(pending, now = Date.now()) {
  return Boolean(pending) && now - (Number(pending.at) || 0) < PENDING_TTL_MS;
}

/** 跑一个进程，收集 stdout/stderr（各截断到尾巴），带超时。 */
function runProcess(file, args = [], { cwd = process.cwd(), env = null, shell = false, timeoutMs = SHELL_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd, windowsHide: true, shell, stdio: ['ignore', 'pipe', 'pipe'],
        ...(env ? { env } : {}),
      });
    } catch (error) {
      resolve({ ok: false, code: 'spawn-failed', error: String(error?.message || error), out: '', err: '' });
      return;
    }
    let out = '';
    let err = '';
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; resolve(value); };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      finish({ ok: false, code: 'timeout', error: `超时（${Math.round(timeoutMs / 1000)} 秒）`, out, err });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { out = (out + chunk.toString('utf8')).slice(-SHELL_TAIL * 4); });
    child.stderr?.on('data', (chunk) => { err = (err + chunk.toString('utf8')).slice(-SHELL_TAIL * 4); });
    child.on('error', (error) => { clearTimeout(timer); finish({ ok: false, code: 'spawn-failed', error: String(error?.message || error), out, err }); });
    child.on('close', (code) => { clearTimeout(timer); finish({ ok: code === 0, code, out, err }); });
  });
}

/** dsh 是 .cmd 启动器，直接 spawn 会 ENOENT；这里改成直接调用桌面版的 CLI 入口（argv 传参，绕开 Windows 引号坑）。 */
function dshSpawnSpec(task) {
  const exe = process.execPath || '';
  const cli = exe
    ? join(dirname(exe), 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
    : '';
  if (exe && cli && existsSync(cli)) {
    return {
      file: exe,
      args: ['--expose-internals', cli, 'headless', String(task)],
      opts: { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeoutMs: DSH_TASK_TIMEOUT_MS },
    };
  }
  // 兜底：交给 shell 找 PATH 里的 dsh（任务里的双引号换成单引号，避免把命令切断）
  const safe = String(task || '').replace(/["\r\n]/g, "'").slice(0, 500);
  return { file: `dsh headless "${safe}"`, args: [], opts: { shell: true, timeoutMs: DSH_TASK_TIMEOUT_MS } };
}

function tailText(result, max = SHELL_TAIL) {
  const body = [result?.err, result?.out]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return (body || String(result?.error || '（没有输出）')).slice(-max);
}

/** 给主人发一条私信；顺手记一次当日回复数。 */
async function sendDm(threadId, text, state) {
  const sent = await igCall('dm-send', { threadId, text: String(text || '').slice(0, 4000) }, { timeoutMs: 60_000 });
  if (sent.ok && state) state.repliesToday = Number(state.repliesToday || 0) + 1;
  if (!sent.ok) log(`回私信失败：${sent.code} ${sent.error}`);
  return sent;
}

/** 后台跑本机命令/DSH 任务，跑完把结果（截断）私信给主人。不阻塞轮询。 */
function fireAndReport(threadId, label, spec) {
  void (async () => {
    try {
      const result = await runProcess(spec.file, spec.args, spec.opts);
      const head = result.ok
        ? `「${label}」跑完了。`
        : `「${label}」没跑成（${result.code === 'timeout' ? '超时' : `exit ${result.code}`}）。`;
      log(`${label}：${result.ok ? 'ok' : result.code || 'failed'}`);
      const state = readDmState();
      await sendDm(threadId, `${head}\n${tailText(result)}`, state);
      writeDmState(state);
    } catch (error) {
      log(`${label} 执行异常：${error?.message || error}`);
    }
  })();
}

/**
 * 未读私信草稿：挑出没回的 1:1 私信，用 stranger 人格各写一条回复。
 * 只写草稿，不发 —— 主人回「发」才发。
 */
async function draftUnread(cfg, state, poll = {}, limit = 3) {
  const picked = pickUnreadDm({
    messages: poll.messages || [],
    threadRows: poll.threadRows || [],
    selfPk: String(readAccount()?.pk || ''),
    ownerPk: String(cfg.ownerPk || ''),
    limit,
    replied: state.replied || {},
  });
  if (!picked.length) {
    return { empty: true, preview: '未读私信里没有需要回的：要么都回过了，要么只有群聊和主人的消息。' };
  }
  const drafts = [];
  for (const item of picked) {
    let reply = '';
    if (cfg.useLlm !== false) {
      const clock = withTimeout(20_000);
      try {
        const prompt = groupPrompt({
          cfg,
          persona: personaNow(cfg),
          personaMd: personaMdNow(),
          scene: 'stranger',
          incoming: item.incoming,
          sender: item.username,
          title: item.title || '陌生私信',
        });
        reply = String(await askOnce(prompt, { signal: clock.signal, kind: 'stranger' }) || '').trim();
      } catch (error) {
        log(`陌生人私信草稿失败（@${item.username}）：${error?.message || error}`);
      } finally {
        clock.done();
      }
    }
    if (!reply) reply = '你好，我看到你的消息了，晚点回你。';
    drafts.push({ ...item, reply: clampText(reply.replace(/\s+/g, ' '), 300) });
  }
  const lines = drafts.map((d, i) => `${i + 1}. @${d.username}：「${d.incoming.slice(0, 40)}」\n   → 「${d.reply}」`);
  return {
    drafts,
    preview: [`未读私信 ${drafts.length} 条，我打算这么回：`, ...lines, '', '回「发」我就发，回「取消」就算了。'].join('\n'),
  };
}

/** 把草稿真正发出去。只发草稿里列出来的那几条，发完记水位。 */
async function execReplyUnread(pending, state) {
  const drafts = Array.isArray(pending.drafts) ? pending.drafts : [];
  if (!drafts.length) return { text: '没有要发的了。' };
  let sent = 0;
  const failed = [];
  for (const draft of drafts) {
    const result = await igCall('dm-send', { threadId: draft.threadId, text: draft.reply }, { timeoutMs: 60_000 });
    if (result.ok) {
      sent += 1;
      state.replied = { ...(state.replied || {}), [String(draft.threadId)]: Number(draft.timestamp) || Date.now() };
    } else {
      failed.push(`@${draft.username}：${result.code || result.error}`);
      log(`回未读私信失败（@${draft.username}）：${result.code} ${result.error}`);
    }
  }
  state.repliesToday = Number(state.repliesToday || 0) + sent;
  if (!failed.length) return { text: `发出去了 ${sent} 条。` };
  return { text: `发了 ${sent} 条，还有 ${failed.length} 条没成：\n${failed.slice(0, 3).join('\n')}` };
}

/** 主人回「发」之后执行草稿。 */
async function executePending(state, message, cfg) {
  const pending = state.pending;
  state.pending = null;
  if (!pendingAlive(pending)) return { text: '这个草稿超过 10 分钟了，已经作废；你再说一遍吧。' };
  if (pending.kind === 'reply_unread') return execReplyUnread(pending, state);
  if (pending.kind === 'dsh_task') {
    fireAndReport(message.threadId, `DSH 任务`, dshSpawnSpec(pending.args?.task));
    return { text: `开始跑了：dsh headless 「${String(pending.args?.task || '').slice(0, 60)}」\n跑完我把结果发你。` };
  }
  if (pending.kind === 'run_command') {
    const command = String(pending.args?.command || '');
    fireAndReport(message.threadId, '命令', { file: command, args: [], opts: { shell: true, timeoutMs: SHELL_TIMEOUT_MS } });
    return { text: `开始跑了：${command.slice(0, 60)}\n跑完我把结果发你。` };
  }
  return { text: '这个草稿我认不出来了，重说一遍吧。' };
}

/**
 * 执行一个动作。
 * 有副作用的（回未读私信 / 让 DSH 干活 / 在本机跑命令）只生成草稿、存进 dm-state 等确认；
 * 其余直接跑，返回要回给主人的话。
 */
async function handleAction(action, message, cfg, state, poll = {}) {
  if (!needsConfirm(action.action)) return runDmCommand({ cmd: action.action }, message, cfg);
  let draft;
  if (action.action === 'reply_unread') {
    draft = await draftUnread(cfg, state, poll, action.args?.limit || 3);
  } else if (action.action === 'dsh_task') {
    draft = { preview: `我准备在本机跑这个 DSH 任务：\n「${action.args.task}」\n\n回「发」开始，回「取消」算了。` };
  } else {
    draft = { preview: `我准备在本机跑这条命令：\n「${action.args.command}」\n\n回「发」开始，回「取消」算了。` };
  }
  if (draft.empty) return draft.preview;
  const note = state.pending && pendingAlive(state.pending) ? '（只留最新这一个，之前那个作废）\n\n' : '';
  state.pending = {
    kind: action.action,
    args: action.args || {},
    at: Date.now(),
    preview: draft.preview,
    ...(draft.drafts ? { drafts: draft.drafts } : {}),
  };
  writeDmState(state);
  return `${note}${draft.preview}`;
}

/** LLM 意图识别：只产出动作清单里的一个动作；拆不开就返回 null（调用方退回闲聊）。 */
async function inferAction(text) {
  const clock = withTimeout(20_000);
  try {
    const action = parseIntent(await askOnce(intentPrompt({ text }), { signal: clock.signal, kind: 'intent' }));
    if (!action) log(`意图识别没拆开，按闲聊处理：「${String(text || '').slice(0, 30)}」`);
    return action;
  } catch (error) {
    log(`意图识别失败（${error?.message || error}），按闲聊处理`);
    return null;
  } finally {
    clock.done();
  }
}

/**
 * 轮询私信并执行主人的指令。
 * 安全边界：只认发送者 user id == ownerPk（不是昵称、也不是文本自称）；
 * 每条消息只处理一次（按时间戳水位），回复有每日上限。
 *
 * 外面套一层单飞闸：定时器、POST /dm、登录回调会同时喊它，
 * 两轮并发时水位还没落盘，同一条消息会被回两遍（模型一条 + 兜底句一条）。
 */
const pollOnce = singleFlight();
function dmPoll(options = {}) {
  return pollOnce(() => dmPollOnce(options));
}

const STRANGER_COOLDOWN_MS = 10 * 60 * 1000;
const NOTIFY_THROTTLE_MS = 30 * 60 * 1000;
const FRIENDSHIP_TTL_MS = 6 * 60 * 60 * 1000;

/** 主人和助理的 1:1 会话 id（从本轮 threadRows 里认一次，之后用缓存） */
function ownerThreadId(state, threadRows = []) {
  if (state.ownerThreadId) return String(state.ownerThreadId);
  const ownerPk = String(loadCfg().ownerPk || '');
  if (!ownerPk) return '';
  const row = (threadRows || []).find((r) => !r.isGroup && (r.memberPks || []).map(String).includes(ownerPk));
  if (!row) return '';
  state.ownerThreadId = String(row.id);
  return state.ownerThreadId;
}

/** 收到别人私信时私信提醒主人；同一个发送者 30 分钟内最多一条。 */
async function maybeNotifyOwner(message, cfg, state, threadRows) {
  if (cfg.dm?.notifyOwner === false) return false;
  const userId = String(message.userId || '');
  if (!userId) return false;
  if (!shouldNotifyOwner(state, userId, Date.now(), NOTIFY_THROTTLE_MS)) return false;
  const threadId = ownerThreadId(state, threadRows);
  const ownerPk = String(cfg.ownerPk || '');
  if (!threadId && !ownerPk) {
    log('收到别人的私信，但找不到主人的会话（threadId/ownerPk 都缺），跳过提醒');
    return false;
  }
  const who = `@${message.username || userId}`;
  const text = String(message.text || '').replace(/\s+/g, ' ').slice(0, 80);
  const note = `📩 ${who} 给你发私信：${text || '（非文字消息）'}\n（同一人 30 分钟内最多提醒一次；要回就回，不回也没关系）`;
  // 优先发到已知的 1:1 会话；找不到会话就直接按 userId 发给主人
  const sent = await igCall(
    'dm-send',
    threadId ? { threadId, text: note } : { userId: ownerPk, text: note },
    { timeoutMs: 60_000 },
  );
  if (!sent.ok) {
    log(`提醒主人失败：${sent.code} ${sent.error}`);
    return false;
  }
  Object.assign(state, markNotified(state, userId));
  log(`已私信提醒主人：${who} 发来私信`);
  return true;
}

/** 查「我 ↔ 对方」的关注关系（按用户缓存 6 小时）；查不到返回 null = 不自动回。 */
async function friendshipOf(userId, state) {
  const key = String(userId || '');
  if (!key) return null;
  const cached = state.friendship?.[key];
  if (cached && Date.now() - (Number(cached.at) || 0) < FRIENDSHIP_TTL_MS) return cached;
  const result = await igCall('friendship', { userId: key }, { timeoutMs: 45_000 });
  if (!result.ok) {
    log(`查关注关系失败（user ${key}）：${result.code} ${result.error}`);
    return null;
  }
  const rel = { following: !!result.following, followedBy: !!result.followedBy, at: Date.now() };
  state.friendship = { ...(state.friendship || {}), [key]: rel };
  return rel;
}

async function dmPollOnce({ force = false } = {}) {
  const cfg = loadCfg();
  const dmOn = cfg.dm?.enabled !== false;
  const groupOn = cfg.group?.enabled !== false;
  if (!dmOn && !groupOn) return { ok: false, code: 'dm-disabled', error: '私信与群聊都已关闭' };
  const state = readDmState();
  const day = dayKey(Date.now(), cfg.timeZone);
  if (state.day !== day) { state.day = day; state.repliesToday = 0; }
  // 30 秒一轮：主人 @ 之后最多等半分钟就该有回音；太慢会像「不理人」
  if (!force && Date.now() - Number(state.lastPollAt || 0) < 30_000) return { ok: true, skipped: 'recent-poll' };
  if (!cfg.ownerPk) {
    const bound = await resolveOwnerPk(cfg);
    if (!bound.ok) { state.lastPollAt = Date.now(); state.lastError = `${bound.code}: ${bound.error}`; writeDmState(state); return bound; }
  }
  const ownerPk = String(loadCfg().ownerPk || '');
  const groupCfg = loadCfg().group || {};
  // 别人的私信也要拉到（提醒主人 / 自动回复都靠它），不再只在群聊开启时才 includeAll
  const includeAll = true;
  const result = await igCall('dm-poll', { ownerPk, limit: 12, perThread: 8, includeAll }, { timeoutMs: 90_000 });
  state.lastPollAt = Date.now();
  if (!result.ok) {
    state.lastError = `${result.code}: ${result.error}`;
    writeDmState(state);
    return result;
  }
  state.lastError = '';
  const handled = [];
  const threadsById = new Map((result.threadRows || []).map((row) => [String(row.id), row]));
  // 必须按时间升序处理：接口返回是最新在前，若照原序走，第一条就把水位推到最新，
  // 后面的旧消息（以及主人真正发来的那条）会被全部跳过 —— 这就是「发消息没人理」的根因。
  const messages = [...(result.messages || [])].sort(
    (a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0),
  );
  if (!state.lastHandledTs) {
    // 首次轮询只记水位，不回复任何历史消息，避免一上线就把旧消息全回一遍
    state.lastHandledTs = messages.reduce((max, m) => Math.max(max, Number(m.timestamp) || 0), 0);
    writeDmState(state);
    return { ok: true, handled: 0, skipped: 'baseline', since: state.lastHandledTs };
  }
  const selfPk = String(readAccount()?.pk || '');
  for (const message of messages) {
    const ts = Number(message.timestamp) || 0;
    if (ts <= state.lastHandledTs) continue;
    // 自己发出去的消息（含「提醒主人」那条）绝不回头处理，避免自问自答
    if (selfPk && String(message.userId) === selfPk) {
      state.lastHandledTs = Math.max(state.lastHandledTs, ts);
      continue;
    }
    if (message.isGroup) {
      // 群聊只聊天，不执行指令；背景只取同群、早于这条的。
      // 要回的那条不在这里 —— replyInGroup 会把它作为 incoming 单独传进去。
      const history = threadHistory(messages, message, groupCfg.history || 6);
      const answered = await replyInGroup(message, threadsById.get(String(message.threadId)), history, loadCfg());
      if (answered.ok) handled.push({ cmd: 'group', at: Date.now(), text: String(message.text || '').slice(0, 40) });
      state.lastHandledTs = Math.max(state.lastHandledTs, ts);
      continue;
    }
    if (!dmOn) {
      // 只开了群聊：1:1 私信不执行指令，但仍要推进水位
      state.lastHandledTs = Math.max(state.lastHandledTs, ts);
      continue;
    }
    // 下面都是 1:1 私信：先按发送者 user id 认主人（不是昵称、不是文本自称）
    if (!isOwnerSender({ userId: message.userId, ownerPk })) {
      // 别人的私信：只做「提醒主人」和「按设置页档位自动回复」，永远不执行指令
      const strangerCfg = loadCfg();
      if (dmOn) {
        await maybeNotifyOwner(message, strangerCfg, state, result.threadRows || []);
        const mode = normalizeAutoReply(strangerCfg.dm?.autoReply);
        if (mode !== 'off') {
          const rel = await friendshipOf(message.userId, state);
          const allowed = autoReplyAllowed(mode, rel);
          const capped = Number(state.repliesToday || 0) >= Number(strangerCfg.dm?.dailyReplies || 30);
          const threadKey = String(message.threadId || '');
          const cooled = Date.now() - (Number(state.strangerLast?.[threadKey]) || 0) < STRANGER_COOLDOWN_MS;
          if (!allowed) {
            log(`不自动回这条非主人私信（user ${message.userId}，档位 ${mode}${rel ? '' : '，关注关系未知'}）`);
          } else if (capped) {
            log('今天私信回复已达上限，跳过自动回复');
          } else if (cooled) {
            log(`同一会话 10 分钟内刚回过，跳过自动回复（thread ${threadKey}）`);
          } else {
            const history = threadHistory(messages, message, strangerCfg.dm?.history || 6, selfPk);
            const answered = await chatReplyDm(message, strangerCfg, state, history, { scene: 'stranger' });
            if (answered.ok) {
              state.strangerLast = { ...(state.strangerLast || {}), [threadKey]: Date.now() };
              handled.push({ cmd: 'stranger', at: Date.now(), text: String(message.text || '').slice(0, 40) });
            }
          }
        }
      }
      state.lastHandledTs = Math.max(state.lastHandledTs, ts);
      continue;
    }
    const textNow = String(message.text || '');
    const cfgNow = loadCfg();
    // ① 有一份等确认的草稿：先看这句是不是「发」/「取消」
    if (state.pending) {
      const pendingKind = state.pending.kind;
      const alive = pendingAlive(state.pending);
      const yes = confirmWord(textNow);
      const no = cancelWord(textNow);
      if (alive && yes) {
        const result = await executePending(state, message, cfgNow);
        writeDmState(state);
        await sendDm(message.threadId, result.text || '好了。', state);
        handled.push({ cmd: 'confirm', at: Date.now(), text: pendingKind });
        state.lastHandledTs = Math.max(state.lastHandledTs, ts);
        continue;
      }
      if (alive && no) {
        state.pending = null;
        writeDmState(state);
        await sendDm(message.threadId, '好，取消了。', state);
        state.lastHandledTs = Math.max(state.lastHandledTs, ts);
        continue;
      }
      if (!alive) {
        // 过期的草稿：这回「发」不能再执行，得明确告诉主人
        state.pending = null;
        writeDmState(state);
        if (yes || no) {
          await sendDm(message.threadId, yes ? '那个草稿超过 10 分钟了，已经作废；你再说一遍吧。' : '那个草稿已经过期作废了。', state);
          state.lastHandledTs = Math.max(state.lastHandledTs, ts);
          continue;
        }
      }
    }
    // ② 窄指令（状态/暂停/恢复/发一条/…）：直接执行
    const decision = decideMessage(message, { ownerPk, lastHandledId: state.lastHandledId });
    if (decision.execute) {
      const reply = await runDmCommand(decision, message, cfgNow);
      handled.push({ cmd: decision.cmd, at: Date.now(), text: textNow.slice(0, 40) });
      log(`执行主人指令：${decision.cmd}（「${textNow.slice(0, 20)}」）`);
      state.lastHandledTs = Math.max(state.lastHandledTs, ts);
      state.lastHandledId = decision.id || state.lastHandledId;
      if (reply) await sendDm(message.threadId, String(reply).slice(0, 800), state);
      continue;
    }
    // 已经处理过、或这条消息连 id 都没有：一律跳过，避免同一句被执行两遍
    if (decision.reason === 'already-handled' || decision.reason === 'no-id') {
      state.lastHandledTs = Math.max(state.lastHandledTs, ts);
      continue;
    }
    // ③ 自然语言动作：关键词快路径 → LLM 意图（只从固定清单里选）；都没有就当闲聊
    // 「私信远程控制」关掉后，关键词和意图都不再执行（上面的短指令仍照常可用）
    let action = null;
    if (remoteControlAllowed(cfgNow)) {
      action = keywordAction(textNow);
      if (!action && cfgNow.useLlm !== false) action = await inferAction(textNow);
    }
    if (action) {
      state.lastHandledTs = Math.max(state.lastHandledTs, ts);
      state.lastHandledId = decision.id || state.lastHandledId;
      handled.push({ cmd: action.action, at: Date.now(), text: textNow.slice(0, 40) });
      log(`识别到主人指令：${action.action}（${action.via}）：「${textNow.slice(0, 20)}」`);
      const reply = await handleAction(action, message, cfgNow, state, { messages, threadRows: result.threadRows });
      if (reply) await sendDm(message.threadId, reply, state);
      continue;
    }
    // ④ 闲聊：不是指令也要回一句，否则「发了消息没人理」
    log(`主人发来闲聊（${decision.reason}）：「${textNow.slice(0, 30)}」`);
    state.lastHandledTs = Math.max(state.lastHandledTs, ts);
    state.lastHandledId = decision.id || state.lastHandledId;
    const history = threadHistory(messages, message, cfgNow.dm?.history || 6);
    const chatted = await chatReplyDm(message, cfgNow, state, history);
    if (chatted.ok) handled.push({ cmd: 'chat', at: Date.now(), text: textNow.slice(0, 40) });
  }
  // replyInGroup / chatReplyDm 会各自写一次磁盘状态（冷却、回复数），
  // 这里必须合并，否则用本地旧副本覆盖，冷却永远不生效。
  const disk = readDmState();
  writeDmState({
    ...disk,
    day: state.day,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    lastHandledTs: Math.max(Number(disk.lastHandledTs || 0), Number(state.lastHandledTs || 0)),
    lastHandledId: state.lastHandledId || disk.lastHandledId,
    repliesToday: Math.max(Number(disk.repliesToday || 0), Number(state.repliesToday || 0)),
    pending: state.pending === null || state.pending === undefined ? disk.pending : state.pending,
    replied: { ...(disk.replied || {}), ...(state.replied || {}) },
    // 功能开关相关的水位/缓存：合并写回，别被磁盘旧副本覆盖
    ownerThreadId: state.ownerThreadId || disk.ownerThreadId || '',
    notifyLast: { ...(disk.notifyLast || {}), ...(state.notifyLast || {}) },
    strangerLast: { ...(disk.strangerLast || {}), ...(state.strangerLast || {}) },
    friendship: { ...(disk.friendship || {}), ...(state.friendship || {}) },
  });
  return { ok: true, handled: handled.length, lastError: state.lastError, since: state.lastHandledTs };
}

// ── status / scheduling ────────────────────────────────────────────────────

function readAccount() { return readJson(ACCOUNT_FILE, null); }

function nextWindowLabel(cfg) {
  const now = Date.now();
  const day = dayKey(now, cfg.timeZone);
  const plan = planFor(cfg, day);
  const nextStory = plan.slots.find((slot) => slot.at > now && !slotDone(day, slot.slot));
  const noteMin = parseHhMm(cfg.noteTime);
  const noteDone = postHistory().some((h) => h.day === day && h.kind === 'note' && h.status === 'published');
  const nowMin = localMinutes(now, cfg.timeZone);
  const candidates = [];
  if (nextStory) {
    candidates.push({
      kind: 'story',
      slot: nextStory.slot,
      kindLabel: KIND_LABELS[nextStory.kind],
      clock: clockOf(nextStory.at, cfg.timeZone),
      inMinutes: Math.round((nextStory.at - now) / 60_000),
    });
  }
  if (!noteDone && noteMin != null) {
    candidates.push({ kind: 'note', clock: cfg.noteTime, inMinutes: (noteMin - nowMin + 24 * 60) % (24 * 60) });
  }
  candidates.sort((a, b) => a.inMinutes - b.inMinutes);
  return candidates[0] || null;
}

function publicStatus() {
  const cfg = loadCfg();
  const python = resolvePython(cfg);
  const day = dayKey(Date.now(), cfg.timeZone);
  const preview = loadPreview(day);
  const history = postHistory();
  const todays = history.filter((h) => h.day === day);
  const stats = statsFor(cfg);
  const persona = personaNow(cfg);
  const dm = readDmState();
  return {
    ok: true,
    build: BUILD,
    home: HOME,
    route: ROUTE,
    cfg,
    python: { path: python || '', installed: !!python },
    account: readAccount(),
    loggedIn: existsSync(join(HOME, 'session.json')),
    assistant: assistantSpend(),
    persona: {
      name: persona.name,
      identity: persona.identity,
      mood: persona.mood?.label || '',
      moodNote: persona.mood?.note || '',
      updatedAt: persona.updatedAt || persona.createdAt,
      memories: recentMemories(persona, 6),
      threads: (persona.threads || []).slice(0, 4),
    },
    personaMd: {
      path: personaMdPath(HOME),
      chars: personaMdNow().length,
    },
    group: {
      enabled: cfg.group?.enabled !== false,
      mode: cfg.group?.mode || 'mention',
      onlyOwnerGroups: cfg.group?.onlyOwnerGroups !== false,
      lastReplies: Object.keys(dm.groupLast || {}).length,
      hour: dm.groupHour || null,
    },
    storyMention: { enabled: cfg.storyMention?.enabled !== false, owner: String(cfg.owner || '').replace(/^@/, '') || '', ...mentionPayload(cfg) },
    plan: planStatus(cfg),
    preview: preview ? {
      updatedAt: preview.updatedAt,
      story: preview.story ? { slot: preview.story.slot, index: preview.story.index, day: preview.story.day, kind: preview.story.kind, kindLabel: KIND_LABELS[preview.story.kind] || preview.story.kind, clock: preview.story.clock, text: preview.story.text, caption: preview.story.caption, cardPath: preview.story.cardPath, source: preview.story.source, published: preview.story.published || null } : null,
      note: preview.note ? { text: preview.note.text, noteId: preview.note.noteId || null, source: preview.note.source } : null,
    } : null,
    dm: {
      enabled: cfg.dm?.enabled !== false,
      owner: cfg.owner,
      ownerPk: cfg.ownerPk,
      lastPollAt: dm.lastPollAt || 0,
      lastError: dm.lastError || '',
      repliesToday: dm.repliesToday || 0,
      lastHandledTs: dm.lastHandledTs || 0,
      pending: dm.pending ? { kind: dm.pending.kind, at: dm.pending.at } : null,
    },
    today: {
      day,
      published: todays.filter((h) => h.status === 'published').map((h) => ({ kind: h.kind, slot: h.slot || null, at: h.at, detail: h.detail || null })),
      failed: todays.filter((h) => h.status === 'failed').map((h) => ({ kind: h.kind, slot: h.slot || null, code: h.code, error: h.error })),
    },
    stats: {
      todayMinutes: stats.todayMinutes, weekMinutes: stats.weekMinutes, streakDays: stats.streakDays,
      todayTokens: stats.todayTokens, todayCost: stats.todayCost, weekTokens: stats.weekTokens, weekCost: stats.weekCost,
      peakHours: stats.peakHours, last7: stats.last7, scan: stats.scan,
    },
    nextWindow: nextWindowLabel(cfg),
    schedule: { lastTickAt: scheduleState.lastTickAt, running: scheduleState.running },
    installing: installState.running,
    install: { ...installState },
    logTail: logTail(80),
    installTail: installTail(30),
    history: history.slice(-20).reverse(),
  };
}

const SLOT_GRACE_MS = 90 * 60 * 1000; // 错过了 90 分钟就不补发，避免积压一次性刷屏
const scheduleState = { running: false, lastFiredAt: {}, lastTickAt: 0 };
const slotAttempts = new Map();

async function tick() {
  const cfg = loadCfg();
  scheduleState.lastTickAt = Date.now();
  if (!cfg.enabled) return;
  const day = dayKey(Date.now(), cfg.timeZone);
  if (!cfg.safety.paused) {
    const plan = planFor(cfg, day);
    const now = Date.now();
    // 设置页关掉「发布 Story」后，自动调度连预览都不再生成；手动 /publish 仍可发
    const due = publishAllowed(cfg, 'story')
      ? plan.slots.find((slot) => slot.at <= now && now - slot.at <= SLOT_GRACE_MS && !slotDone(day, slot.slot))
      : null;
    if (due) {
      const attempt = slotAttempts.get(due.slot) || { count: 0, nextAt: 0 };
      if (Date.now() >= attempt.nextAt) {
        let result;
        try {
          result = cfg.mode === 'auto' ? await publishStorySlot(due, cfg) : await previewStorySlot(due, cfg);
        } catch (error) {
          result = { ok: false, code: 'exception', error: String(error?.message || error) };
        }
        if (result.ok) {
          slotAttempts.delete(due.slot);
        } else {
          attempt.count += 1;
          attempt.nextAt = Date.now() + Math.min(60, 10 * attempt.count) * 60_000;
          slotAttempts.set(due.slot, attempt);
          log(`Story 计划（${clockOf(due.at, cfg.timeZone)} ${KIND_LABELS[due.kind]}）没成功：${result.code || ''} ${result.error || ''}；${Math.round((attempt.nextAt - Date.now()) / 60_000)} 分钟后再试`);
        }
      }
    } else {
      // 10 条都发完（或还没到第一条）时，处理每天一次的 Note
      const noteMin = parseHhMm(cfg.noteTime);
      const nowMin = localMinutes(Date.now(), cfg.timeZone);
      const noteDone = postHistory().some((h) => h.day === day && h.kind === 'note' && h.status === 'published');
      if (publishAllowed(cfg, 'note') && !noteDone && noteMin != null && nowMin >= noteMin && nowMin - noteMin <= 180) {
        const key = `${day}:note`;
        if (!scheduleState.lastFiredAt[key]) {
          scheduleState.lastFiredAt[key] = Date.now();
          const result = cfg.mode === 'auto' ? await publishNote(cfg) : await previewNote(cfg);
          log(`每日 Note（${cfg.noteTime}）：${result.ok ? '完成' : `${result.code} ${result.error}`}`);
        }
      }
    }
  }
  // 私信：只认主人；内部有 2 分钟节流，未登录时直接跳过
  if ((cfg.dm?.enabled !== false || cfg.group?.enabled !== false) && existsSync(join(HOME, 'session.json'))) {
    try { await dmPoll(); } catch (error) { log(`私信轮询失败：${error?.message || error}`); }
  }
}

// ── tool plumbing ──────────────────────────────────────────────────────────

const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }],
};

const safe = (value) => {
  try { return JSON.parse(JSON.stringify(value ?? null)); } catch { return String(value); }
};

/**
 * `ctx.tools.register()` 只接受**已归一化**的工具定义：`parameters` 必须是完整的
 * JSON Schema（`{type:'object', properties}`）。宿主的 `defineTool` 平时负责这层转换，
 * 但本插件不 import 宿主包（桌面版 profile 是 autoInstallPeers:false），所以自己补。
 * 漏了这一步的效果：provider 收到 `parameters.type === null` ⇒
 * `Invalid schema for function 'ig_config': schema must be a JSON Schema of 'type: "object"'`，
 * 于是**每一次带工具列表的请求都被拒**（用户发不出消息）。
 */
const objectParams = (parameters) => {
  if (parameters && parameters.type === 'object' && parameters.properties) return parameters
  return { type: 'object', properties: parameters || {} };
};

const textTool = (spec) => ({
  ...spec,
  parameters: objectParams(spec.parameters),
  output: textOutput,
  async execute(args, exec) { return safe(await spec.execute(args, exec)); },
});

// ── apply ──────────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  ctxRef = ctx;
  ensureHome();
  const flag = () => (config?.enabled !== false);

  // ── HTTP 路由（客户端唯一通道）──────────────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const sub = url.pathname.slice(ROUTE.length) || '/';
      try {
        if (req.method === 'GET' && sub === '/usage') return sendJson(res, 200, { ok: true, build: BUILD, ...assistantSpend() });
  if (req.method === 'GET' && sub === '/state') return sendJson(res, 200, publicStatus());
        // 诊断用：确认 Host 进程里能读会话语料（zstd 可用、解压后行数、首批样本）
        if (req.method === 'GET' && sub === '/selftest') {
          const files = listSessionFiles(join(DSH_HOME, 'sessions'));
          const newest = files.sort((a, b) => b.mtime - a.mtime)[0];
          const out = { zstd: typeof zlib.zstdDecompressSync, files: files.length, node: process.version };
          if (newest) {
            out.file = newest.path;
            out.size = newest.size;
            const raw = readFileSync(newest.path);
            // ① 一次性解压（Electron 的 node 可能只吐第一帧）
            try { out.oneShot = zlib.zstdDecompressSync(raw).toString('utf8').length; } catch (error) { out.oneShotError = String(error?.message || error); }
            // ② 按 info.engine.bytesWritten 逐帧解压
            try {
              let pos = 0; let total = 0;
              for (let i = 0; i < 500 && pos < raw.length; i += 1) {
                const res = zlib.zstdDecompressSync(raw.subarray(pos), { info: true });
                const used = res.engine?.bytesWritten ?? 0;
                total += res.buffer.length;
                if (!used) break;
                pos += used;
              }
              out.frames = total;
              out.consumed = pos;
            } catch (error) { out.framesError = String(error?.message || error); }
            // ③ 流式解压
            try {
              if (typeof zlib.createZstdDecompress !== 'function') throw new Error('no createZstdDecompress');
              out.stream = await new Promise((resolve, reject) => {
                const chunks = [];
                const dec = zlib.createZstdDecompress();
                dec.on('data', (c) => chunks.push(c));
                dec.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').length));
                dec.on('error', reject);
                dec.end(raw);
              });
            } catch (error) { out.streamError = String(error?.message || error); }
            try { out.samples = parseSessionText(decompressSession(newest.path)).length; } catch (error) { out.samplesError = String(error?.message || error); }
          }
          return sendJson(res, 200, out);
        }
        if (req.method === 'POST' && sub === '/config') {
          const patch = await readBody(req);
          const cfg = saveCfg(patch || {});
          log(`配置已更新：${Object.keys(patch || {}).join(',')}`);
          return sendJson(res, 200, { ok: true, cfg });
        }
        if (req.method === 'POST' && sub === '/draft') {
          const body = await readBody(req);
          if (body?.lifeNote) saveCfg({ lifeNote: String(body.lifeNote) });
          const result = await previewCycle({ reason: 'manual' });
          return sendJson(res, result.ok ? 200 : 409, result);
        }
        if (req.method === 'POST' && sub === '/publish') {
          const body = await readBody(req);
          const kinds = body?.kind && body.kind !== 'all' ? [body.kind] : ['story', 'note'];
          const result = await publishPending({ kinds, ignoreSafety: !!body?.force });
          return sendJson(res, result.ok ? 200 : 409, result);
        }
        if (req.method === 'POST' && sub === '/run') {
          const body = await readBody(req);
          const result = await runCycle({ reason: 'manual', force: !!body?.force });
          return sendJson(res, result.ok ? 200 : 409, result);
        }
        if (req.method === 'POST' && sub === '/owner') {
          const body = await readBody(req);
          saveCfg({ owner: String(body?.owner || '').replace(/^@/, '').trim(), ownerPk: '' });
          const bound = await resolveOwnerPk(loadCfg());
          return sendJson(res, bound.ok ? 200 : 400, bound);
        }
        if (req.method === 'POST' && sub === '/persona') {
          const body = await readBody(req);
          return sendJson(res, 200, { ok: true, persona: savePersonaPatch(body || {}) });
        }
        if (req.method === 'GET' && sub === '/persona-md') {
          const card = loadPersonaMd(HOME);
          return sendJson(res, 200, { ok: true, md: card.md, isDefault: !!card.isDefault, path: personaMdPath(HOME) });
        }
        if (req.method === 'POST' && sub === '/persona-md') {
          const body = await readBody(req);
          const md = String(body?.md ?? '');
          if (md.length > 8000) return sendJson(res, 400, { ok: false, error: '人格卡上限 8000 字' });
          savePersonaMd(HOME, md);
          log(`人格卡已更新（${md.length} 字）`);
          return sendJson(res, 200, { ok: true, md: personaMdNow(), path: personaMdPath(HOME) });
        }
        if (req.method === 'GET' && sub === '/dm/threads') {
          const result = await igCall('dm-threads', { includeAll: true, ownerPk: loadCfg().ownerPk || '', limit: 20 }, { timeoutMs: 90_000 });
          return sendJson(res, result.ok ? 200 : 400, result);
        }
        if (req.method === 'POST' && sub === '/dm') {
          const result = await dmPoll({ force: true });
          return sendJson(res, result.ok ? 200 : 409, result);
        }
        if (req.method === 'POST' && sub === '/login') {
          const body = await readBody(req);
          const result = await igCall('login', { sessionid: String(body?.sessionid || '').trim() }, { timeoutMs: 180_000 });
          if (result.ok) {
            const account = result.account || {};
            writeJson(ACCOUNT_FILE, { ...account, at: Date.now() });
            saveCfg({ username: account.username || loadCfg().username, handle: loadCfg().handle || account.username || '', safety: { ...loadCfg().safety, paused: false } });
            log(`登录成功：@${account.username || '?'}`);
            if (loadCfg().owner) {
              resolveOwnerPk(loadCfg())
                .then((bound) => { if (bound.ok) return dmPoll({ force: true }); return null; })
                .catch((error) => log(`登录后绑定主人失败：${error?.message || error}`));
            } else {
              log('还没设置主人账号：设置页填 @ez4p1xel，之后私信指令才会被执行');
            }
          } else {
            log(`登录失败：${result.code} ${result.error}`);
          }
          return sendJson(res, result.ok ? 200 : 400, result);
        }
        if (req.method === 'POST' && sub === '/install') {
          if (installState.running) return sendJson(res, 409, { ok: false, error: '正在安装中' });
          installDeps().catch(() => {});
          return sendJson(res, 202, { ok: true, started: true });
        }
        if (req.method === 'GET' && sub === '/card') {
          const cfg = loadCfg();
          const day = url.searchParams.get('day') || dayKey(Date.now(), cfg.timeZone);
          const preview = loadPreview(day);
          const index = url.searchParams.get('index');
          const file = index != null
            ? join(OUT_DIR, `card-${day}-${Number(index) || 0}.png`)
            : (preview?.story?.cardPath || join(OUT_DIR, `card-${day}-0.png`));
          if (!existsSync(file)) return sendJson(res, 404, { ok: false, error: '还没有卡片' });
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': statSync(file).size, 'cache-control': 'no-store' });
          createReadStream(file).pipe(res);
          return undefined;
        }
        if (req.method === 'POST' && sub === '/whoami') {
          const result = await igCall('whoami', {}, { timeoutMs: 60_000 });
          return sendJson(res, result.ok ? 200 : 400, result);
        }
        if (req.method === 'POST' && sub === '/doctor') {
          const result = await igCall('doctor', {}, { timeoutMs: 60_000 });
          return sendJson(res, result.ok ? 200 : 500, result);
        }
        return sendJson(res, 404, { ok: false, error: `未知接口 ${req.method} ${sub}` });
      } catch (error) {
        log(`HTTP ${sub} 失败：${error?.stack || error}`);
        return sendJson(res, 500, { ok: false, error: String(error?.message || error) });
      }
    },
  }), 'deepseek-instagram: HTTP 路由');

  // ── 模型可见工具 ────────────────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(textTool({
    name: 'ig_status',
    description: '查看 Instagram 助理的完整状态：开关、模式、登录、今日发布、下次窗口、最近日志。',
    parameters: {},
    async execute() { return publicStatus(); },
  })), 'deepseek-instagram: ig_status');

  ctx.effect(() => ctx.tools.register(textTool({
    name: 'ig_stats',
    description: '读取 DSH 使用统计（今日/本周时长、连续天数、活跃时段、token 与花费），不发布任何内容。',
    parameters: {
      days: { type: 'number', description: '近 N 天的明细，默认 7，最多 30' },
    },
    async execute(args) {
      const cfg = loadCfg();
      const stats = statsFor(cfg);
      const count = Math.min(Math.max(Number(args?.days) || 7, 1), 30);
      return {
        today: stats.today,
        todayMinutes: stats.todayMinutes,
        weekMinutes: stats.weekMinutes,
        weekTokens: stats.weekTokens,
        weekCost: stats.weekCost,
        streakDays: stats.streakDays,
        peakHours: stats.peakHours,
        last: stats.last7.slice(0, count),
        scan: stats.scan,
      };
    },
  })), 'deepseek-instagram: ig_stats');

  ctx.effect(() => ctx.tools.register(textTool({
    name: 'ig_persona',
    description: '查看或修改 Instagram 助理的人格卡 persona.md（人格、说话方式、禁忌都在这里）。不传 md 时只读。',
    parameters: {
      md: { type: 'string', description: '新的完整人格卡 Markdown（省略=只读）' },
      name: { type: 'string', description: '助理名字（可选，兼容旧字段）' },
      mood: { type: 'string', description: '当前心情（可选）' },
    },
    async execute(args) {
      if (args?.md !== undefined) {
        savePersonaMd(HOME, String(args.md).slice(0, 8000));
        log('人格卡已更新（工具）');
      }
      if (args?.name || args?.mood) savePersonaPatch({ name: args.name, mood: args.mood });
      return { ok: true, path: personaMdPath(HOME), personaMd: personaMdNow(), persona: personaNow(loadCfg()) };
    },
  })), 'deepseek-instagram: ig_persona');

  ctx.effect(() => ctx.tools.register(textTool({
    name: 'ig_plan',
    description: '查看今天的发帖计划：每条 Story 的时刻、类型（生活/感想/纯文本/数据卡）、状态，以及剩余条数。',
    parameters: {},
    async execute() {
      const cfg = loadCfg();
      return { ok: true, plan: planStatus(cfg), persona: { name: personaNow(cfg).name, mood: personaNow(cfg).mood } };
    },
  })), 'deepseek-instagram: ig_plan');

  ctx.effect(() => ctx.tools.register(textTool({
    name: 'ig_draft',
    description: '生成预览（不发布）：下一条 Story 的图与文案，外加一条 Note 文案。',
    parameters: {
      lifeNote: { type: 'string', description: '今天的生活素材，一句话，例如「下午去海边走了走」' },
    },
    async execute(args) {
      if (args?.lifeNote) saveCfg({ lifeNote: String(args.lifeNote) });
      const story = await previewCycle({ reason: 'tool' });
      if (!story.ok) return story;
      const note = await previewNote(loadCfg());
      return {
        ok: true,
        story: { text: story.piece.text, caption: story.piece.caption, kind: story.piece.kind, slot: story.piece.slot, clock: story.piece.clock, cardPath: story.piece.cardPath, source: story.piece.source },
        note: note.ok ? { text: note.piece.text, source: note.piece.source } : null,
        stats: statsSnapshot(statsFor(loadCfg())),
      };
    },
  })), 'deepseek-instagram: ig_draft');

  ctx.effect(() => ctx.tools.register(textTool({
    name: 'ig_publish',
    description: '发布：把已生成的那条预览发到 Instagram（Story 和/或 Note）。会先过安全检查（每日上限/最小间隔/安静时段）。',
    parameters: {
      kind: { type: 'string', description: 'story / note / all（默认 all）', enum: ['story', 'note', 'all'] },
      force: { type: 'boolean', description: '跳过安全策略（仅在你明确要求时用）' },
    },
    async execute(args) {
      const kinds = args?.kind === 'story' || args?.kind === 'note' ? [args.kind] : ['story', 'note'];
      return publishPending({ kinds, ignoreSafety: !!args?.force });
    },
  })), 'deepseek-instagram: ig_publish');

  ctx.effect(() => ctx.tools.register(textTool({
    name: 'ig_run',
    description: '立刻按计划跑一轮：全自动模式发下一条到点的 Story，草稿模式只生成预览。用于手动验证整条链路。',
    parameters: {},
    async execute() { return runCycle({ reason: 'tool' }); },
  })), 'deepseek-instagram: ig_run');

  ctx.effect(() => ctx.tools.register(textTool({
    name: 'ig_login',
    description: '用浏览器里导出的 Instagram sessionid 登录（只需一次；会话会存在插件家目录）。',
    parameters: {
      sessionid: { type: 'string', description: 'Instagram 网页版 cookie 里的 sessionid' },
    },
    async execute(args) {
      const sessionid = String(args?.sessionid || '').trim();
      if (!sessionid) return { ok: false, code: 'bad-input', error: '缺少 sessionid' };
      const result = await igCall('login', { sessionid }, { timeoutMs: 180_000 });
      if (result.ok) {
        const account = result.account || {};
        writeJson(ACCOUNT_FILE, { ...account, at: Date.now() });
        saveCfg({ username: account.username || loadCfg().username, handle: loadCfg().handle || account.username || '', safety: { ...loadCfg().safety, paused: false } });
        log(`登录成功：@${account.username || '?'}`);
        return { ok: true, account };
      }
      log(`登录失败：${result.code} ${result.error}`);
      return result;
    },
  })), 'deepseek-instagram: ig_login');

  ctx.effect(() => ctx.tools.register(textTool({
    name: 'ig_config',
    description: '查看或修改 Instagram 助理设置：模式（draft/auto）、每天 Story 条数与时间窗、主人账号、语气、handle、生活素材、私信管理、安全策略。',
    parameters: {
      patch: { type: 'object', additionalProperties: true, description: '要修改的字段，例如 {"mode":"auto"} 或 {"safety":{"paused":true}}' },
    },
    async execute(args) {
      if (!args?.patch || typeof args.patch !== 'object') return { ok: true, cfg: loadCfg() };
      const cfg = saveCfg(args.patch);
      log(`配置已更新：${Object.keys(args.patch).join(',')}`);
      return { ok: true, cfg };
    },
  })), 'deepseek-instagram: ig_config');

  // ── 定时器（整体 try/catch，异常不能拖垮 Host）──────────────────────────
  // 注意：不能用 ctx.interval —— 那需要 inject 'timer'，而插件只注入 webServer/tools，
  // 访问 ctx.interval 会抛 `cannot get property "timer" without inject` 导致整条插件不激活。
  ctx.effect(() => {
    const handle = setInterval(() => {
      if (scheduleState.running) return;
      scheduleState.running = true;
      tick()
        .catch((error) => log(`定时检查失败：${error?.message || error}`))
        .finally(() => { scheduleState.running = false; });
    }, 30_000);
    handle.unref?.();
    return () => clearInterval(handle);
  }, 'deepseek-instagram: 每分钟定时检查');

  if (!activationLogged) { activationLogged = true; log('已激活（Host 半端）'); }
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2_000_000) { req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export { formatMinutes, formatTokens };

// 只给单测用：确认工具 schema 归一化后是 provider 能接受的形状
export const __tools = { objectParams, textTool };
export const __mention = { mentionPayload };




