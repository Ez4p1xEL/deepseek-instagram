// client.js 是浏览器半端（自注册 bundle），没有 DOM 可跑，所以这里做静态契约检查。
// 2026-10-25 踩过：`asJson(fetch(...))` 少了 await → 设置页一律报「读取失败：HTTP undefined」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('client bundle uses the ModuleLoader self-registration contract', () => {
  assert.match(source, /window\.__ModuleLoader__\.load\(/);
  assert.match(source, /id:\s*'deepseek-instagram'/);
  assert.match(source, /factory:\s*\(require\)/);
});

test('client bundle only requires react (no host packages → no white screen)', () => {
  const requires = [...source.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
  assert.deepEqual([...new Set(requires)], ['react']);
});

test('every fetch call is awaited before asJson reads res.status', () => {
  const starts = [...source.matchAll(/asJson\(/g)].map((m) => m.index);
  assert.ok(starts.length >= 2, 'expected the jget/jpost helpers');
  for (const at of starts) {
    assert.match(
      source.slice(at, at + 80),
      /^asJson\(\s*await fetch\(/,
      `asJson() got a Promise instead of a Response near: ${JSON.stringify(source.slice(at, at + 60))}`,
    );
  }
});

test('client API prefix matches the host route constant', () => {
  const api = source.match(/const API = '([^']+)'/)?.[1];
  const route = host.match(/const ROUTE = '([^']+)'/)?.[1];
  assert.equal(api, route);
});

// 设置页每个分区都要能单独保存（2026-10-26 用户要求）：功能开关 / 主人与私信 / 群聊 /
// Story @ 主人 / 内容与节奏 / 安全阀 / 人格卡，各自一个按钮，只提交本区字段。
test('每个可编辑分区都带自己的保存按钮，且只提交本区字段', () => {
  for (const k of ['features', 'dm', 'group', 'mention', 'content', 'safety', 'persona']) {
    assert.match(source, new RegExp(`k:\\s*'${k}'`), `分区 ${k} 缺少独立保存入口`);
  }
  // SaveBar 组件统一打 data-ig-save 标记，按钮文案「保存本区」
  assert.match(source, /'data-ig-save':/);
  assert.match(source, /保存本区/);
  // 分区保存在客户端调 /config（人格卡另外调 /persona*）
  assert.ok((source.match(/jpost\('\/config'/g) || []).length >= 1);
});

// 人格卡的保存必须同时写 persona.md 和名字/心情，否则改名字会像以前一样丢。
test('人格卡保存同时提交 persona.md 与名字/心情', () => {
  const start = source.indexOf('const savePersonaCard');
  assert.ok(start > 0, '缺少 savePersonaCard');
  const fn = source.slice(start, start + 800);
  assert.match(fn, /jpost\('\/persona-md'/);
  assert.match(fn, /jpost\('\/persona'/);
});

// 「完全权限」开关放在主人与私信区：界面有开关，保存时随 dm 一起提交。
test('主人与私信区有「完全权限」开关，并随 dm 一起保存', () => {
  assert.match(source, /完全权限/);
  assert.match(source, /flip\('fullAccess'\)/);
  const start = source.indexOf('const patchDm');
  assert.ok(start > 0, '缺少 patchDm');
  const fn = source.slice(start, start + 400);
  assert.match(fn, /fullAccess:/);
});
