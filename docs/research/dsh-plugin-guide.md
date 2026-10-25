# DSH 插件实现指南：Host 半端 + Web 设置页

> 目标：在 `D:\Space\Workspace\deepseek-instagram` 里从零写一个能装进 **desktop profile** 的 Cordis 插件，
> 它同时有 ① 模型可见的工具、② 定时任务、③ 一个出现在「设置」里的页面。
>
> **证据来源**（本指南所有结论都可回溯）：
>
> | 来源 | 位置 |
> | --- | --- |
> | 已安装、可用的第三方插件（MIT，v0.1.7） | `C:\Users\Ez4p1\.dsh\profiles\desktop\node_modules\dsh-bili-scroll\`（`index.js` 1347 行 / `client.js` 577 行） |
> | 官方 skill | `…\app.asar\dsh\node_modules\@deepseek-ai\dsh-agent-preset\skills\cordis-plugin-development\references\{host-plugin,ui-plugin,practices,user-actions}.md`，模板 `templates\decoration\` |
> | 运行期契约（权威类型） | `cordis_inspect_query`（platform `host`，provider `Service`）：`webServer` / `tools` / `llm` / `settings` / `attachments` / `agentDefaultModel` / `timer` |
> | profile 现状 | `C:\Users\Ez4p1\.dsh\profiles\desktop\{package.json,cordis.patch.yml}` |
>
> 本机事实：`DSH_PROFILE=desktop`、`DSH_HOME=C:\Users\Ez4p1\.dsh`、Web GUI `http://127.0.0.1:42586`、
> `DSH_HOST_MODULES` **为空**（见 §a，这决定了裸 import `@deepseek-ai/*` 一定会失败）。

---

## 0. 先看结论：一个插件就是四个文件

```
D:\Space\Workspace\deepseek-instagram\
├─ package.json          # 清单：告诉 DSH 这是 bundle、client 在哪
├─ cordis.patch.yml      # 挂载声明：往 profile 的配置树里 insert 一条
├─ index.js              # Host 半端（Node，可注册工具/路由/定时器）
└─ client.js             # Web 半端（浏览器，设置页 UI）
```

心智模型：

```
profile 配置树 = 各 bundle 的 patch 按 dsh.profile.bundles 顺序叠 + profile 自己那层 cordis.patch.yml
     ↓ 你的 cordis.patch.yml 里 insert 一条 {id, name, config}
index.js  ← 被 Host 进程 import，拿到 apply(ctx, config)
     │  ctx.tools.register(...)       → 模型能看到的工具
     │  ctx.webServer.register(...)    → /api/deepseek-instagram/* 的 HTTP 接口
     │  ctx.interval(...)              → 定时任务（随插件 dispose 自动清）
     ↓
client.js ← 被浏览器当「自注册脚本」求值，拿到 apply(ctx)
        ctx.slots.inject('settings.section', …) → 「设置」左侧多一项
        fetch('/api/deepseek-instagram/…')      → 读写 Host 侧状态/配置
```

**只用两条通道**：Host ↔ Client 之间**没有**插件自定义的 RPC，走 **HTTP 路由 + fetch**（§f 是唯一的桥）。
`ctx.remote.*` 只对内置命名空间可用（§e 备选）。

### 0.1 最小可跑骨架

#### `package.json`

```json
{
  "name": "deepseek-instagram",
  "version": "0.1.0",
  "private": true,
  "description": "DSH 插件：Instagram 抓取 + 设置页",
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./package.json": "./package.json"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "README.md"],
  "engines": { "dsh": ">=0.1.7-rc.1", "node": ">=22" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-settings-plugins"
      ]
    }
  }
}
```

> 这份清单**没有任何依赖**：既不 import `@deepseek-ai/*`，也不需要构建步骤（§a 解释为什么这样最稳）。

#### `cordis.patch.yml`

```yaml
# 本插件自带的挂载声明；装好后 profile 只要把包名列进 dsh.profile.bundles 即生效
- insert:
    - id: deepseek-instagram
      name: deepseek-instagram
      config:
        enabled: true
```

#### `index.js`（骨架，可运行）

