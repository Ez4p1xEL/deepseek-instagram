// 硬约束回归：本插件不得把任何第三方 DSH 插件当作运行前置。
// 规则（用户 2026-10-26 拍板）：除了 DSH 官方内置文件，不依赖其他第三方 DSH 插件。
// 允许的 import 只有三类：
//   1) node: 内置模块
//   2) 仓库内相对路径（./、../）
//   3) client.js 里的 'react'（宿主浏览器模块表提供，不是插件）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED_BARE = new Set(['react']);

function jsFiles() {
  const out = [join(ROOT, 'index.js'), join(ROOT, 'client.js')];
  for (const name of readdirSync(join(ROOT, 'lib'))) {
    if (name.endsWith('.mjs')) out.push(join(ROOT, 'lib', name));
  }
  return out;
}

// import x from 'spec' / import 'spec' / import { a } from 'spec'
const IMPORT_RE = /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
// client.js 这种自注册脚本用 require('react')
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(file) {
  const text = readFileSync(file, 'utf8');
  const found = [];
  for (const re of [IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) found.push(m[1]);
  }
  return found;
}

test('插件源码只 import node: 内置 / 仓库内相对路径 / react', () => {
  const bad = [];
  for (const file of jsFiles()) {
    for (const spec of specifiersOf(file)) {
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('./') || spec.startsWith('../')) continue;
      if (ALLOWED_BARE.has(spec)) continue;
      bad.push(`${file.replace(ROOT, '')} -> ${spec}`);
    }
  }
  assert.deepEqual(bad, [], `发现非官方依赖：${bad.join(', ')}`);
});

test('package.json 不声明任何依赖（第三方插件不能成为前置）', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const dep = pkg[key];
    assert.ok(!dep || Object.keys(dep).length === 0, `package.json 不应有 ${key}：${JSON.stringify(dep)}`);
  }
});

test('源码里没有动态 import / require 第三方包', () => {
  const bad = [];
  for (const file of jsFiles()) {
    const text = readFileSync(file, 'utf8');
    const re = /\b(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(text))) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('./') || spec.startsWith('../')) continue;
      if (ALLOWED_BARE.has(spec)) continue;
      bad.push(`${file.replace(ROOT, '')} -> ${spec}`);
    }
  }
  assert.deepEqual(bad, [], `发现动态加载的第三方依赖：${bad.join(', ')}`);
});

test('vendor Python 只 import 标准库 + instagrapi + Pillow', () => {
  const allowed = new Set([
    'json', 'os', 'sys', 'time', 'traceback', 're', 'io', 'datetime', 'random',
    'pathlib', 'typing', 'tempfile', 'shutil', 'subprocess', 'base64', 'dataclasses',
    'instagrapi', 'PIL',
  ]);
  const dir = join(ROOT, 'vendor', 'instagram-mcp');
  const bad = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.py')) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    const re = /^\s*(?:import|from)\s+([A-Za-z_][\w.]*)/gm;
    let m;
    while ((m = re.exec(text))) {
      const top = m[1].split('.')[0];
      if (!allowed.has(top)) bad.push(`${name}: ${top}`);
    }
  }
  assert.deepEqual(bad, [], `Python 侧出现未登记依赖：${bad.join(', ')}`);
});
