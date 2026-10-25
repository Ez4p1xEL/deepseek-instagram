// 回复上下文的回归测试。
//
// 2026-10-25「答非所问」事故：私信/群聊的提示词里没有要回的那句话，模型拿人格记忆跑题。
// 群聊历史是 index.js 里拼的，规则是「同会话、早于这条、有文本、只留最近 N 条」，
// 而且助理自己发出去的消息（username 为空、userId 是账号 pk）必须标成「我」，
// 否则模型会把自己的话当成别人说的，接着自己往下说。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threadHistory } from '../index.js';

const SELF_PK = '73350220592';
const OWNER_PK = '55481990985';

const messages = [
  { threadId: 't1', timestamp: 100, userId: OWNER_PK, username: 'ez4p1xel', text: '帮我看看运行时间' },
  { threadId: 't1', timestamp: 200, userId: SELF_PK, username: '', text: '运行时间这个我不往外报。' },
  { threadId: 't1', timestamp: 300, userId: OWNER_PK, username: 'ez4p1xel', text: '抽耳機' },
  { threadId: 't2', timestamp: 350, userId: '42', username: 'other', text: '另一个会话的消息' },
  { threadId: 't1', timestamp: 400, userId: OWNER_PK, username: 'ez4p1xel', text: '评价一下 @_john1210_ 这个人' },
];

test('threadHistory keeps only earlier messages of the same thread', () => {
  const history = threadHistory(messages, messages[4], 6, SELF_PK);
  assert.deepEqual(history.map((m) => m.text), [
    '帮我看看运行时间',
    '运行时间这个我不往外报。',
    '抽耳機',
  ]);
});

test('threadHistory labels the assistant own messages as 我', () => {
  const history = threadHistory(messages, messages[4], 6, SELF_PK);
  assert.equal(history[1].from, '我');
  assert.equal(history[0].from, 'ez4p1xel');
});

test('threadHistory respects the limit and keeps the newest ones', () => {
  const history = threadHistory(messages, messages[4], 2, SELF_PK);
  assert.deepEqual(history.map((m) => m.text), ['运行时间这个我不往外报。', '抽耳機']);
});

test('threadHistory drops textless messages and is empty for the first message', () => {
  const withEmpty = [
    { threadId: 't9', timestamp: 10, userId: OWNER_PK, username: 'a', text: '' },
    { threadId: 't9', timestamp: 20, userId: OWNER_PK, username: 'a', text: '第二句' },
    { threadId: 't9', timestamp: 30, userId: OWNER_PK, username: 'a', text: '第三句' },
  ];
  const history = threadHistory(withEmpty, withEmpty[2], 6, SELF_PK);
  assert.deepEqual(history.map((m) => m.text), ['第二句']);
  assert.deepEqual(threadHistory(withEmpty, withEmpty[0], 6, SELF_PK), []);
});

test('threadHistory works without a known self pk', () => {
  const history = threadHistory(messages, messages[4], 6, '');
  assert.equal(history[1].from, String(SELF_PK));
});