```js
/**
 * deepseek-instagram —— Host 半端
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'deepseek-instagram'          // ⚠️ 必须等于 patch 里的 id
export const inject = ['webServer', 'tools']      // 用哪个服务就先声明（少一个会拿不到）

const HOME = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'deepseek-instagram')
const CFG_FILE = join(HOME, 'config.json')
const ROUTE = '/api/deepseek-instagram'           // ⚠️ 客户端必须用同一个常量
const DEFAULTS = { enabled: true, perDay: 5 }

const ensureHome = () => { if (!existsSync(HOME)) mkdirSync(HOME, { recursive: true }) }

/** 读配置：永远按 DEFAULTS 归一化（宿主可能塞进非标量对象，见 §c） */
function loadCfg() {
  ensureHome()
  let raw = {}
  try { raw = JSON.parse(readFileSync(CFG_FILE, 'utf8')) } catch { /* 首次运行 */ }
  const out = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS)) {
    const v = raw?.[k]
    if (typeof v === typeof DEFAULTS[k] && v !== null) out[k] = v
  }
  return out
}
const saveCfg = (patch) => {
  ensureHome()
  const next = { ...loadCfg(), ...patch }
  writeFileSync(CFG_FILE, JSON.stringify(next, null, 2))
  return next
}

/** 工具返回值必须是「无损 JSON」——顺手兜一层 */
const safe = (v) => {
  try { return JSON.parse(JSON.stringify(v ?? null)) } catch { return String(v) }
}

const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }],
}

const sendJson = (res, code, obj) => {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}
const readBody = (req) => new Promise((resolve) => {
  const chunks = []
  let size = 0
  req.on('data', (c) => { size += c.length; if (size > 1_000_000) req.destroy(); else chunks.push(c) })
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { resolve({}) } })
  req.on('error', () => resolve({}))
})

export function apply(ctx, config) {
  // config 是这一行的 config（可能被设置层就地改动），要用的值每次重新取
  const flag = () => (config?.enabled !== false)

  // ── 路由 ──────────────────────────────────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',                 // prefix = 前缀匹配；exact = 只此一条
    path: ROUTE,
    handler: async (req, res) => {
      const path = new URL(req.url, 'http://x').pathname.slice(ROUTE.length) || '/'
      if (req.method === 'GET' && path === '/state') {
        return sendJson(res, 200, { ok: true, cfg: loadCfg(), home: HOME })
      }
      if (req.method === 'POST' && path === '/config') {
        const patch = await readBody(req)
        return sendJson(res, 200, { ok: true, cfg: saveCfg(patch) })
      }
      if (req.method === 'POST' && path === '/run') {
        if (!flag()) return sendJson(res, 409, { ok: false, error: '插件已关闭' })
        try { return sendJson(res, 200, { ok: true, result: 'demo' }) } catch (e) {
          return sendJson(res, 500, { ok: false, error: String(e?.message || e) })
        }
      }
      return sendJson(res, 404, { ok: false, error: 'not found' })
    },
  }), 'deepseek-instagram: HTTP 路由')

  // ── 模型可见工具 ──────────────────────────────────────────────────────
  const tool = (spec) => ctx.tools.register({
    ...spec,
    output: textOutput,
    async execute(args, exec) { return safe(await spec.execute(args, exec)) },
  })
  ctx.effect(() => tool({
    name: 'ig_status',
    description: '查看 deepseek-instagram 插件的当前配置与状态。',
    parameters: { verbose: { type: 'boolean', description: '是否返回完整配置' } }, // 注意：是「属性表」不是完整 schema
    async execute(args) { return { ok: true, cfg: loadCfg(), verbose: !!args?.verbose } },
  }), 'deepseek-instagram: ig_status 工具')

  // ── 定时任务 ──────────────────────────────────────────────────────────
  ctx.effect(() => ctx.interval(() => {
    try { /* 干活；记得整体 try/catch —— 抛出去会拖垮宿主进程（§g） */ } catch (e) {
      ctx.logger?.warn?.(`[deepseek-instagram] tick 失败：${e?.message || e}`)
    }
  }, 5 * 60_000), 'deepseek-instagram: 定时器')

  ctx.logger?.info?.('[deepseek-instagram] 已激活')
}
```

#### `client.js`（骨架，可运行）

```js
/**
 * deepseek-instagram —— 浏览器半端（设置页）
 * client bundle 不是 ESM，是自注册脚本（见 §e）
 */
window.__ModuleLoader__.load({
  id: 'deepseek-instagram',        // ⚠️ 必须等于 package.json 的 name
  factory: (require) => {
    const React = require('react')  // 只从浏览器模块表拿 react，别 require 别的 Harness 包
    const h = React.createElement

    const API = '/api/deepseek-instagram'

    const asJson = async (res) => {
      if (res.ok) return res.json()
      const why = res.status === 401 ? '（未登录）' : res.status === 403 ? '（宿主拦了）' : ''
      throw new Error(`HTTP ${res.status}${why}`)
    }
    const jget = (p) => asJson(fetch(API + p, { credentials: 'same-origin' }))
    const jpost = (p, body) => asJson(fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const CSS = `
[data-ig-page]{display:flex;flex-direction:column;gap:16px;max-width:640px;padding:2px 2px 8px}
[data-ig-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6)}
[data-ig-label]{font-size:13px}
[data-ig-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6)}
[data-ig-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:inherit;font-family:inherit}
[data-ig-pre]{white-space:pre-wrap;font-size:11px;line-height:16px;max-height:240px;overflow:auto}
`

    function Panel() {
      const [st, setSt] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState('')

      const reload = React.useCallback(async () => {
        try { setSt(await jget('/state')); setErr('') } catch (e) { setErr(String(e.message || e)) }
      }, [])
      React.useEffect(() => { reload() }, [reload])

      const run = async () => {
        setBusy('run')
        try { await jpost('/run', {}); await reload() } catch (e) { setErr(String(e.message || e)) } finally { setBusy('') }
      }

      if (!st) return h('div', { 'data-ig-page': '' },
        err ? h('div', { 'data-ig-note': '' }, `读取失败：${err}`) : h('div', { 'data-ig-note': '' }, '读取中…'))

      return h('div', { 'data-ig-page': '' },
        h('div', { 'data-ig-h': '' }, '状态'),
        h('div', { 'data-ig-label': '' }, `家目录：${st.home}`),
        h('div', { 'data-ig-label': '' }, `每天上限：${st.cfg.perDay}`),
        err ? h('div', { 'data-ig-note': '' }, `⚠️ ${err}`) : null,
        h('button', { disabled: busy === 'run', onClick: run }, busy === 'run' ? '执行中…' : '立刻跑一轮'),
        h('pre', { 'data-ig-pre': '' }, JSON.stringify(st.cfg, null, 2)),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'deepseek-instagram')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'deepseek-instagram: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'deepseek-instagram', order: 40, label: 'Instagram' },
          () => h(Panel),
        ))
      },
    }
  },
})
```

---

## a. `package.json` 最小字段 + 桌面版为什么不能裸 import `@deepseek-ai/*`

### a.1 字段清单（逐条对得上）

