import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideMessage, groupDecision, isOwnerSender, normalizeCommand, parseCommand,
} from '../lib/commands.mjs';

const ownerPk = '12345678';

test('normalizeCommand strips spaces, punctuation and emoji', () => {
  assert.equal(normalizeCommand(' 发一条！ 🎉'), '发一条');
  assert.equal(normalizeCommand('发 Note。'), '发note');
});

test('parseCommand recognises the narrow command set', () => {
  const cases = {
    状态: 'status',
    暂停: 'pause',
    恢复: 'resume',
    '发一条': 'story',
    发note: 'note',
    草稿: 'draft',
    自动: 'auto',
    帮助: 'help',
    'Pause': 'pause',
    '来一条 story': 'unknown',
    '查看你最近的运行日志': 'log',
    '查看最近运行日志': 'log',
    '最近怎么样': 'status',
    '在干嘛': 'status',
    '@imnotp1xel 查看最近运行日志': 'log',
    '@imnotp1xel 状态': 'status',
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(parseCommand(input).cmd, expected, `${input} -> ${parseCommand(input).cmd}`);
  }
  assert.equal(parseCommand('随便说点什么').cmd, 'unknown');
  assert.equal(parseCommand('').cmd, 'unknown');
});

test('isOwnerSender compares ids only, never names', () => {
  assert.equal(isOwnerSender({ userId: ownerPk, ownerPk }), true);
  assert.equal(isOwnerSender({ userId: 12345678, ownerPk }), true);
  assert.equal(isOwnerSender({ userId: '999', ownerPk }), false);
  assert.equal(isOwnerSender({ userId: '1234', ownerPk: '' }), false);
});

test('decideMessage executes owner commands only', () => {
  const ok = decideMessage({ id: 'm1', userId: ownerPk, text: '暂停' }, { ownerPk });
  assert.equal(ok.execute, true);
  assert.equal(ok.cmd, 'pause');

  const stranger = decideMessage({ id: 'm2', userId: '999', text: '暂停' }, { ownerPk });
  assert.equal(stranger.execute, false);
  assert.equal(stranger.reason, 'not-owner');
});

test('decideMessage ignores unknown commands and repeated ids', () => {
  assert.equal(decideMessage({ id: 'm3', userId: ownerPk, text: '随便发点' }, { ownerPk }).reason, 'unknown-command');
  assert.equal(decideMessage({ id: 'm1', userId: ownerPk, text: '暂停' }, { ownerPk, lastHandledId: 'm1' }).reason, 'already-handled');
});

test('groupDecision only answers groups the owner is in', () => {
  const base = { cfg: { ownerPk: '1', username: 'imnotp1xel', group: { mode: 'mention' } }, message: { isGroup: true, text: '@imnotp1xel 在吗', threadId: 't1' }, state: {}, hourKey: 'h1' }
  assert.equal(groupDecision({ ...base, threadRow: { memberPks: ['1', '2'] } }).reason, 'ok')
  assert.equal(groupDecision({ ...base, threadRow: { memberPks: ['2'] } }).reason, 'owner-not-in-group')
  assert.equal(groupDecision({ ...base, threadRow: null }).reason, 'owner-not-in-group')
})

test('groupDecision respects mention mode, cooldown and hourly cap', () => {
  const args = { cfg: { ownerPk: '1', username: 'imnotp1xel' }, threadRow: { memberPks: ['1'] }, message: { isGroup: true, text: '随便说一句', threadId: 't1' }, state: {}, hourKey: 'h1' }
  assert.equal(groupDecision(args).reason, 'not-mentioned')
  assert.equal(groupDecision({ ...args, message: { ...args.message, text: '小 p 你怎么看' } }).reason, 'ok')
  assert.equal(groupDecision({ ...args, message: { ...args.message, text: '@imnotp1xel 在吗' }, state: { groupLast: { t1: 1000 } }, now: 5000 }).reason, 'group-cooldown')
  assert.equal(groupDecision({ ...args, message: { ...args.message, text: '@imnotp1xel 在吗' }, state: { groupHour: { key: 'h1', count: 8 } }, hourKey: 'h1' }).reason, 'group-hourly-cap')
  assert.equal(groupDecision({ ...args, cfg: { ...args.cfg, group: { enabled: false } } }).reason, 'group-disabled')
})
