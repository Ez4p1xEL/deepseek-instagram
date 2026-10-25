import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, keywordAction, parseIntent, intentPrompt, confirmWord, cancelWord, needsConfirm,
} from '../lib/actions.mjs';

// 用户原话（2026-10-25）：发「回复一下你未读的私信内容」，助理当成闲聊回了
// 「刚才那句我这边没接住，群里是空的」—— 那条消息必须被识别成动作。
test('the exact sentence the owner sent maps to reply_unread', () => {
  const a = keywordAction('回复一下你未读的私信内容');
  assert.equal(a?.action, 'reply_unread');
  assert.equal(a.via, 'keyword');
});

test('existing narrow commands still win the keyword fast path', () => {
  assert.equal(keywordAction('查看你最近的运行日志')?.action, 'log');
  assert.equal(keywordAction('暂停')?.action, 'pause');
  assert.equal(keywordAction('发一条')?.action, 'story');
  assert.equal(keywordAction('随便聊聊'), null);
  assert.equal(keywordAction(''), null);
});

test('parseIntent accepts only whitelisted actions', () => {
  const ok = parseIntent('```json\n{"action":"dsh_task","args":{"task":"跑一下测试"}}\n```');
  assert.equal(ok.action, 'dsh_task');
  assert.equal(ok.args.task, '跑一下测试');
  assert.equal(ok.via, 'llm');

  assert.equal(parseIntent('{"action":"rm_rf"}'), null);
  assert.equal(parseIntent('不是 JSON'), null);
  assert.equal(parseIntent('{"action":"none"}'), null);
  assert.equal(parseIntent('{"action":"dsh_task","args":{"task":"   "}}'), null);
  assert.equal(parseIntent('{"action":"run_command","args":{"command":""}}'), null);
});

test('reply_unread limit is clamped to 1..5 and defaults to 3', () => {
  assert.equal(parseIntent('{"action":"reply_unread","args":{"limit":99}}').args.limit, 5);
  assert.equal(parseIntent('{"action":"reply_unread","args":{"limit":0}}').args.limit, 1);
  assert.equal(parseIntent('{"action":"reply_unread"}').args.limit, 3);
});

test('long task / command text is clamped, quotes survive', () => {
  const long = 'a'.repeat(900);
  assert.equal(parseIntent(JSON.stringify({ action: 'run_command', args: { command: long } })).args.command.length, 500);
  assert.equal(parseIntent('{"action":"dsh_task","args":{"task":"跑 \\"npm test\\""}}').args.task, '跑 "npm test"');
});

test('confirm / cancel words', () => {
  assert.equal(confirmWord('发'), true);
  assert.equal(confirmWord('发送！'), true);
  assert.equal(confirmWord('确认'), true);
  assert.equal(confirmWord('好'), true);
  assert.equal(confirmWord('取消'), false);
  assert.equal(cancelWord('取消'), true);
  assert.equal(cancelWord('算了'), true);
  assert.equal(cancelWord('停'), true);
  assert.equal(cancelWord('发'), false);
});

test('only side-effecting actions need confirmation', () => {
  assert.equal(needsConfirm('reply_unread'), true);
  assert.equal(needsConfirm('dsh_task'), true);
  assert.equal(needsConfirm('run_command'), true);
  assert.equal(needsConfirm('status'), false);
  assert.equal(needsConfirm('story'), false);
  assert.equal(needsConfirm('nope'), false);
});

test('intent prompt lists every action and the JSON contract', () => {
  const prompt = intentPrompt({ text: '回复一下你未读的私信内容' });
  for (const name of Object.keys(ACTIONS)) {
    assert.match(prompt.user, new RegExp(name), `intent prompt should mention ${name}`);
  }
  assert.match(prompt.user, /回复一下你未读的私信内容/);
  assert.match(prompt.user, /"action"/);
  assert.match(prompt.system, /JSON/);
});