| 字段 | 必填 | 作用 | 出处 |
| --- | --- | --- | --- |
| `name` | ✅ | 包名；**必须等于** `client.js` 里 `__ModuleLoader__.load({id})` 的 id | `dsh-bili-scroll/package.json:2`、`client.js:29` |
| `type: "module"` | ✅ | Host 侧是 ESM（`import`/顶层 `await`） | `package.json:17` |
| `main` / `exports["."]` | ✅ | Host 入口 | `package.json:18-22` |
| `exports["./client"]` | ✅ | **Client 产物入口**，DSH 从 `${包}/client.js` 取浏览器脚本 | `package.json:21`、skill `ui-plugin.md` |
| `engines.dsh` | 建议 | 最低 DSH 版本 | `package.json:36-39` |
| `dsh.bundle.patch` | ✅ | 指向自带 patch，装上即挂载 | `package.json:55-58` |
| `dsh.client.platform` | ✅ | 固定 `"web"` | `package.json:60` |
| `dsh.client.inject` | 建议 | **只排激活顺序**，不是模块导入 | `package.json:61-65` |
| `dsh.client.immediately` | 可选 | 启动即加载；bili 没写也正常 | 模板 `templates/decoration/package.json` |
| `peerDependencies` + `peerDependenciesMeta.optional` | 仅当真的要 import 宿主包 | 见 a.3 | `package.json:40-54` |
| `files` | 发布时 | **本地目录安装是 link，`files` 不过滤** | skill `host-plugin.md` |

### a.2 桌面版硬事实：`@deepseek-ai/*` 装不上

```
C:\Users\Ez4p1\.dsh\profiles\desktop\node_modules\@deepseek-ai\
├─ cosmokit          ← 是 bili 自己的依赖树 hoist 上来的
└─ schemastery       ← 同上（bili 在 dependencies 里真装了 ^3.18.1）
```

- `@deepseek-ai/dsh-tools` **不在** profile 里；`@deepseek-ai/dsh-base` 等也不在。
- 环境变量 `DSH_HOST_MODULES` **为空**（本机实测）。
- 原因（bili 官方注释，`lib/hostdeps.mjs:4-10`）：

  > 桌面版 profile（`autoInstallPeers: false`）**永远不装** optional peer ⇒ 插件整条不激活，
  > DSH 只留一句 `warning: 1 entry did not activate … failed to import` ✓
  > （web profile 上一直没事，是因为 profile 树里恰好有别的插件把 peer hoist 上来 —— 这是运气 ✗）

也就是说：**`import { defineTool } from '@deepseek-ai/dsh-tools'` 这样一行，会让你的整个插件静默不加载**，
而界面上只有一条 warning。这是本任务第一大坑。

### a.3 两种写法（选一个）

**写法 A（推荐，零依赖）**：不 import 任何 `@deepseek-ai/*`。工具定义直接用普通对象
（`{name, description, parameters, output, execute}`），DSH 的 `ctx.tools.register()` 接受它
—— bili 在 `dsh-tools` 拿不到时用的就是这个等价实现（`lib/hostdeps.mjs:98-113`），
它只额外校验一条：**`type:'object'` 的 schema 必须写 `additionalProperties`**。

```js
// lib/define-tool.mjs —— 从 bili lib/hostdeps.mjs:98-113 抄来的等价实现
export function localDefineTool(options) {
  const check = (schema, where) => {
    if (!schema || typeof schema !== 'object') return
    if (schema.type === 'object' && schema.additionalProperties === undefined) {
      throw new Error(`defineTool(${options.name}): ${where} 是 object 却没写 additionalProperties`)
    }
    for (const [k, v] of Object.entries(schema.properties || {})) check(v, `${where}.properties.${k}`)
  }
  check(options.parameters, 'parameters')
  check(options.output?.schema, 'output.schema')
  return options
}
```

**写法 B（要 Config/schemastery 时）**：真装一份 schemastery 到 `dependencies`，并且**动态 import**，拿不到就降级：

```json
{
  "peerDependencies": {
    "@deepseek-ai/dsh-tools": "*",
    "@deepseek-ai/schemastery": "*"
  },
  "peerDependenciesMeta": {
    "@deepseek-ai/dsh-tools": { "optional": true },
    "@deepseek-ai/schemastery": { "optional": true }
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.1"
  }
}
```

```js
// index.js 头部：先 await 动态解析，再决定 Config 要不要导出（bili index.js:17-24, 44-46）
const hostDeps = await loadHostDeps()   // 失败也**不抛**，返回 { z: null, defineTool: fallback }
const z = hostDeps.z

export const Config = !z ? undefined : z.object({
  enabled: z.boolean().default(true).extra('volatile', true),
})
```

`loadHostDeps()` 的解析顺序（`lib/hostdeps.mjs:28-61, 119-141`）：
`DSH_HOST_MODULES` → `%APPDATA%\npm\@deepseek-ai\{dsh,*}\node_modules\@deepseek-ai` →
`/usr{,/local}/lib/node_modules/...` → `$DSH_HOME/profiles/*/node_modules/@deepseek-ai` →
插件自己 `node_modules` → 最后 `import('@deepseek-ai/xxx')`，都失败就返回 `null` / 本地 `defineTool`。

> ⚠️ 本机 `DSH_HOST_MODULES` 为空、profile 里也没有 `dsh-tools`，所以**即使照抄写法 B，`defineTool` 也会走本地兜底**。
> 结论：工具定义请按「普通对象 + `additionalProperties`」写，两种环境都能跑。

> ⚠️ 未验证：`plugin_manager install_bundle` 装**本地目录**时，是否为该目录跑依赖安装。
> 若没装，`@deepseek-ai/schemastery` 会缺席 → `z` 为 null → 插件照常加载但无 `Config`。
> 这也是为什么写法 A 更稳。

---

## b. `cordis.patch.yml`：insert 一条带 config 的插件

原文（`dsh-bili-scroll/cordis.patch.yml:15-20`）：

```yaml
- insert:
    - id: bili-scroll
      name: dsh-bili-scroll
      config:
        # 真正的用户配置在插件自己的 config 里（设置页可改），这里只放默认值
        enabled: true
```

规则：

- 顶层是**数组**，每项是一个 patch entry；`insert` 的值是**要插入的 loader 行数组**。
- `id`：该行在配置树里的稳定 id。**必须**等于后端模块导出的 `name`，也等于 settings 命名空间名（§c）。
- `name`：包名（bare specifier）。本地目录安装时同样写包名即可（DSH 从 profile 的 `node_modules` 解析）。
- `config`：该行传给 `apply(ctx, config)` 的对象；**会被 `Config` schema 校验**（若导出了 `Config`）。
- 覆盖层写法（profile 自己的 `cordis.patch.yml` 才是热重载那层）——按 `id` 打补丁：

