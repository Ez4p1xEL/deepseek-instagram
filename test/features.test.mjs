import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTO_REPLY_MODES,
  normalizeAutoReply,
  autoReplyAllowed,
  shouldNotifyOwner,
  markNotified,
  NOTIFY_COOLDOWN_MS,
  remoteControlAllowed,
  publishAllowed,
} from '../lib/features.mjs';

test('normalizeAutoReply：只认四档，其余一律回 off', () => {
  assert.deepEqual([...AUTO_REPLY_MODES], ['off', 'all', 'mutual', 'follower']);
  assert.equal(normalizeAutoReply('all'), 'all');
  assert.equal(normalizeAutoReply('mutual'), 'mutual');
  assert.equal(normalizeAutoReply('follower'), 'follower');
  assert.equal(normalizeAutoReply('off'), 'off');
  assert.equal(normalizeAutoReply(''), 'off');
  assert.equal(normalizeAutoReply('everyone'), 'off');
  assert.equal(normalizeAutoReply(null), 'off');
});

test('autoReplyAllowed：off 永不回、all 无条件回', () => {
  assert.equal(autoReplyAllowed('off', { following: true, followedBy: true }), false);
  assert.equal(autoReplyAllowed('all', null), true);
  assert.equal(autoReplyAllowed('all', { following: false, followedBy: false }), true);
});

test('autoReplyAllowed：仅互关要求双向关注', () => {
  assert.equal(autoReplyAllowed('mutual', { following: true, followedBy: true }), true);
  assert.equal(autoReplyAllowed('mutual', { following: false, followedBy: true }), false);
  assert.equal(autoReplyAllowed('mutual', { following: true, followedBy: false }), false);
  assert.equal(autoReplyAllowed('mutual', null), false);
});

test('autoReplyAllowed：未被关注不回复 = 对方关注我就回（单向即可）', () => {
  assert.equal(autoReplyAllowed('follower', { following: false, followedBy: true }), true);
  assert.equal(autoReplyAllowed('follower', { following: true, followedBy: true }), true);
  assert.equal(autoReplyAllowed('follower', { following: true, followedBy: false }), false);
  assert.equal(autoReplyAllowed('follower', { followedBy: false }), false);
  assert.equal(autoReplyAllowed('follower', null), false);
  assert.equal(autoReplyAllowed('未知档', { following: true, followedBy: true }), false);
});

test('shouldNotifyOwner / markNotified：同一人 30 分钟内只提醒一次', () => {
  const now = 1793000000000;
  let state = {};
  assert.equal(shouldNotifyOwner(state, '42', now), true);
  state = markNotified(state, '42', now);
  assert.equal(shouldNotifyOwner(state, '42', now + 1000), false);
  assert.equal(shouldNotifyOwner(state, '42', now + NOTIFY_COOLDOWN_MS - 1), false);
  assert.equal(shouldNotifyOwner(state, '42', now + NOTIFY_COOLDOWN_MS + 1), true);
  // 换一个人不受影响
  assert.equal(shouldNotifyOwner(state, '43', now + 1000), true);
  // 坏时间戳当从没提醒过
  assert.equal(shouldNotifyOwner({ notifyLast: { 42: 'oops' } }, '42', now), true);
  assert.equal(shouldNotifyOwner(null, '42', now), true);
});

test('remoteControlAllowed：私信总开关与远程控制开关都开才放行', () => {
  assert.equal(remoteControlAllowed({ dm: { enabled: true, intents: true } }), true);
  assert.equal(remoteControlAllowed({ dm: { enabled: true, intents: false } }), false);
  assert.equal(remoteControlAllowed({ dm: { enabled: false, intents: true } }), false);
  assert.equal(remoteControlAllowed({ dm: {} }), true);
  assert.equal(remoteControlAllowed({}), true);
});

test('publishAllowed：只拦自动调度，缺字段按开处理', () => {
  assert.equal(publishAllowed({ enabled: true, publish: { story: true, note: true } }, 'story'), true);
  assert.equal(publishAllowed({ enabled: true, publish: { story: false, note: true } }, 'story'), false);
  assert.equal(publishAllowed({ enabled: true, publish: { story: false, note: true } }, 'note'), true);
  assert.equal(publishAllowed({ enabled: true }, 'story'), true);
  assert.equal(publishAllowed({ enabled: false, publish: { story: true } }, 'story'), false);
  assert.equal(publishAllowed({ enabled: true, publish: { note: false } }, 'note'), false);
});
