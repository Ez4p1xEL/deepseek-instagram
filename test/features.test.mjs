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
  fullAccessAllowed,
  normalizeCooldownSeconds,
  dmCooldownMs,
  dmCooldownReady,
  markDmReply,
  DM_COOLDOWN_DEFAULT_S,
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

test('normalizeCooldownSeconds：默认 30、支持 0、夹在 0..3600', () => {
  assert.equal(DM_COOLDOWN_DEFAULT_S, 30);
  assert.equal(normalizeCooldownSeconds(undefined), 30);
  assert.equal(normalizeCooldownSeconds(null), 30);
  assert.equal(normalizeCooldownSeconds(''), 30);
  assert.equal(normalizeCooldownSeconds('oops'), 30);
  assert.equal(normalizeCooldownSeconds('45'), 45);
  assert.equal(normalizeCooldownSeconds(0), 0);
  assert.equal(normalizeCooldownSeconds(-5), 0);
  assert.equal(normalizeCooldownSeconds(99999), 3600);
  assert.equal(normalizeCooldownSeconds(12.6), 13);
  // 配置读取：缺字段就是 30 秒
  assert.equal(dmCooldownMs({}), 30_000);
  assert.equal(dmCooldownMs({ dm: {} }), 30_000);
  assert.equal(dmCooldownMs({ dm: { cooldownSeconds: 0 } }), 0);
  assert.equal(dmCooldownMs({ dm: { cooldownSeconds: 90 } }), 90_000);
});

test('dmCooldownReady：同一会话按冷却挡，不同会话互不影响', () => {
  const now = 1793000000000;
  assert.equal(dmCooldownReady({}, 't1', now, 30_000), true);
  const state = markDmReply({}, 't1', now);
  assert.equal(dmCooldownReady(state, 't1', now + 1000, 30_000), false);
  assert.equal(dmCooldownReady(state, 't1', now + 29_999, 30_000), false);
  assert.equal(dmCooldownReady(state, 't1', now + 30_000, 30_000), true);
  assert.equal(dmCooldownReady({ ...state, replyLast: {} }, 't1', now + 1000, 30_000), true);
  // 不同会话：互不影响
  assert.equal(dmCooldownReady(state, 't2', now + 1000, 30_000), true);
  // 0 秒 = 不冷却
  assert.equal(dmCooldownReady(state, 't1', now, 0), true);
  // 旧字段 strangerLast 也认（升级前的状态文件）
  const legacy = { strangerLast: { t3: now } };
  assert.equal(dmCooldownReady(legacy, 't3', now + 1000, 30_000), false);
  // markDmReply 不改原对象
  const base = {};
  const marked = markDmReply(base, 't4', now);
  assert.equal(base.replyLast, undefined);
  assert.equal(marked.replyLast.t4, now);
  assert.equal(state.replyLast.t1, now);
});

// 「完全权限」只对让电脑干活的两类动作生效；默认关，且绝不能因为字段缺失/损坏而放开。
test('fullAccessAllowed：只放开 run_command / dsh_task，且默认关', () => {
  assert.equal(fullAccessAllowed({}, 'run_command'), false);
  assert.equal(fullAccessAllowed({ dm: {} }, 'dsh_task'), false);
  assert.equal(fullAccessAllowed({ dm: { fullAccess: false } }, 'run_command'), false);
  assert.equal(fullAccessAllowed({ dm: { fullAccess: 'true' } }, 'run_command'), false);
  assert.equal(fullAccessAllowed({ dm: { fullAccess: true } }, 'run_command'), true);
  assert.equal(fullAccessAllowed({ dm: { fullAccess: true } }, 'dsh_task'), true);
  // 对外动作不放开
  assert.equal(fullAccessAllowed({ dm: { fullAccess: true } }, 'reply_unread'), false);
  assert.equal(fullAccessAllowed({ dm: { fullAccess: true } }, 'story'), false);
  // 私信总开关/远程控制关掉时，完全权限也失效
  assert.equal(fullAccessAllowed({ dm: { fullAccess: true, enabled: false } }, 'run_command'), false);
  assert.equal(fullAccessAllowed({ dm: { fullAccess: true, intents: false } }, 'dsh_task'), false);
});