```yaml
# C:\Users\Ez4p1\.dsh\profiles\desktop\cordis.patch.yml
- id: bili-scroll             # 已存在的 id → 覆盖，不再 insert
  name: dsh-bili-scroll
  config:
    enabled: true
    pythonPath: C:\Users\Ez4p1\.dsh\bili-duty\.venv\Scripts\python.exe
```

来源注释（`cordis.patch.yml:11-13`）：

> 组成顺序：每个 bundle 的 patch 按 `dsh.profile.bundles` 顺序叠
> → 再叠 profile 自己那一层的 `cordis.patch.yml`（**只有那层是热重载**）

---

## c. Host 模块的导出形状 & 配置读取

### c.1 形状（三选一，不要混）

```js
// 形式 1：函数式（最常见）
export const name = 'deepseek-instagram'
export const inject = ['webServer', 'tools', 'settings']
export const Config = z.object({ /* … */ })     // 可选
export function apply(ctx, config) { /* … */ }

// 形式 2：类式
export default class MyService { constructor(ctx, config) {} }
```

skill `host-plugin.md`：`index.js` 只导出**一种**——`apply` 函数（+ 可选 `inject`、`Config`），
或一个 service class 作默认导出，**"do not mix them"**。

- `inject` 决定 `ctx.xxx` 是否可用；**少声明会直接拿不到**（bili 用 `['webServer','tools','settings']`，`index.js:36`）。
- `name` 必须等于 patch 里 `id`（`index.js:35` ↔ `cordis.patch.yml:16`）。

### c.2 `Config` 用 schemastery，每个字段都要 `volatile`

原文（`dsh-bili-scroll/index.js:38-50`）：

```js
/**
 * 🔴 每个字段都要 `.extra('volatile', true)`：DSH 的 settings.update() 只认 volatile 字段
 *    （`volatileForm(schema)`，见 dsh-settings），没有这个标记写设置时会抛
 *    "Plugin entry … has no volatile fields"。另外两个条件是：
 *    **loader entry 的 id 必须等于命名空间名**（我们 patch 里就是 `bili-scroll`）+ **本模块导出 Config**。
 */
export const Config = !z ? undefined : z.object({
  perDay: z.natural().default(5).extra('volatile', true),
  peakValley: z.boolean().default(false).extra('volatile', true),
})
```

三个条件缺一不可：
1. 导出 `Config`；
2. loader 行 `id` == 命名空间名（= 模块 `name`）；
3. **每个**要写的字段 `.extra('volatile', true)`。

另一个经验（同文件注释）：**不要写 `.max(20)` 之类会让校验失败的约束** —— schema 拒绝会让
cordis **整条 entry 掉线**，表现为插件莫名不工作。

### c.3 拿到 config、以及 `watch` 变化

Host 侧 `apply(ctx, config)` 拿到的就是该行的 `config`（已被 schema 校验/填默认值）。
但**不要缓存成常量**：

- volatile 字段更新时，cordis 是**就地改** `fiber.config`（bili `index.js:237` 注释：
  「`apply()` 的 `config` 是 live 的 `fiber.config`，volatile 更新会就地修改它，所以启动时的快照必须
  `refreshCfg()` 之后再用」）。
- **字段值不保证是标量**——bili 的血泪注释（`index.js:148-174` 附近）：出现过对象被塞进字段，
  所以它对每个字段做 `normalize()` 对齐 `DEFAULTS` 的类型。

推荐读法（懒读 + 短缓存），照抄 bili 的两段：

```js
const DEFAULTS = { enabled: true, perDay: 5 }

function normalize(cfg, defaults) {
  const out = { ...defaults }
  for (const k of Object.keys(defaults)) {
    const v = cfg?.[k]
    if (typeof v === typeof defaults[k] && v !== null) out[k] = v
  }
  return out
}
const hostCfg = () => normalize(config, DEFAULTS)     // bili index.js:198 附近
```

想拿「用户在原生设置页里**显式改过**的值」用 `ctx.settings.describe()`（bili `index.js:198-224`）：

```js
const desc = ctx.settings.describe()        // SettingsDescriptor[]
// desc[0] = { ns, revision, value, base, user }
//  · value  = 当前生效值
//  · user   = 用户显式设置过的键（只认这些，代表"用户意图"）
//  · revision = 写回时的乐观锁
const row = desc.find((d) => d.ns === 'deepseek-instagram')
if (row?.user?.perDay !== undefined) { /* 用 row.user.perDay 覆盖自己的 config.json */ }
```

**没有可靠的「config 变了」事件**（至少 bili 没找到）。它用的是：`describe()` 结果缓存 3 秒 +
每次使用前 `refreshCfg()`。你也可以自己算 `row.revision` 变化来感知（同一个 `revision` = 没变）。

写回（bili `index.js:243-259`）：

```js
async function saveCfgHost(patch) {
  const row = ctx.settings.describe().find((d) => d.ns === 'deepseek-instagram')
  try {
    await ctx.settings.update(row.ns, patch, row.revision)
  } catch (e) {
    // revision 过期：拿新的再试一次
    const fresh = ctx.settings.describe().find((d) => d.ns === 'deepseek-instagram')
    await ctx.settings.update(fresh.ns, patch, fresh.revision)
  }
}
```

> `settings` 服务的完整签名（inspect）：`describe(options?)`、`update(ns, patch, expectedRevision?)`、
> `replace(ns, section, expectedRevision?)`、`mutate(ns, ops, expectedRevision?)`。

---

## d. 注册一个模型可见的工具

### d.1 官方契约（`cordis_inspect_query` host / `tools`）

