import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMinutes, clampText, defaultNote, defaultStoryCaption, buildStoryCard } from '../lib/content.mjs';

const stats = {
  dateLabel: '10 月 25 日',
  weekday: '周六',
  todayMinutes: 133,
  weekMinutes: 512,
  streakDays: 7,
  todayTokens: 1280000,
  todayCost: 1.64,
  peakHours: [{ hour: 21, label: '晚上 9 点' }, { hour: 9, label: '早上 9 点' }],
  life: '下午去海边走了走',
};

test('formatMinutes renders chinese durations', () => {
  assert.equal(formatMinutes(0), '0 分钟');
  assert.equal(formatMinutes(9), '9 分钟');
  assert.equal(formatMinutes(60), '1 小时');
  assert.equal(formatMinutes(133), '2 小时 13 分');
});

test('clampText never exceeds the limit and keeps a short suffix', () => {
  assert.equal(clampText('abc', 10), 'abc');
  const long = '今天我用了很久的 DeepSeek Harness 写了一整天代码，真的非常充实';
  assert.ok(clampText(long, 60).length <= 60);
  const clamped = clampText(long, 20);
  assert.ok(clamped.length <= 20);
  assert.ok(clamped.endsWith('…'));
});

test('defaultNote stays inside the 60 char note limit', () => {
  const note = defaultNote(stats);
  assert.ok(note.length > 0 && note.length <= 60, `note=${note} len=${note.length}`);
  assert.ok(note.includes('2 小时 13 分') || note.includes('2小时13分') || note.includes('2 小时'));
});

test('defaultStoryCaption mentions the day, streak and week total', () => {
  const caption = defaultStoryCaption(stats);
  assert.ok(caption.includes('2 小时 13 分'));
  assert.ok(caption.includes('7'));
  assert.ok(caption.includes('8 小时 32 分'));
});

test('buildStoryCard produces a 1080x1920 card with stats and life note', () => {
  const card = buildStoryCard(stats, { handle: '@me' });
  assert.equal(card.width, 1080);
  assert.equal(card.height, 1920);
  assert.equal(card.date, '10 月 25 日');
  assert.equal(card.weekday, '周六');
  assert.ok(card.stats.length >= 3);
  assert.equal(card.stats[0].value, '2 小时 13 分');
  assert.ok(card.footer.includes('@me'));
  assert.ok(card.life.includes('海边'));
});
