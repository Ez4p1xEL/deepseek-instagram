import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadPersona, parseReply, remember, savePersona, setMood, systemPrompt, storyBrief, noteBrief, recentMemories,
  loadPersonaMd, savePersonaMd, parsePersonaMd, groupPrompt, PERSONA_MD_DEFAULT, applyPersonaPatch,
} from '../lib/persona.mjs';

const cfg = { owner: 'ez4p1xel', username: 'imnotp1xel', assistantName: '小 p' };

test('persona survives a save/load round trip and remembers entries', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-'));
  const p0 = loadPersona(home, cfg);
  assert.equal(p0.version, 1);
  const p1 = remember(p0, { at: 1000, slot: '2026-10-25#0', kind: 'thought', text: '今天有点安静' });
  savePersona(home, p1);
  const p2 = loadPersona(home, cfg);
  assert.equal(p2.memories.length, 1);
  assert.equal(p2.memories[0].text, '今天有点安静');
  assert.equal(recentMemories(p2, 5).length, 1);
});

test('memories are capped and newest first', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-'));
  let p = loadPersona(home, cfg);
  for (let i = 0; i < 80; i += 1) p = remember(p, { at: i, kind: 'life', text: `第 ${i} 条` });
  assert.equal(p.memories.length, 60);
  assert.equal(p.memories[0].text, '第 79 条');
});

test('system prompt carries owner, assistant identity, mood and memories', () => {
  let p = loadPersona(fs.mkdtempSync(path.join(os.tmpdir(), 'persona-')), cfg);
  p = remember(p, { at: Date.parse('2026-10-24T12:00:00Z'), kind: 'thought', text: '等主人回来' });
  p = setMood(p, { label: '耐心', note: '今天很慢' });
  const prompt = systemPrompt({ cfg, persona: p });
  assert.match(prompt, /@ez4p1xel/);
  assert.match(prompt, /@imnotp1xel/);
  assert.match(prompt, /AI/);
  assert.match(prompt, /耐心/);
  assert.match(prompt, /等主人回来/);
  assert.match(prompt, /JSON/);
});

test('story brief mentions the kind, stats and the life note', () => {
  const brief = storyBrief({
    kind: 'life',
    cfg,
    persona: { memories: [] },
    stats: { todayLabel: '4 小时 26 分', weekLabel: '16 小时 39 分', streakDays: 5, peakHours: [{ hour: 3 }] },
    life: '下午去海边走了走',
    clock: '10 月 25 日 21:00',
  });
  assert.match(brief, /生活/);
  assert.match(brief, /海边/);
  assert.match(brief, /4 小时 26 分/);
  assert.match(brief, /21:00/);
});

test('note brief warns about the 60 character limit', () => {
  assert.match(noteBrief({ cfg, stats: { todayLabel: '1 小时', streakDays: 2 } }), /60/);
});

test('parseReply accepts fenced JSON and keeps mood', () => {
  const raw = '```json\n{"text":"今天有点累","caption":"慢一点","mood":{"label":"疲惫"}}\n```';
  const out = parseReply(raw, { kind: 'thought' });
  assert.equal(out.text, '今天有点累');
  assert.equal(out.caption, '慢一点');
  assert.equal(out.mood.label, '疲惫');
  assert.equal(out.source, 'llm');
});

test('parseReply falls back to plain text and strips markdown', () => {
  const out = parseReply('**今天** #不是标签 挺好', { kind: 'life' });
  assert.equal(out.text, '今天 不是标签 挺好');
  assert.equal(out.source, 'llm');
});

test('parseReply falls back to a template when the model returns garbage', () => {
  const out = parseReply('{ 这不是 JSON', { kind: 'thought', stats: { streakDays: 3 } });
  assert.equal(out.source, 'template');
  assert.ok(out.text.length > 0);
});

test('over-long model text is clamped', () => {
  const out = parseReply(JSON.stringify({ text: '啊'.repeat(200) }), { kind: 'life', maxText: 20 });
  assert.equal(out.text.length, 20);
  assert.ok(out.text.endsWith('…'));
});

test('persona.md is seeded with a default card and can be saved/read back', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-md-'));
  const first = loadPersonaMd(home);
  assert.equal(first.isDefault, true);
  assert.match(first.md, /人格卡/);
  savePersonaMd(home, '# 我的人格\n名字：阿漏\n心情：好奇\n');
  const again = loadPersonaMd(home);
  assert.equal(again.isDefault, false);
  assert.match(again.md, /阿漏/);
});

test('persona.md wins over the built-in traits and carries its name', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-md-'));
  const p = loadPersona(home, cfg);
  const md = PERSONA_MD_DEFAULT.replace('名字：小 p', '名字：阿漏');
  const prompt = systemPrompt({ cfg, persona: p, personaMd: md });
  assert.match(prompt, /阿漏/);
  assert.match(prompt, /人格卡/);
  assert.match(prompt, /硬规则/);
  assert.doesNotMatch(prompt, /性格与写法：/);
});