```ts
tools.register(definition: ToolDefinition): () => void   // 返回 disposer；同层重名 / 保留名 run_code 会失败

interface ToolSchema { deferLoading?: true; name: string; description: string; parameters: Record<string, unknown> }
interface ToolDefinition extends ToolSchema {
  readonly output: ToolOutputDefinition
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  projectContent?; finalizeContent?; timeoutMs?; isConcurrencySafe?; presentCall?; presentResult?
}
interface ToolOutputDefinition {
  readonly schema: JsonSchemaNode
  render(args: unknown, value: JsonValue): ContentBlock[]
  presentationMeta?
}
interface ToolRunContext extends ToolExecution {   // ToolExecution.signal: AbortSignal
  deferContext(context: UserMessage): void
  concludeTurn(): void
}
```

要点：
- **`execute(args, exec)`；取消信号在 `exec.signal`（AbortSignal），不是第二个参数直接给 signal。**
- **`parameters` 传「属性表」**（`{ bvid: { type: 'string', description } }`），不是完整 object schema
  —— bili 的三个工具都这么写（`index.js:334-419`）。如果你非要传完整 schema，必须带 `additionalProperties`。
- `output.schema` 必须是**完整** JSON Schema，且对象类型必须写 `additionalProperties`。

### d.2 bili 的包装（直接可用）

```js
// dsh-bili-scroll/index.js:311-332
const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }],
}
const tool = (spec) => ctx.tools.register(defineTool({
  ...spec,
  output: textOutput,
  async execute(args, exec) { return safe(await spec.execute(args, exec)) },
}))
```

真实 spec 的写法：

```js
ctx.effect(() => tool({
  name: 'ig_fetch_post',
  description: '抓取一个 Instagram 帖子的元数据与首图。',
  parameters: {
    url: { type: 'string', description: '帖子 URL' },
    download: { type: 'boolean', description: '是否把图片存到本地（默认 false）' },
  },
  async execute(args, exec) {
    if (!args?.url) throw new Error('缺 url')
    const post = await fetchPost(args.url, { signal: exec.signal })   // ← 取消信号
    return { ok: true, post }
  },
}), 'deepseek-instagram: ig_fetch_post')
```

### d.3 「本地兜底 defineTool」

就是 §a.3 那个 `localDefineTool`：只在拿不到宿主 `dsh-tools` 时用，**只多一条 `additionalProperties` 校验**，
其余原样返回。所以你的 spec 必须自己是合法 JSON Schema（对象带 `additionalProperties`）。

### d.4 让工具结果显示图片 / 文件

`render()` 返回 `ContentBlock[]`。文本块：`{ type: 'text', text }`；图片块要一个**持久化引用**：

```js
// 1) 存图（inspect: attachments.saveImage）
//    SaveImageAttachment = { data: Uint8Array; mediaType: 'image/png'|'image/jpeg'|'image/webp'|'image/gif'; name?: string }
//    ImageAttachmentRef = { attachmentId, mediaType, bytes, width, height, name? }
const ref = await ctx.attachments.saveImage({ data: pngBytes, mediaType: 'image/png', name: 'ig.png' })

// 2) render 出来（ImageBlock = { type:'image', attachment: ImageAttachmentRef, offloaded?: true }）
output: {
  schema: { type: 'object', properties: { attachmentId: { type: 'string' } }, additionalProperties: true },
  render: (_args, value) => [{ type: 'image', attachment: value }],
}
```

- `inject` 里要加 `'attachments'`。
- 文件同理：`attachments.saveFile({ data: Uint8Array, name })` → `FileAttachmentRef { attachmentId, name, bytes }`，
  渲染时用 file 块（没有 image 那么严格，通常用文本块给出路径更稳：`attachments.fileHostPath(ref)`）。
- `execute()` 的返回值会被塞进会话事件，**必须无损 JSON**（bili 的 `safe()` 就是因为报过
  `value is not lossless JSON`）。`Uint8Array`/`Date`/`Map` 一律先转换。

---

## e. Web 设置页：`client.js`

### e.1 它是什么（不是 ESM！）

原文（`dsh-bili-scroll/client.js:1-9`）：

```
⭐ **client bundle 不是 ESM，是自注册脚本**（2026-10-14 从官方包里挖到的约定）：

    window.__ModuleLoader__.load({
      id: '<包名>',                       // 必须等于 package.json 的 name
      factory: (require) => { ... return { inject: [...], apply(ctx) {...} } },
    })
```

- 没有构建步骤：`client.js` 直接写这个 wrapper（模板 `templates/decoration/client.js:1-22` 一模一样）。
- `factory` 内 **`require` 只能拿浏览器模块表里的东西**（`react` 可以）。
- **禁止** `require('@deepseek-ai/dsh-client-ui-primitives')` 或任何其他 Harness Client 包
  （skill `practices.md`：`dsh.client.inject` 只排激活顺序，**不当模块导入**）。
  违反的最坏结果不是报错，而是该 slot 渲染时抛异常 → **整块 UI 空白**（`slot entry crashed in '<slot>'`）。

### e.2 注册设置分区

原文（`client.js:567-573`）：

```js
const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
if (!slots) return
slots.inject('settings.section', () => slots.register(
  { name: 'settings.section', id: 'bili-scroll', order: 30, label: '刷B站' },   // label = 左侧导航那一项
  () => h(Panel),
))
```

- owner key / `name` 都是 `'settings.section'`；`id` 唯一；`order` 控制排序；**`label` 就是标题**。
- 组件是一个 **React 函数组件**（`() => h(Panel)`，惰性）。
- 同一份注释里的反面教材（`client.js:19`）：
  > ⇒ **别自己糊一个标题栏按钮 + 全屏 overlay** ✗（第一版就是这么干的，使用者一眼看出"跟别的插件不一样"）

### e.3 UI 从哪来 / 样式怎么写

- **React**：`const React = require('react')`；`React.useState/useEffect/useCallback` 都能用。
- **没有内置组件库可 require**；控件自己用原生元素画（bili 手搓开关、输入框、按钮，`client.js:50-70` 的 CSS）。
- **只能用主题 token**（skill `practices.md`：`--dsw-alias-*`；写死颜色只允许出现在"作品类"装饰里）。
  bili 的用法：`color:var(--dsw-alias-label-tertiary,#9aa0a6)`、`border:1px solid var(--dsw-alias-border-l2,…)`、
  `background:var(--dsw-alias-bg-overlay,…)` —— **都带 fallback**，因为不同主题未必全有。
