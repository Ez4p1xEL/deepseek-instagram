# DSH 插件实现指南（官方来源版）

> 目标：在 desktop profile 里写/维护一个「Host 半端 + Web 设置页」插件（本仓库 `deepseek-instagram`）。
>
> **依据只有 DSH 内置文件**，不再引用任何第三方插件代码：
>
> | 来源 | 位置（都在 DSH 安装目录里） |
> | --- | --- |
> | 官方 skill | `…/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/SKILL.md` |
> | Host 端规范 | 同目录 `references/host-plugin.md` |
> | Client 端规范 | 同目录 `references/ui-plugin.md` |
> | 实践规则 | 同目录 `references/practices.md` |
> | 验证规则 | 同目录 `references/verification.md` |
> | 动作/工具一致性 | 同目录 `references/user-actions.md` |
> | 模板 | 同目录 `templates/decoration/{package.json,cordis.patch.yml,index.js,client.js}` |
> | 运行期契约 | `cordis_inspect_query`（Service / Event / Config / Slots / Theme） |
> | 本仓库实现 | `index.js`、`client.js`、`lib/*.mjs`（已在 desktop profile 跑通） |
>
> 官方文件在 `app.asar` 里，shell / node / ripgrep 都读不了；本仓库用
> `node scripts/asar-extract.mjs cordis-plugin-development` 把它们导出到 `.tmp/asar/` 再读（只用于查阅与对照）。
>
> **本仓库的硬规则（2026-10-26 起，由 `test/no-third-party.test.mjs` 强制）**：
> 除 DSH 官方内置文件外，不 import / require / 依赖任何第三方 DSH 插件；`package.json` 零依赖；
> 允许的只有 `node:` 内置模块、仓库内相对路径、`client.js` 里的 `react`（宿主浏览器模块表提供）。

本机事实：`DSH_PROFILE=desktop`、`DSH_HOME=C:\Users\Ez4p1\.dsh`、插件家目录
`$DSH_HOME/instagram-assistant`、profile 里 `autoInstallPeers:false`、`DSH_HOST_MODULES` 为空。

---

## 0. 一个插件就是四类文件

```
deepseek-instagram/
├─ package.json        # 清单：说明这是 bundle、Client 在哪、导出哪些文件
├─ cordis.patch.yml    # 挂载声明：往 profile 的配置树 insert 一条插件行
├─ index.js            # Host 半端（Node）：注册工具 / HTTP 路由 / 定时器
└─ client.js           # Web 半端（浏览器）：自注册脚本，画设置页
```

可选的官方文件：`locale/*.json`（`meta.title` / `meta.description`）与 `icon.svg`，
用于 Plugin Manager 和设置页展示；本仓库目前**还没有**，属于已知缺口（见 §1.3）。

机制（官方 `host-plugin.md:3`）：bundle 的 `package.json` 声明 `dsh.bundle.patch`，
DSH 把这个 YAML 叠进 profile 配置树；patch 里 `insert` 的每一行
`{ id, name, config }` 对应一个插件行，Host 进程据此 import `name` 指向的包并调用它的 `apply()`。

---

## 1. package.json

### 1.1 官方最小形态（Host-only，`host-plugin.md:7-18`）

```json
{
  "name": "@local/my-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

### 1.2 带 Web 设置页的形态（`templates/decoration/package.json`）

在最小形态上增加：

```json
{
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
    }
  }
}
```

`dsh.client.inject` 只决定 Client 端插件的激活顺序（`practices.md:35`），**不是**模块导入；
`dsh.client.platform` 目前写 `"web"`。

### 1.3 本仓库的清单

对照本仓库 `package.json`：

- `name` = `deepseek-instagram` = `client.js` 里 `__ModuleLoader__.load({ id })` 的 id = patch 的 `name`（三者必须一致，否则 Client 注册不上、Host 也挂不上）。
- `exports` 有 `.`、`./client`；`files` 只列运行必需文件（不含 `docs/`、`test/`、`scripts/`）。
- `dsh.bundle.patch` 指向 `./cordis.patch.yml`；`dsh.client.platform` = `web`。
- **缺口**：没有 `locale/` 与 `icon`。官方 `host-plugin.md:31-55` 要求 Plugin Manager 能看到
  `meta.title` / `meta.description` 与图标；现在靠 `package.json` 的 `name` / `description` 兜底。
  要发布到插件市场前应补上（这是文档层面的已知 TODO，不影响运行）。

---

## 2. cordis.patch.yml

官方形态（`host-plugin.md:20-27`、`templates/decoration/cordis.patch.yml`）：

```yaml
- insert:
    - id: my-plugin
      name: '@local/my-plugin'
      config: {}
```

本仓库：

```yaml
- insert:
    - id: deepseek-instagram
      name: deepseek-instagram
      config:
        enabled: true
