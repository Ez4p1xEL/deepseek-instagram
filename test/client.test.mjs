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