- 样式注入：`document.head.appendChild(<style>)` + `ctx.effect(() => () => style.remove())`（`client.js:561-565`）。
- `apply(ctx)` 里注册的一切都要能被 dispose（`ctx.effect` / `ctx.on`），factory 本身保持无副作用。

### e.4 读写 Host 侧配置 / 触发动作

**唯一被验证过的桥 = 你自己的 HTTP 路由**（§f）。bili 的全部交互都是这样（`client.js:34-48`）：

```js
const API = '/api/bili-duty'
const jget  = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
const jpost = async (p, body) => asJson(await fetch(API + p, {
  method: 'POST', credentials: 'same-origin',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
}))
```

- 同源（GUI 是 `http://127.0.0.1:42586`，路由挂在同一个 server 上），所以 `credentials:'same-origin'` 就够。
- **必须检查 `res.ok`**：bili 的旧 bug 注释（`client.js:35-36`）——
  「原来 jget/jpost 直接 `.json()`、从不看 res.ok ⇒ HTTP 500 的 `{ok:false,error}` 会被当成「已保存」，
  绿色提示把故障盖掉」。
- 路由前缀**没有**自动发现机制：Host 与 Client 里各写一个同名常量（bili 就是 `/api/bili-duty` 抄两份）。
  需要绝对 URL 时 Host 侧可用 `ctx.webServer.getOrigin()`。

**备选（不推荐，仅当你要调内置能力）**：Client 端可以走 `ctx.remote.<命名空间>.<方法>`，
例如 skill `user-actions.md` 说的「session command that `ctx.remote.commands.execute()` runs」、
以及设置服务的镜像 `ctx.remote.settings.describe() / .update(ns, patch, expectedRevision)`。
这些命名空间是**内置服务 + 构建期代码生成的 typert 产物**；插件自己 `@Remote` 装饰的方法
需要同一套代码生成，**纯 JS 插件没有这条路**（未在第三方插件里见到）。所以：自定义逻辑一律走 HTTP。

### e.5 展示日志 / 状态

bili 的做法（`client.js:525-554`）：
- `GET /state` 返回 `{home, report, installTail, loggedIn, …}`，前端 `useEffect` 拉一次 + 按钮后重拉；
- 日志用 `<pre>` 直接渲染字符串尾部（Host 侧读自己的日志文件，取最后 N 行）；
- 二维码这种二进制用 data URL：`h('img', { src: 'data:image/png;base64,...' })`（`client.js:532-537`）；
- 长任务用轮询（`GET /state` 里带 `installing: true`），不要指望 WebSocket/推送。

> 结论：**设置页能不能看到日志，完全取决于你自己是不是把日志存成文件并通过路由吐出来**（§h）。

---

## f. Host 侧 HTTP 路由

### f.1 契约（inspect / `webServer`）

```ts
getOrigin(): string
register(route: WebRoute): () => void        // 重复的 (kind,path) 会 throw
registerUpgrade(route)
registerFallback(handler)                    // 全局只能有一个 owner
tapIndex / applyIndexTaps / collectIndexInjections / renderIndex

interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```

- **`prefix`**：`/api/deepseek-instagram` 会吃掉 `/api/deepseek-instagram/anything`（bili 用法）；
  **`exact`**：只匹配一条。
- 路径以 `/` 开头，挂在 DSH Web 服务同一个 origin 上（没有额外前缀）。
- **`(kind,path)` 重复注册直接抛异常** —— 插件被加载两次（例如两个 bundle 都 insert 了同名行）会炸。

### f.2 注册模板（bili `index.js:1333-1343`）

```js
ctx.effect(() => ctx.webServer.register({
  kind: 'prefix',
  path: '/api/deepseek-instagram',
  handler: async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const sub = url.pathname.slice('/api/deepseek-instagram'.length) || '/'
    if (req.method === 'GET' && sub === '/state') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ ok: true }))
    }
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: 'not found' }))
  },
}), 'deepseek-instagram: /api/deepseek-instagram 路由')
```

- `ctx.effect(fn, label)`：`fn` 返回 disposer（这里是 `register` 的返回值），插件 dispose 时自动注销。
- `req/res` 是**原生 Node 对象**：想返回文件/静态资源就直接

```js
import { createReadStream, statSync } from 'node:fs'
const p = join(HOME, 'out', 'latest.png')
if (!existsSync(p)) return sendJson(res, 404, { ok: false })
res.writeHead(200, { 'content-type': 'image/png', 'content-length': statSync(p).size })
createReadStream(p).pipe(res)
```

没有 `sendFile` 之类的 helper，也没有内置静态目录；**要什么自己 writeHead**。
CORS 不需要（同源），但如果要支持 `dsh web` 的别的端口访问，得自己加头。

---

## g. 定时任务与生命周期

### g.1 两种写法

**推荐**：Cordis 的 `timer` 服务（inspect：`timer`，"Disposable timer helpers"，混入每个 ctx 上下文）：

```ts
timeout(callback, delay): () => void
timeout(delay): Promise<void>
interval(callback, delay): () => void
interval<R>(delay): AsyncIterableIterator<void>
throttle(callback, delay, noTrailing?)
debounce(callback, delay)
```

```js
ctx.effect(() => ctx.interval(() => { try { tick() } catch (e) { ctx.logger?.warn?.(String(e)) } }, 60_000),
           'deepseek-instagram: 定时器')
```

返回值是 disposer；**插件 dispose（禁用/卸载/热重载）时自动清掉**。

**bili 的写法**（`index.js:885-889`，等价但自己管）：

```js
const timer = setInterval(tick, 60_000)
timer.unref?.()                                        // 别让定时器吊住进程退出
ctx.effect(() => () => clearInterval(timer), 'bili-duty: 谷时定时器')
```

