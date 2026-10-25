# AGENTS.md —— deepseek-instagram 开发须知

给接手这个插件的 agent/开发者。先读 `README.md`，再读这里的环境坑。

## 硬约束（改代码前必看）

1. **不要 `import '@deepseek-ai/*'`。** 桌面版 profile 是 `autoInstallPeers:false`、`DSH_HOST_MODULES` 为空，
   裸 import 会让整条插件**静默不激活**（只有一行 `warning: … failed to import`）。
   工具定义写普通对象；`Config` 只在动态 import schemastery 成功时才导出（本插件干脆不导出 Config）。
2. **Host ↔ Client 只走 HTTP 路由**（`ctx.webServer.register({kind:'prefix', path:'/api/deepseek-instagram'})`）。
   没有插件自定义 RPC。
3. **定时器回调整体 try/catch**：抛出去会拖垮 Host 进程。所有定时器用 `ctx.effect(() => ctx.interval(...))` 包裹。
4. **工具返回值必须无损 JSON**（没有 Uint8Array/Date/Map）。
5. `client.js` **不是 ESM**：`window.__ModuleLoader__.load({id:'deepseek-instagram', factory})`，
   factory 里只 `require('react')`，不要 require 任何 Harness Client 包（会让整个设置页白屏）。
6. 路由 `(kind,path)` 重复注册会 throw —— 注册一律包在 `ctx.effect` 里，让热重载能清理。
7. 设置页写死的颜色一律带主题 token fallback：`var(--dsw-alias-label-tertiary,#9aa0a6)`。
   `client.js` 里 `asJson()` 收到的是 `Response`，所以每个 `fetch()` 都必须 `await` ——
   少写一个，设置页整页报「读取失败：HTTP undefined」（回归测试 `test/client.test.mjs`）。
8. **工具定义必须走 `textTool()`**（`index.js`）：它把 `parameters` 归一化成
   `{type:'object', properties:{…}}` 再交给 `ctx.tools.register()`。
   `register()` **不会**替你转换（那是宿主 `defineTool` 的活，而本插件不能 import 宿主包）。
   直接传属性表 ⇒ provider 侧 `parameters.type === null` ⇒
   `Invalid schema for function 'ig_config': schema must be a JSON Schema of 'type: "object"'`，
   而且这是**每条带工具列表的请求都会挂**（用户直接发不出消息）。
   回归测试：`test/tools.test.mjs` + `test/apply.test.mjs`（用假 ctx 真跑一遍 `apply()` 检查全部工具）。
9. **不要在用户正在聊天时 disable/enable 插件**（也别频繁重启 DSH）。每次增删工具都会在会话里记一条
   `developer/message`（`source:{kind:'tool-registry'}`，内容 `tool-addition`/`tool-removal`）；攒多了以后
   DeepSeek Messages 接口会整条拒绝：`messages.N: tool_addition blocks can only be in system messages`。
   本机 2026-10-25 那个会话里攒了 **74 条**（因为反复 reload）。正确做法：改完 Host 代码 → 让用户**开新会话**
   （或重启 DSH）再验证；旧会话只会越来越脏。
10. **运行时零第三方 DSH 插件依赖。** 只允许官方内置模块与 `react`：`index.js` 只 import `node:` 与 `./lib/*.mjs`，
    `client.js` 只 `require('react')`，`package.json` 不得出现 dependencies/devDependencies/peerDependencies；
    不 import 任何其他插件的代码、不读它们的文件/账本（例如鲸鱼挂件的 `.dshw-usage.json` 只当背景事实，不用）。
    文档层面只引用官方 skill（`dsh-agent-preset/skills/cordis-plugin-development`），不把第三方插件当依据。
    该约束由 `test/no-third-party.test.mjs` 强制（静态 import、动态 require/import、package.json、Python 依赖四类扫描）。
    读官方 asar 里的文件用 `scripts/asar-extract.mjs`（导出到 `.tmp/asar/`，本身不入库）。

## 本机（Windows）沙箱坑

- `ops_bash` 在本会话不可用（bash 起不来，`CreateFileMapping … Win32 error 5`）。用 `pwsh`。
- `node --test` 会 spawn 子进程 → Windows 沙箱报 `spawn EPERM`。用 `node test/run.mjs`（进程内 import 所有测试文件）。
- 在这个沙箱里 `python -m venv` 可能因 ensurepip 子进程被拒而失败；绕法是
  `python -m venv --without-pip X` → `X/Scripts/python.exe -m ensurepip --upgrade` → 再用 pip。
  （插件自己装依赖时走的是 Host 进程，不受这个限制，但保留同样的兜底逻辑。）
- **Python 的 stdin/stdout 在 Windows 默认不是 UTF-8**：两个 `vendor/instagram-mcp/*.py` 都必须用
  `sys.stdin.buffer.read().decode('utf-8')` 与 `sys.stdout.buffer.write(...encode('utf-8'))`。
  否则中文会变成乱码（曾经踩过：卡片上全是“滻娣”）。
- pypi.org 可能卡在 wheel 下载（pip 长时间无输出、CPU 空转）。用清华镜像
  `-i https://pypi.tuna.tsinghua.edu.cn/simple`；插件的安装流程已做「默认源失败→镜像重试」。
- `curl` 被沙箱挡（返回 000），测网络用 `node -e "fetch(...)"`。

## 本机 DSH 事实

- `DSH_HOME=C:\Users\Ez4p1\.dsh`，profile `desktop`：`C:\Users\Ez4p1\.dsh\profiles\desktop`。
- 会话日志 `$DSH_HOME/sessions/<workspace-bucket>/session.v4.jsonl.zstd`，每行一个事件：
  `{type, seq, time(ms), data}`；首行 `type:'session'` 是头。
  `assistant/message` 的 `data.usage = {inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens}`。