```

要点（官方 `host-plugin.md:3`）：一行 patch 的 `config` 会**整体替换**同名行的 config，
不是深合并；真正的用户配置在插件家目录的 `config.json`（设置页写它），patch 里只放 `enabled` 这类默认值。

---

## 3. Host 端 index.js

### 3.1 导出形态（`host-plugin.md:57-64`）

二选一，不要混：

- `export function apply(ctx, config) {}`，可选 `export const inject = [...]`、`export const Config`；
- 默认导出 service class。

本仓库用 `export function apply(ctx, config)`（`index.js:1811`）。所有注册都放进 `apply`，
用 `ctx.effect(...)` / `ctx.on(...)` 包裹并返回清理函数（官方 `host-plugin.md:64`）。

### 3.2 注册什么、在哪

| 资源 | 本仓库位置 | 说明 |
| --- | --- | --- |
| HTTP 路由 | `index.js:1817` | `ctx.effect(() => ctx.webServer.register({ kind:'prefix', path:'/api/deepseek-instagram', handler }))` |
| 模型工具 | `index.js:1974-2107` | 9 个：`ig_status/ig_config/ig_draft/ig_publish/ig_run/ig_persona/ig_history...`（每个都包 `ctx.effect`） |
| 定时器 | `index.js:2109-2122` | `setInterval(30s)` 内跑 `tick()`，整体 try/catch |

**定时器为什么不用 `ctx.interval`**（本机实测，非官方）：本插件的 `inject` 里没有 `timer`，
访问 `ctx.interval` 会抛 `cannot get property "timer" without inject`，导致整条插件不激活。
官方 `practices.md:20` 的原则同样是：可选服务要声明在 `inject` 里，否则宁可用别的方式。
我们用 `setInterval` + `ctx.effect` 清理，回调整体 `try/catch`（未捕获异常会拖垮 Host 进程）。

### 3.3 工具定义（本机实测的重要约束）

`ctx.tools.register()` 只接受**已归一化**的完整 JSON Schema：`parameters` 必须是
`{ type:'object', properties:{...} }`。桌面版不能 import 宿主包，所以 `defineTool` 的归一化必须自己做——
本仓库统一走 `textTool()`（`index.js:1802`）。

漏掉这一步的后果：provider 收到 `parameters.type === null`，于是
`Invalid schema for function 'ig_config': schema must be a JSON Schema of 'type: "object"'`，
**每一次带工具列表的请求都会被拒**（用户直接发不出消息）。
回归：`test/tools.test.mjs`（schema 形状）+ `test/apply.test.mjs`（用假 ctx 真跑 `apply()`）。

### 3.4 LLM 调用

`ctx.llm`（官方 `practices.md` 之外，本仓库实测可用的路径）：

- `ctx.get('llm')` → `llm.stream(options)`；或 `llm.prepareCall(...)` → `call.stream(options)`。
- `options = { provider, model, system, messages: [{ role:'user', content:[{type:'text',text}] }], signal }`。
- 流里除了 `text-delta` 还有 `usage` chunk（`TokenUsage`）；本仓库用它记账（`index.js:390-416` 的 `askOnceRaw`）。

### 3.5 日志与配置

- `ctx.logger` 只进 Host stdout；用户要看得见就自己写文件。本仓库写
  `$DSH_HOME/instagram-assistant/log.txt`，并在设置页路由里读尾部展示。
- 官方 `practices.md:22` 建议把可调值放进 `Config`（用户在 `cordis.patch.yml` 里改）；
  本仓库选了另一条路：独立 `config.json` + 设置页 + `ig_config` 工具，好处是热改不用重装，
  代价是 patch 的 config 只有 `enabled`（取舍记录在此，改架构前先看这一段）。

---

## 4. Client 端 client.js

官方模板（`templates/decoration/client.js:1-22`，原文照抄形态）：

```js
window.__ModuleLoader__.load({
  id: '@local/my-decoration',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    function Decoration() { /* ... */ }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'my-decoration', order: 5,
        }, Decoration));
      },
    };
  },
});
```

规则（`ui-plugin.md:9-13`、`practices.md:33-38`）：

- `__ModuleLoader__.load` 的 `id` 必须等于包名；`factory` 从浏览器模块表取 `react`，
  **不要 require 任何 Harness Client 包**（`@deepseek-ai/dsh-client-*`）——它们会变，抛错会让整块 slot 白屏。
- 资源注册放进 `apply`，用 `ctx.effect` / `ctx.on`，并返回清理函数。
- 主题只用 `--dsw-alias-*` token；不要把页面挂到 `document.body`；不要读别的插件的 DOM。
- 可见文案走 Client locale 服务（本仓库目前是中文硬编码，属已知简化）。

本仓库实现：`client.js:8` 自注册，`client.js:11` 只 require('react')，
`client.js:525` `inject: ['slots']`，`client.js:535` 向 `settings.section` 注册「Instagram」页面。

Host ↔ Client 的唯一桥是 HTTP：Client 用 `fetch('/api/deepseek-instagram/...')`（同源），
Host 用 `ctx.webServer.register` 提供；双方各自写同一个前缀常量。官方 ui-plugin 没有专门规定这条，
但 `practices.md:33` 明确禁止在 Host 服务 HTML 再塞 iframe，本仓库因此全部用 React 渲染 + fetch。

---

## 5. 本机约束与踩坑（都有回归测试或日志证据）

1. **不能裸 import `@deepseek-ai/*`**：desktop profile 是 `autoInstallPeers:false`、`DSH_HOST_MODULES` 为空，
   裸 import 会让整条插件静默不激活（只有一行 `warning: … failed to import`）。
   官方 `practices.md:35` 对 Client 包有同样要求；Host 侧这条由 `test/no-third-party.test.mjs` 守住。
2. **工具 schema 必须完整**（§3.3），否则所有带工具请求报 `Invalid schema for function`。
3. **client.js 不是 ESM**：必须是 `window.__ModuleLoader__.load({ id, factory })`；factory 里只 `require('react')`。
4. **路由注册包 `ctx.effect`**：重复注册同一个 `(kind, path)` 会 throw。
5. **改代码后的生效方式**：`index.js` / `lib/*` 改了 → **重启 DSH**（Host 端 ESM 模块缓存），
   并把 `index.js:51` 的 `BUILD` 递增，用 `GET /api/deepseek-instagram/state` 的 `build` 字段确认；
   `client.js` 改了 → 刷新设置页即可。
6. **Windows 沙箱**：python venv 走 `C:\Users\Ez4p1\.dsh\instagram-assistant\.venv\Scripts\python.exe`；
   会话日志是多帧 zstd（`lib/dshusage.mjs` 自己逐帧解）；npm 写缓存要改到 `.tmp/npm-cache`。
   细节与可调值见 `MANUAL.md`（本地文件，已 gitignore）。

---

## 6. 安装与验收

- **只走官方安装通道**：`plugin_manager({ action: 'install_bundle', target: <插件目录绝对路径> })`
  （`SKILL.md:8-10`、`host-plugin.md:66-70`）。不要手改 profile 的 `package.json` / `cordis.patch.yml`，
  不要在 profile 目录跑 pnpm。
- 读返回的 `application`：`applied` = 已生效；`restart-required` = 必须重启 DSH；
  `failed` = 要诊断。`warnings` 也要看一眼。
- 用 `cordis_inspect_query`（免审批）确认插件行与 `Config` schema；不要在没把握时 `list_plugins`（每次都要审批）。
- 本仓库的验收清单：
  1. `node test/run.mjs` 全绿；
  2. 设置页出现「Instagram」且能读到 `/state`；
  3. `/state` 的 `build` 等于刚改的 `BUILD`；
  4. 实际发一条（或私信下指令）看到行为变化。
- 验证原则（官方 `verification.md`）：不要为了截图另起浏览器、不要做 mock 预览冒充成品；
  没有浏览器控制就只验证语法/清单/slot 注册，并说明「视觉验证未做」。

---

## 7. 代码地图

| 位置 | 内容 |
| --- | --- |
| `index.js:68-94` | `DEFAULTS`（所有可配置字段的默认值） |
| `index.js:1811` | `apply(ctx, config)` 入口 |
| `index.js:1817` | HTTP 路由（`/state`、`/usage`、`/draft`、`/publish`、`/config`、`/persona-md`、`/dm/threads`、`/dm`、`/login`、`/selftest`） |
| `index.js:1974-2107` | 9 个模型工具 |
| `index.js:2109-2122` | 30 秒定时器 → `tick()` |
| `index.js:1129-1302` | 主人指令：草稿确认、本机执行、回未读私信 |
| `index.js:1359-1600` | `dmPoll` / `dmPollOnce`（私信、群聊、陌生人自动回复、提醒主人） |
| `client.js` | 设置页（React + hyperscript，`settings.section`） |
| `lib/*.mjs` | 纯逻辑：`commands` `actions` `unread` `features` `persona` `plan` `safety` `pricing` `spend` `usage` `dshusage` `content` `singleflight` |
| `vendor/instagram-mcp/` | Python 侧：`ig_cli.py`（instagrapi 封装）、`render_card.py`（卡片渲染） |
| `test/` | 113 个用例，`node test/run.mjs` 进程内跑 |

---

## 8. 变更记录

- **2026-10-26 第二版（本文件）**：重写为「官方来源版」。删除旧版中对第三方插件
  （`dsh-bili-scroll`）的代码引用与「证据来自第三方插件」的来源行；所有结论改为引用官方 skill/模板/运行期契约，
  或本仓库自己的实现与测试。新增 `test/no-third-party.test.mjs` 把「零第三方插件依赖」变成回归；
  `AGENTS.md` 增加对应硬约束。计费口径核对官方价目页（2026-10 版）。