### g.2 两个必须知道的坑

1. **回调抛异常会杀死宿主进程**。bili 的注释（`index.js:148-174` 一带）：抛出的定时器回调
   直接把整个 host 进程带走了。所以 `tick` 的函数体要**整体 try/catch**（bili `index.js:860-883` 就是这么包的）。
2. `unref()` 只影响进程退出，不影响行为；但**长任务别塞进 interval 回调里**（会重叠），
   用一个 `let running = false` 或 `ctx.setInterval` 的 async 迭代器版本。

### g.3 热重载行为

- **改 profile 自己那层 `cordis.patch.yml`** → 该层是热重载的（bili patch 注释 `cordis.patch.yml:11-13`）：
  plugin dispose → `apply` 重新执行 → 你的 `ctx.effect` 清理跑一遍 → 路由重注册（所以别做「先注册再判断」的重复注册）。
- **改插件包里的 `index.js`** → Host 模块已被 import 缓存，**必须重启 DSH**。
- **替换一个已安装的同名包**（同版本号或新版本）→ 需要重启才能拿到新的 JS 模块代（skill `host-plugin.md`）。
- **只改 `client.js`** → 浏览器模块也要重新取，**刷新页面**（普通刷新即可；DSH 不对第三方 bundle 做 HMR）。
  若页面缓存顽固，用 DevTools 的 "Empty Cache and Hard Reload"。

---

## h. 日志

- `ctx.logger` 是 **Cordis 核心 Logger**（不是 DSH 服务，inspect 的 Service 目录里没有 `logger`）。
  安全写法带可选链：`ctx.logger?.info?.('[deepseek-instagram] …')`（bili `index.js:139-143`）。
- 它落到 **host 进程的 stdout/stderr**（桌面端即启动 DSH 的那个控制台/应用日志），
  **用户在设置页里看不到**。
- 想让人看到：**自己写文件**，bili 就是双写（`index.js:139-143`）：

```js
const logFile = join(HOME, 'duty.log')
const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}\n`
  try { ensureHome(); appendFileSync(logFile, line, 'utf8') } catch { /* 别因为日志把主流程搞挂 */ }
  ctx.logger?.info?.(`[bili-duty] ${msg}`)
}
```

然后在路由里暴露尾部：

```js
if (req.method === 'GET' && sub === '/log') {
  const text = existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''
  return sendJson(res, 200, { ok: true, tail: text.split('\n').slice(-200).join('\n') })
}
```

设置页 `<pre>` 渲染即可。**日志轮转自己管**（bili 用 `renameSync` 把旧文件改名）。

---

## i. 模型调用（`ctx.llm`）

### i.1 契约（inspect / `llm`）

```ts
prepareCall(config: LlmCallConfig, signal?: AbortSignal, configure?: ConfigureCall): Promise<PreparedLlmCall>
stream(options: GenerateOptions): AsyncIterable<StreamChunk>

interface LlmCallConfig extends LlmCallControls { provider: string; model: string }
interface LlmCallControls { reasoningEffort?; temperature?; maxTokens?; stop? }

interface GenerateOptions {
  provider: string; model: string; reasoningEffort?
  messages: RequestMessage[]; system?: string; tools?: ToolSchema[]; toolHistory?
  temperature?; maxTokens?; stop?: string[]; signal?: AbortSignal
  sessionId?; purpose?: 'compaction' | 'session-title'
}
type RequestMessage = Message | RequestUserInput
// RequestUserInput = { role:'user'; content: UserMessage['content']; id?: never; source?: never }
//   ↑ 一次性 prompt：不带 id/source，就不会当成会话消息记进会话

interface PreparedLlmCall { readonly config; retryPolicy; context?; inputModalities?; adapterDefaults; stream(options): AsyncIterable<StreamChunk> }

type StreamChunk =
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'block-start'; index: number; blockType }
  | { type: 'block-end'; index: number; block }
  | { type: 'tool-call-delta'; … }
  | { type: 'usage'; usage }
  | { type: 'finish'; reason: FinishReason }
// FinishReason = {kind:'stop'} | {kind:'tool-calls'} | {kind:'max-tokens'} | {kind:'aborted',failure} | {kind:'error',failure}
```

### i.2 拿默认模型

inspect / `agentDefaultModel`：

```ts
currentSelection(): ModelSelection   // "a detached provider, model, and optional reasoning selection"
saveSelection(next: ModelSelection): Promise<void>
```

profile 里它被钉成（`profiles/desktop/cordis.patch.yml:4-9`）：

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-account
    model: deepseek-flash
    reasoningEffort: max
```

用法（`inject` 里要加 `'llm'`、`'agentDefaultModel'`）：

```js
const sel = ctx.get('agentDefaultModel')?.currentSelection?.() ?? {}
const provider = sel.provider || 'deepseek-account'
const model = sel.model || 'deepseek-flash'
const reasoningEffort = sel.reasoningEffort          // 可能 undefined
```

> ⚠️ `ModelSelection` 的字段声明没有被 inspect 暴露；从 `currentSelection()` 的描述
> （"a detached provider, model, and optional reasoning selection"）+ 配置行可确定是
> `{ provider, model, reasoningEffort? }`。第一次跑时 `console.log` 一下实际对象最稳。

### i.3 一次 prompt → 文本（完整可抄）

```js
async function askOnce(ctx, prompt, { system, signal } = {}) {
  const sel = ctx.get('agentDefaultModel')?.currentSelection?.() ?? {}
  const cfg = { provider: sel.provider || 'deepseek-account', model: sel.model || 'deepseek-flash' }
  if (sel.reasoningEffort) cfg.reasoningEffort = sel.reasoningEffort

  const call = await ctx.llm.prepareCall(cfg, signal)      // 校验 provider/model、拿适配器
  let text = ''
  for await (const chunk of call.stream({
    ...cfg,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],  // 一次性 prompt，不落会话
    signal,
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'reasoning-delta') { /* 思维链，按需 */ }
    else if (chunk.type === 'finish') {
      if (chunk.reason.kind !== 'stop') throw new Error(`模型没正常结束：${chunk.reason.kind}`)
    }
  }
  return text
}
```

