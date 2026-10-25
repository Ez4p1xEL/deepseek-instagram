// 并发闸：同一条消息被回两遍（一次模型、一次兜底句）的回归测试。
// dmPoll 会被定时器、POST /api/deepseek-instagram/dm、登录回调同时调用；
// 两轮同时跑会读到同一个 lastHandledTs，于是同一条消息被处理两次。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from '../lib/singleflight.mjs';

test('a second concurrent call is skipped instead of double-replying', async () => {
  const run = singleFlight();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let firstRan = false;
  const first = run(async () => { await gate; firstRan = true; return { ok: true, handled: 1 }; });
  const second = await run(async () => ({ ok: true, handled: 99 }));
  assert.deepEqual(second, { ok: true, skipped: 'busy' });
  release();
  assert.deepEqual(await first, { ok: true, handled: 1 });
  assert.equal(firstRan, true);
  // 上一轮结束后要能继续跑，不能永久锁死
  assert.deepEqual(await run(async () => ({ ok: true, handled: 2 })), { ok: true, handled: 2 });
});

test('a throwing run releases the gate', async () => {
  const run = singleFlight();
  await assert.rejects(run(async () => { throw new Error('boom'); }), /boom/);
  assert.deepEqual(await run(async () => ({ ok: true })), { ok: true });
});
