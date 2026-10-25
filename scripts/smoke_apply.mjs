// 冒烟测试：在不启动 DSH 的情况下调用 Host 半端的 apply()，确认注入/注册都不会抛。
// 这是为了兜住「插件装上了但整条 entry 不激活」那类错误（比如访问未 inject 的 ctx 服务）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-apply-'));
process.env.DSH_HOME = tmp;

const mod = await import('../index.js');
const seen = { routes: [], tools: [], effects: 0, got: [] };

const ctx = {
  effect(fn) { seen.effects += 1; const dispose = fn(); return () => { try { dispose?.(); } catch { /* noop */ } }; },
  get(name) { seen.got.push(name); return undefined; },
  tools: { register(def) { seen.tools.push(def.name); return () => {}; } },
  webServer: { register(route) { seen.routes.push(`${route.kind}:${route.path}`); return () => {}; } },
};

await mod.apply(ctx, {});
await new Promise((resolve) => setTimeout(resolve, 50));

const expectTools = ['ig_status', 'ig_stats', 'ig_draft', 'ig_publish', 'ig_run', 'ig_login', 'ig_config'];
const missing = expectTools.filter((name) => !seen.tools.includes(name));

console.log(JSON.stringify({
  name: mod.name,
  inject: mod.inject,
  home: tmp,
  routes: seen.routes,
  tools: seen.tools,
  effects: seen.effects,
  ctxGetCalls: seen.got,
  missing,
  configWritten: fs.existsSync(path.join(tmp, 'instagram-assistant', 'config.json')),
}, null, 2));

if (missing.length) {
  console.error(`缺少工具：${missing.join(', ')}`);
  process.exitCode = 1;
}