- 也可以不经 `prepareCall`，直接 `ctx.llm.stream(cfg + messages)`。
- `content` 的形态：本仓库里 user content 是**分片数组** `[{ type:'text', text }]`
  （对照 inspect 的 `AdmittedPromptContentPart = { type:'text'; text } | { type:'image'; … }`）。
  若你的 DSH 版本类型报错说 content 是 `string`，改成 `content: prompt` 即可（纯 JS 运行时两者都能被适配器归一）。
- `purpose` 只接受 `'compaction' | 'session-title'`，插件别乱传。
- 停止：`exec.signal` / 自己的 `AbortController` 透传 `signal`；`finish.reason.kind === 'aborted'` 时别当成功。

---

## j. 安装 / 重启流程

### j.1 安装

官方途径只有一条（skill `host-plugin.md` + `plugin_manager` 工具）：

```
plugin_manager({ action: "install_bundle", target: "<本地包目录或安装 spec>" })
```

> 不要手改 profile 的 `package.json` / `cordis.patch.yml`，也不要在 profile 目录里 `pnpm add`。

本地开发时目标传**目录**（`D:\Space\Workspace\deepseek-instagram`）或 `link:` 形式；
bili 的注释写的旧 CLI 等价物是 `dsh plugin --profile web add link:<你的插件目录>`（`cordis.patch.yml:8-9`）。
本地目录是**链接安装**，所以改文件不用重装（只需重启，见 §g.3），但 `files` 字段不过滤。

### j.2 装完之后 profile 会变成什么样

`C:\Users\Ez4p1\.dsh\profiles\desktop\package.json` 会多两处（以 bili 为证）：

```json
{
  "dependencies": { "dsh-bili-scroll": "^0.1.7" },
  "dsh": { "profile": { "bundles": ["…", "dsh-bili-scroll", "…"] } }
}
```

**`dependencies` 和 `dsh.profile.bundles` 都要有**；只写一处不会生效。
profile 自己的 `cordis.patch.yml` **不会**被安装改写 —— 里面那些 `- id: bili-scroll` 是用户后来
在设置里改配置时叠加出来的覆盖层（`profiles/desktop/cordis.patch.yml:43-47`）。

### j.3 要不要重启

看 `install_bundle` 返回的 `application` 字段：

| `application` | 含义 | 你要做什么 |
| --- | --- | --- |
| `applied` | 已生效（**新** bundle 可以借 HMR 直接激活） | 刷新页面看设置页 |
| `restart-required` | 需要重启（**替换**已安装包、换 JS 模块代） | 重启 DSH |
| `failed` / `overridden` | 没装上 / 被覆盖 | 读 `warnings` 修清单再装 |

同时看 `warnings`（尤其 `1 entry did not activate … failed to import` —— 就是 §a 那个裸 import 坑）。

### j.4 验证清单（别用 `list_plugins` 判断）

```jsonc
// cordis_inspect_query: platform=host, provider=Config, method=listConfigs
// 找你的行：id=deepseek-instagram、config 是否被 schema 填了默认值
```

1. `Config.listConfigs` 里能看到 `deepseek-instagram` 行，且 `config` 有值；
2. Host 日志里有 `[deepseek-instagram] 已激活`；
3. `curl http://127.0.0.1:42586/api/deepseek-instagram/state` 返回 JSON；
4. 设置 → 左侧出现「Instagram」；点开不白屏；
5. 新会话里问模型「有哪些 ig_ 工具」→ 能看到 `ig_status`。

### j.5 开发循环（最省事）

| 改动 | 动作 |
| --- | --- |
| `client.js` | 刷新页面（不行就 hard reload） |
| `index.js` | 重启 DSH |
| `cordis.patch.yml`（包内） | 重启 DSH（包内 patch 在安装时已固化进 profile 层的顺序里；改它要重装或重启） |
| profile 自己的 `cordis.patch.yml` | 热重载（存盘即生效） |
| `package.json` 的 `dsh.client.inject` 等 | 重启 + 刷新 |

---

## 附：最容易踩的三个坑（按杀伤力排序）

1. **裸 `import '@deepseek-ai/…'` → 整个插件静默不激活。**
   桌面版 `autoInstallPeers:false`、`DSH_HOST_MODULES` 为空、profile 里也没 `dsh-tools`；
   症状只有一条 `warning: 1 entry did not activate … failed to import`。
   → 工具定义写普通对象（§d.3），schemastery 只在动态 import 成功时才导出 `Config`（§a.3）。

2. **`additionalProperties` + 「属性表 vs 完整 schema」。**
   `parameters` 传属性表；`output.schema` / 任何 `type:'object'` 的 schema 必须写 `additionalProperties`，
   否则 `defineTool` 抛错（bili 2026-10-14 那次报错就是这个）。返回值还要**无损 JSON**。

3. **定时器 / 路由的生命周期与异常。**
   定时器回调抛异常会拖垮整个 Host 进程（必须整体 try/catch）；
   `(kind,path)` 重复注册直接 throw（热重载/重复 insert 时最容易撞上）——一律用 `ctx.effect` 包住注册，
   依赖 `ctx.interval` 或自己 `clearInterval`。

### 次级坑（也会咬人）

- 设置页里 `require` 了任何 Harness Client 包 → slot 渲染抛错 → **整页空白**，控制台只有 `slot entry crashed`。
- `fetch` 不检查 `res.ok` → HTTP 500 被当成成功（bili 专门写注释修过）。
- `Config` 里写了会校验失败的约束（`.max(20)`）→ cordis 直接丢整条 entry。
- loader `id` ≠ 模块 `name` ≠ settings 命名空间 → `settings.update()` 报 `no volatile fields`。
- 把配置读成常量 → volatile 就地更新后读到旧值（每次用前重读）。
