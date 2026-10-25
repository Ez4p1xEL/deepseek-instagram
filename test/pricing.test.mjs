import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isPeakTime, costCny, formatCny } from '../lib/pricing.mjs';

// 北京时间 → epoch 秒（北京固定 UTC+8，与是否夏令时无关）
const bj = (y, m, d, h, min = 0) => Date.UTC(y, m - 1, d, h - 8, min, 0) / 1000;

test('Flash 谷价：未命中 ¥1 / 命中 ¥0.02 / 输出 ¥4（每百万 tokens）', () => {
  const ts = bj(2026, 10, 26, 22); // 周一 22:00，谷
  assert.equal(isPeakTime(ts), false);
  assert.equal(costCny({ model: 'deepseek-flash', inputTokens: 1_000_000, ts }), 1);
  assert.equal(costCny({ model: 'deepseek-flash', cacheReadTokens: 1_000_000, ts }), 0.02);
  assert.equal(costCny({ model: 'deepseek-flash', outputTokens: 1_000_000, ts }), 4);
});

test('高峰时段翻倍', () => {
  const ts = bj(2026, 10, 26, 10); // 周一 10:00，高峰
  assert.equal(isPeakTime(ts), true);
  assert.equal(costCny({ model: 'deepseek-flash', inputTokens: 1_000_000, ts }), 2);
  assert.equal(costCny({ model: 'deepseek-flash', outputTokens: 1_000_000, ts }), 8);
  assert.equal(costCny({ model: 'deepseek-flash', cacheReadTokens: 1_000_000, ts }), 0.04);
});

test('峰谷边界：11:59 峰、12:00 谷、14:00 峰、18:00 谷', () => {
  assert.equal(isPeakTime(bj(2026, 10, 26, 11, 59)), true);
  assert.equal(isPeakTime(bj(2026, 10, 26, 12, 0)), false);
  assert.equal(isPeakTime(bj(2026, 10, 26, 14, 0)), true);
  assert.equal(isPeakTime(bj(2026, 10, 26, 18, 0)), false);
  assert.equal(isPeakTime(bj(2026, 10, 26, 9, 0)), true);
});

test('周末与法定节假日全天谷价', () => {
  assert.equal(isPeakTime(bj(2026, 10, 25, 10)), false); // 周日
  assert.equal(isPeakTime(bj(2026, 10, 1, 10)), false); // 国庆
  assert.equal(isPeakTime(bj(2026, 10, 9, 10)), true); // 周五工作日
});

test('Pro 价、未知模型回退 Flash、小额按比例', () => {
  const ts = bj(2026, 10, 26, 22);
  assert.equal(costCny({ model: 'deepseek-v4-pro', outputTokens: 1_000_000, ts }), 13.5);
  assert.equal(costCny({ model: 'deepseek-v4-pro', inputTokens: 1_000_000, ts }), 4.5);
  assert.equal(costCny({ model: 'some-unknown-model', inputTokens: 1_000_000, ts }), 1);
  assert.equal(costCny({ model: 'deepseek-flash', inputTokens: 1234, ts }), 0.001234);
  assert.equal(costCny({ model: 'deepseek-flash', ts }), 0);
});

test('金额格式化', () => {
  assert.equal(formatCny(0.001234), '¥0.0012');
  assert.equal(formatCny(0.5), '¥0.500');
  assert.equal(formatCny(1.5), '¥1.50');
  assert.equal(formatCny(0), '¥0.00');
  assert.equal(formatCny(12.3456), '¥12.35');
});
