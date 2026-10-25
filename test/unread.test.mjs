import test from 'node:test';
import assert from 'node:assert/strict';
import { pickUnreadDm } from '../lib/unread.mjs';

const ownerPk = '111';
const selfPk = '222';
const now = Date.parse('2026-10-25T22:00:00Z');

function msg(threadId, userId, text, ts, extra = {}) {
  return { threadId, userId, username: `u${userId}`, text, timestamp: ts, isGroup: false, ...extra };
}

const threadRows = [
  { id: 't1', isGroup: false, title: 'lily', memberPks: ['333'] },
  { id: 't2', isGroup: false, title: 'bob', memberPks: ['444'] },
  { id: 't3', isGroup: true, title: '群', memberPks: ['333', ownerPk] },
  { id: 't4', isGroup: false, title: '主人', memberPks: [ownerPk] },
];

test('keeps 1:1 threads whose last message is from the other side', () => {
  const messages = [
    msg('t1', '333', '在吗', now - 60_000),
    msg('t2', '444', 'hi', now - 120_000),
    msg('t2', selfPk, '你好呀', now - 60_000), // 我最后回的 → 已回
    msg('t3', '333', '群里说话', now - 30_000),
    msg('t4', ownerPk, '主人私信', now - 30_000),
  ];
  const out = pickUnreadDm({ messages, threadRows, selfPk, ownerPk, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].threadId, 't1');
  assert.equal(out[0].incoming, '在吗');
  assert.equal(out[0].username, 'u333');
});

test('newest first and capped by limit', () => {
  const messages = [];
  for (let i = 1; i <= 8; i += 1) {
    messages.push(msg(`x${i}`, `${500 + i}`, `hi ${i}`, now - i * 60_000));
  }
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `x${i + 1}`, isGroup: false, title: `t${i + 1}`, memberPks: [`${501 + i}`] }));
  const out = pickUnreadDm({ messages, threadRows: rows, selfPk, ownerPk, limit: 3, now });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((x) => x.threadId), ['x1', 'x2', 'x3']);
});

test('skips messages older than 72h and already-answered watermarks', () => {
  const messages = [
    msg('old', '555', '老消息', now - 100 * 3600_000),
    msg('done', '666', '回过了', now - 60_000),
  ];
  const rows = [
    { id: 'old', isGroup: false, memberPks: ['555'] },
    { id: 'done', isGroup: false, memberPks: ['666'] },
  ];
  const out = pickUnreadDm({
    messages,
    threadRows: rows,
    selfPk,
    ownerPk,
    now,
    replied: { done: now - 60_000 },
  });
  assert.equal(out.length, 0);
});

test('a newer message reopens a thread that was replied to before', () => {
  const messages = [
    msg('t', '777', '第一句', now - 120_000),
    msg('t', '777', '第二句', now - 30_000),
  ];
  const rows = [{ id: 't', isGroup: false, memberPks: ['777'] }];
  const out = pickUnreadDm({ messages, threadRows: rows, selfPk, ownerPk, now, replied: { t: now - 120_000 } });
  assert.equal(out.length, 1);
  assert.equal(out[0].incoming, '第二句');
});

test('empty text is ignored when picking the last message', () => {
  const messages = [
    msg('t', '888', '有字', now - 60_000),
    msg('t', '888', '', now - 30_000),
  ];
  const rows = [{ id: 't', isGroup: false, memberPks: ['888'] }];
  const out = pickUnreadDm({ messages, threadRows: rows, selfPk, ownerPk, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].incoming, '有字');
});