- 计费 `$DSH_HOME/.dshw-usage.json`：`history` 是 `{day: CNY}`，`todayUsage` 是今日 CNY，
  `events[]` 是 `{ts, day, model, cost, tokens}`。
- 插件安装：`plugin_manager install_bundle`（target=本目录绝对路径）。装完看返回的 `application`
  字段决定要不要重启。改 `index.js` 必须重启；改 `client.js` 刷新页面。
- 验证清单：`cordis_inspect_query(host, Config, listConfigs)` 里看 `deepseek-instagram` 行；
  `Invoke-RestMethod http://127.0.0.1:<当前GUI端口>/api/deepseek-instagram/state` 能出 JSON（端口每次重启会变，看 runtime context）；设置页出现「Instagram」；
  新会话里模型能看到 `ig_status`。

## 测试

```bash
node test/run.mjs                       # 113 个单测，进程内跑（node --test 会被沙箱 spawn EPERM 挡掉）
node -e "import('./lib/dshusage.mjs').then(m=>console.log(m.buildStats({home:'C:/Users/Ez4p1/.dsh'})))"
echo '{}' | .venv/Scripts/python.exe vendor/instagram-mcp/ig_cli.py doctor
Get-Content out/demo-card.png            # 或直接看设置页预览
```

单测覆盖：时区切日、活动块合并、跨午夜切分、周累计/连续天数、文案长度、卡片 spec、安全阀
（暂停/按类型上限/最小间隔/安静时段/失败冷却只对瞬时错误）、发帖计划（窗口内 10 条、随机不撞车）、
人格（解析/记忆/情绪）、私信指令判定（只认 ownerPk）、工具 schema 归一化、client 静态契约、
会话解析（多帧 zstd）、计费文件解析、stats 合并。

## 人格 / 计划 / 私信（2026-10-26 新增）

- `lib/plan.mjs`：`dayPlan({day,count,start,end,minGapMinutes,timeZone})` 按天生成固定计划（种子=日期，
  重启/重算结果一致）；`kindQuota(count)` 决定 10 条里各类数量。**计划必须可重算且稳定**，否则 tick 会重复发。
- `lib/persona.mjs`：`loadPersona/savePersona/remember/setMood/systemPrompt/storyBrief/noteBrief/parseReply`；
  人格与记忆存 `$DSH_HOME/instagram-assistant/persona.json`，**文案必须基于它**，不要另写模板。
- `lib/commands.mjs`：`decideMessage(message,{ownerPk,lastHandledId})` 判定是否执行；
  **只认 `message.userId === ownerPk`**（数字 id，不是昵称）；非主人只读不回。
- Host 侧：`dmPoll()` 每 120 秒一次（force 可立刻），首次只记 `lastHandledTs` 水位，不回历史消息；
  回复受 `cfg.dm.dailyReplies` 限制。`tick()` 每 60 秒检查下一条到点的 Story。
- 补发窗口 `SLOT_GRACE_MS = 90 分钟`：超过就记 `missed`，不补发，避免积压刷屏。
- 卡片：数据卡 `out/card-<day>-<index>.png`；纯文本/感想用 `render_card.py` 的 `mode:'text'`。
- 旧字段 `safety.dailyCap` 只是兼容痕迹，**不再当总量上限用**（按类型用 storyCap/noteCap）。

## 人格卡 / 群聊 / Story @ 主人（2026-10-26 第二批）

- `persona.md` 是人格卡的**唯一事实来源**：`$DSH_HOME/instagram-assistant/persona.md`。
  `loadPersonaMd(home)` 返回 `{md, isDefault, path}`（注意是对象，不是字符串；
  Host 里用 `personaMdNow()` 取字符串）。`systemPrompt({cfg,persona,personaMd})` 里人格卡优先于内置性格。
- 群聊：纯决策在 `lib/commands.mjs` 的 `groupDecision({cfg,threadRow,message,state,now,hourKey})`，
  返回 `{reply, reason}`；Host 的 `replyInGroup()` 只负责生成与发送。规则：只回主人在的群、
  mention 模式要被 @ 或叫「小 p」、每群冷却 `group.cooldownSeconds`、每小时上限 `group.hourlyCap`。
  **群里的消息永远不执行指令**（只有 1:1 主人私信才会）。
- Story @ 主人：`mentionPayload(cfg)`（index.js 导出在 `__mention`）产出
  `{mentionHandle, ownerPk, mentionX/Y/Width/Height}`；`ig_cli.py story` 用
  `StoryMention(user=UserShort(pk=ownerPk), x,y,width,height)` 贴纸 + caption 里的 `@handle`。
  `ownerPk` 为空时 ig_cli 会用 `user_id_from_username` 现查一次。
- 新增路由：`GET/POST /persona-md`、`GET /dm/threads`；新工具 `ig_persona`。
- 私信轮询条件改成 `dm.enabled || group.enabled`（只开群聊也能轮询）。
- 单测现在 **113** 个：`node test/run.mjs`。新增覆盖：mentionPayload、groupDecision、多帧 zstd、
  指令清单/意图 JSON 校验（actions）、未读私信挑选（unread）、关注关系档位与提醒节流（features）、
  峰谷计价与用量账本（pricing/spend）、回复上下文与单飞闸（reply/singleflight）、
  零第三方依赖护栏（no-third-party：静态 import / 动态 require / package.json / Python 依赖）。

## 约定

- 中文注释、中文 UI 文案（用户是中文用户）。
- 任何失败都要落到 `log.txt` 并在设置页可见；不要静默吞错（LLM 兜底除外，那里会降级为模板）。
- 新功能先进 `lib/`（纯函数 + 单测），Host 层只做编排与 IO。