test('parsePersonaMd reads name/mood/identity lines', () => {
  const out = parsePersonaMd('名字：阿漏\n心情：好奇\n身份：主人的小尾巴');
  assert.equal(out.name, '阿漏');
  assert.equal(out.mood, '好奇');
  assert.equal(out.identity, '主人的小尾巴');
});

test('group prompt forbids private stats and asks for plain short text', () => {
  const { system, user } = groupPrompt({
    cfg,
    persona: { memories: [] },
    history: [{ from: 'ez4p1xel', text: '今天怎么这么安静' }, { from: 'friend', text: '你主人呢' }],
    sender: 'friend',
    title: '周末小队',
    incoming: '你主人呢',
  });
  assert.match(system, /群聊/);
  assert.match(system, /私人数据/);
  assert.match(system, /不要 JSON/);
  assert.match(system, /只看「刚收到的一条」/);
  assert.match(user, /周末小队|最近的群聊/);
  assert.match(user, /friend/);
  assert.match(user, /刚收到的一条/);
});

// 「答非所问」事故回归：旧提示词只拼 history，从头到尾没有要回的那句话，
// 模型于是拿人格记忆（海边的风）和更早的「抽耳機」自顾自往下说。
test('the message being answered is carried into the prompt verbatim (dm, empty history)', () => {
  const incoming = '查看你最近的运行日志';
  const { system, user } = groupPrompt({
    cfg, persona: { memories: [] }, scene: 'dm', incoming, sender: 'ez4p1xel', title: '私信（主人）',
  });
  assert.match(user, /查看你最近的运行日志/);
  assert.match(user, /刚收到的一条/);
  assert.match(user, /回答「刚收到的一条」/);
  assert.match(system, /私信/);
  assert.match(system, /对方就是主人/);
  assert.doesNotMatch(system, /群聊/);
});

test('group incident: "@imnotp1xel 评价一下 @_john1210_ 这个人" is what gets answered', () => {
  const incoming = '@imnotp1xel 评价一下 @_john1210_ 这个人';
  const { user } = groupPrompt({
    cfg,
    persona: { memories: [] },
    scene: 'group',
    incoming,
    sender: 'ez4p1xel',
    title: 'Matthew Chan, …',
    history: [
      { from: 'ez4p1xel', text: '查看你最近的运行日志' },
      { from: '我', text: '运行时间这个我不往外报。' },
      { from: 'ez4p1xel', text: '抽耳機' },
    ],
  });
  assert.match(user, /评价一下 @_john1210_ 这个人/);
  // 历史只当背景，排在要回的那条前面
  assert.ok(user.indexOf('刚收到的一条') > user.indexOf('抽耳機'));
});

// 主人在私信里让助理「回未读私信」时，它是在跟陌生人说话 —— 不能把主人的隐私、
// 用量、路径、对话原文倒出去，也不能替主人承诺见面/转账/交易。
test('stranger scene never leaks the owner private data and refuses commitments', () => {
  const { system, user } = groupPrompt({
    cfg, persona: { memories: [] }, scene: 'stranger', incoming: '你主人是谁呀', sender: 'lily', title: '陌生私信',
  });
  assert.match(system, /陌生人/);
  assert.match(system, /不透露/);
  assert.match(system, /不承诺/);
  assert.doesNotMatch(system, /对方就是主人本人/);
  assert.match(user, /你主人是谁呀/);
  assert.match(user, /刚收到的一条/);
});

// 2026-10-26 实测：设置页改「名字」后保存，名字总被旧名字盖回去 —— 因为心情补丁用的是
// `Object.assign(next, setMood(旧persona, mood))`，把旧 persona 的 name/identity 一起赋回来了。
test('applyPersonaPatch: 改名字不会被心情补丁覆盖', () => {
  const base = {
    version: 1, name: '小 p', identity: 'id-原样',
    mood: { label: '平静', note: '', at: 1 }, memories: [], threads: [],
  };
  const next = applyPersonaPatch(base, { name: '  小 P  ', mood: { label: '困' } });
  assert.equal(next.name, '小 P');
  assert.equal(next.mood.label, '困');
  assert.equal(next.identity, 'id-原样');
  assert.equal(next.memories, base.memories);
  assert.equal(base.name, '小 p', '不得改原对象');
});

test('applyPersonaPatch: 接受字符串心情、空名字忽略、长度上限', () => {
  const base = { name: '小 p', identity: 'id', mood: { label: '平静', note: 'a', at: 1 }, memories: [], threads: [] };
  const next = applyPersonaPatch(base, { name: '', mood: '开心' });
  assert.equal(next.name, '小 p');
  assert.equal(next.mood.label, '开心');
  const long = applyPersonaPatch(base, { name: 'x'.repeat(30), identity: 'y'.repeat(200) });
  assert.equal(long.name.length, 20);
  assert.equal(long.identity.length, 120);
});

test('empty incoming falls back to answering the last line instead of an empty prompt', () => {
  const { user } = groupPrompt({ cfg, persona: { memories: [] }, history: [{ from: 'a', text: '在吗' }] });
  assert.match(user, /回应上面最后一句/);
  assert.doesNotMatch(user, /刚收到的一条/);
});
