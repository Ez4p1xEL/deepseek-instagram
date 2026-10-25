# deepseek-instagram

把 Instagram 变成你的 **DSH 助理**——它有自己的名字、心情和记忆，每天按计划发最多 **10 条 Story**（数据卡 / 助理感想 / 纯文本 / 生活片段）和一条 Note，讲它看到的主人的一天；**只有主人账号的私信**能指挥它干活。

- 📖 Story：四种类型混排，卡片本地 Pillow 渲染（不读你的聊天内容）
- 人格：名字、心情、自我设定、最近的记忆都会写进文案，让它像同一个人连续在写
- 💬 Note：≤60 字符的一句话，可混入你当天随手写的生活素材
- 🛡️ 安全阀：按类型每日上限 / 最小间隔 / 安静时段 / 90 分钟补发窗口 / 一键暂停
- ⚙️ 设置页：`设置 → Instagram`（状态、计划、人格、主人与私信、登录、节奏、安全阀、日志）

## 安装

插件是标准 DSH bundle，用官方途径装进 desktop profile：

```
plugin_manager install_bundle  target = D:\Space\Workspace\deepseek-instagram
```

或者命令行等价物：

```bash
dsh plugin --profile desktop add link:D:\Space\Workspace\deepseek-instagram
```

装完按返回的 `application` 字段处理：`applied` 刷新页面即可，`restart-required` 需要重启 DSH。装好后左侧「设置」里会多出 **Instagram** 一项。

## 第一次使用（3 步）

1. **安装依赖**：设置页点「安装依赖」。会在 `$DSH_HOME/instagram-assistant/.venv` 建一个独立 venv，安装 `instagrapi` 与 `pillow`（默认源失败会自动换清华镜像）。进度看设置页的安装日志。
2. **登录**：电脑浏览器登录 instagram.com → F12 → Application → Cookies → `https://www.instagram.com` → 复制 `sessionid` → 粘进设置页 → 登录。凭证只落在 `$DSH_HOME/instagram-assistant/`（`session.json`、`credential.json`），不会上传。
3. **绑定主人**：「主人与私信」里填你的账号（例如 `ez4p1xel`）→ 点「绑定主人」。插件会把它解析成数字 user id 存下来；**只有这个 id 发来的私信会被当成指令**。
4. **配置内容**：填 `@handle`、每天几条 Story（默认 10）、活动时间窗（默认 08:30–23:00）、Note 时间（默认 12:30）、语气；想发生活素材就写在「今天的生活素材」里（例如「下午去海边走了走」）。

之后：

- **全自动**（默认）：按当天的计划到点自己发（每天 10 条随机时刻，类型混排；受安全阀约束）。
- **草稿确认**：到点只生成预览，你在设置页看图和文案，点「发布这条」才真正发。
- **主人在私信里遥控**：短指令（发布 / 预览 / 暂停 / 恢复 / 状态 / note）和自然语言都行（见下节）。
- **错过就错过**：某条超过时间窗 90 分钟还没发出去，就不补发了，避免开机后一次性刷屏。

## 用自然语言指挥她

主人在私信里可以直接说人话，她能听懂并**真的去做**：

| 你说 | 她做什么 |
| --- | --- |
| 「回复一下你未读的私信内容」 | 挑出没回的 1:1 私信（72 小时内、最多 5 条），先用陌生人语气各写一条回复给你看 |
| 「让本机 DSH 跑一下测试」 | 在本机执行 `dsh headless "<任务>"`（对接电脑上的 DSH），跑完把结果私信给你 |
| 「在本机执行 git status」 | 在本机跑这条命令（经 cmd.exe），同样把输出回给你 |
| 「状态 / 暂停 / 恢复 / 发一条 / 发note / 草稿 / 自动 / 帮助」 | 原有短指令，直接执行 |

**会对外发消息或在本机跑东西的动作，一定先给草稿**：她把要发的内容/要跑的命令列给你，你回「发」才执行，
回「取消」就作废；草稿只保留最新一份，**10 分钟**没确认自动失效。
识别走两条路：关键词（快、离线）优先，其次才是模型意图识别——模型只能从固定动作清单里选一个，选不出来就当闲聊，
不会乱执行。群聊里的消息永远不执行指令。


## 模型可见的工具

| 工具 | 作用 |
| --- | --- |
| `ig_status` | 完整状态：开关、模式、登录、今日发布、下次窗口、日志 |
| `ig_stats` | DSH 使用统计（今日/本周时长、连续天数、活跃时段、token、花费） |
| `ig_plan` | 今天的计划：每条的時刻、类型、状态（已发/到点/错过），剩余条数 |
| `ig_draft` | 生成下一条的预览（卡片 + Story 文案 + Note 文案），不发布 |
| `ig_publish` | 发布已生成的预览（`kind: story / note / all`） |
| `ig_run` | 立刻跑一轮（全自动发下一条到点的，草稿模式只出预览） |
| `ig_login` | 用 sessionid 登录 |
| `ig_persona` | 读/写人格卡 `persona.md`（她不传 md 时只读） |
| `ig_config` | 读写插件设置（模式、时间、语气、handle、生活素材、安全阀、群聊、@主人） |

## 她是谁：人格卡 persona.md

- 文件在 `$DSH_HOME/instagram-assistant/persona.md`，设置页里可以直接编辑。
- 写 Story / Note / 群聊回复时，它是 **system prompt 的第一优先设定**；没写时用内置性格。
- 名字、身份、说话方式、禁忌都写在这里；改完下一条内容就生效，不用重启。
- 她会**记得自己发过什么**（最近 6 条记忆 + 未完结的话题），所以 10 条 Story 读起来像同一个人。

## 每天 10 条 Story 的节奏

- 在 `dayStart`–`dayEnd` 之间按 10 条均分时间（每条之间 ≥ 安全阀最小间隔 + 5 分钟），类型轮换：数据卡 / 生活 / 助理感想 / 纯文本。
- 到点自动发（全自动模式）或出预览（草稿模式）；**补发窗口 90 分钟**，错过就跳过，避免一次补 9 条。
- 每条 Story 都会 **@ 主人**：图上贴 `StoryMention` 贴纸（位置可在设置页调），文案里也带 `@主人`。
- 纯文本 Story 是 Pillow 渲染的文字图（私有 API 没有文字 Story 接口），排版会避免标点/单位跑行首。

## 群聊

- 只处理**主人在的群**；默认「被 @ 或叫名字（小 p）才回」，同一群冷却 90 秒、每小时最多 8 条。
- 群里的消息**不会**被当成指令执行；只聊天，且不会透露你的使用时长/token/花费。
- 开关和节奏在设置页「群聊」卡片里改（「功能开关」卡片里也有同一个总开关）。

## 设置页的功能开关

设置页顶部的「功能开关」卡片把这六件事都做成可切换项（配置字段在 `config.json`，改完下一轮轮询就生效）：

| 开关 | 配置 | 默认 | 说明 |
| --- | --- | --- | --- |
| 别人的私信：自动回复 | `dm.autoReply` | `off` | `off` 不回复 / `all` 所有人都回复 / `mutual` 仅互关回复 / `follower` 对方关注我就回 |
| 收到别人私信时提醒主人 | `dm.notifyOwner` | `true` | 通过 IG 私信发给主人，同一个发送者 30 分钟内最多提醒一条 |
| 群聊中回复别人 | `group.enabled` | `true` | 关掉后连群消息都不再处理 |
| 自动发布 Story | `publish.story` | `true` | 只拦自动排期；手动「发布/预览」仍可用 |
| 自动发布 Note | `publish.note` | `true` | 同上 |
| 私信远程控制 | `dm.intents` | `true` | 关掉后私信里的自然语言指令（回未读私信、让本机跑任务）不再执行；短指令（状态/暂停/恢复/发一条/帮助）照常 |

- 别人的私信**永远不会**被当成指令执行；最多是「提醒主人」或按档位自动回一句（自动回复也要过每天回复上限与同人 10 分钟冷却）。
- 关系档位查不到关注关系时，选择 `mutual` / `follower` 的会**不回**（只记日志），不会猜。

## 数据从哪来

- **使用时长 / 活跃时段 / 连续天数**：读 `$DSH_HOME/sessions/**/session.v4.jsonl.zstd`，把事件时间聚合成「活动块」（相邻事件间隔 ≤5 分钟算同一段，尾部 +1 分钟），按本地时区切天。只取**时间戳**，不读消息内容。
- **token / 花费**：读 `$DSH_HOME/.dshw-usage.json` 的 `history`（按日花费，CNY）与 `events[].tokens`。
- **助理自己的用量**：助理每次调用模型（Story、Note、私信、群聊、陌生人回复、指令识别）都会把
  `inputTokens / cacheReadTokens / outputTokens` 记进 `$DSH_HOME/instagram-assistant/usage.json`；
  设置页「AI 助理用量」卡片显示今日 / 近 7 天的 token 与人民币估算。金额按 DeepSeek 官方价目表 + 峰谷价
  （工作日 9–12、14–18 峰价，周末与法定节假日全天空闲价）计算，只统计助理自己发起的调用。
- **文案**：优先用当前默认模型（`ctx.llm`）润色，模型不可用时退回模板，**绝不因为模型失败而停发**。
- **卡片**：本地 Pillow 渲染（`vendor/instagram-mcp/render_card.py`），不上传任何数据到第三方。

## 风险与限制（请先读）

- 使用的是 Instagram **私有移动 API**（instagrapi），违反 Instagram 使用条款，**存在账号被限流/封禁的风险**。插件默认草稿确认、低频率、按本地时段发布，就是在压低这个风险。
- `sessionid` 从浏览器导出后，Instagram 可能随时让它失效（尤其你又在别处登出/换设备）。失效时插件会**标记需要重登、自动暂停发布**，不会反复重试。
- 触发人机验证（challenge）时插件不会硬闯，会在日志里提示你去手机 App 处理。
- Note 上限 60 字符；Story 目前只发**单张图片**（不支持视频/Reels；「纯文本 Story」其实是 Pillow 渲染的文字图，因为私有 API 没有文字 Story 接口）。
- 私信/群聊都只认主人绑定的 **user id**（不认昵称）：别人的私信不会执行指令，是否自动回复由设置页「功能开关」决定；群聊只回主人在的群，且不会执行任何指令。
- 私信/群聊的回复**只针对对方刚发的那一条**（更早的消息只当背景，助理自己的话标成「我」），
  并且同一条消息只回一次（轮询有单飞闸）；冷却与每小时上限仍是防刷屏的闸。
- 拿不到的信息它会直说拿不到，不会拿心情/记忆把问题岔开（2026-10-25「答非所问」修复，见排障）。
- 不是官方 Graph API，不提供多账号、点赞、涨粉等能力（也刻意不做）。

## 排障

**「本轮运行失败：Invalid schema for function 'ig_config': schema must be a JSON Schema of 'type: "object"', got 'type: null'」**
—— 2026-10-25 修掉的老 bug（v0.1.1）：工具定义没有归一化成 `{type:'object', properties}` 就直接注册了，
provider 于是拒绝**每一条**带工具列表的请求。临时救急：`plugin_manager set_plugin deepseek-instagram enabled=false`，
重启 DSH 即可恢复对话。回归测试在 `test/tools.test.mjs`、`test/apply.test.mjs`。

**「本轮运行失败：messages.69: `tool_addition` blocks can only be in `system` messages」**
—— 2026-10-26 遇到：某个长会话里累计了几十条「工具注册变更」（插件被反复 disable/enable、Host 重启都会产生），
DSH 把它们投影成 developer/system 消息；历史一长、位置一偏，DeepSeek Messages 接口就会拒绝整条请求。
**这不是插件逻辑的问题，插件本身还在跑（Story/私信照常）**。处理：**新建一个会话继续**（旧会话历史里的
脏块带不走），必要时重启 DSH。预防：**不要在聊天进行中开关插件**——要改 Host 代码就先结束对话、重启 DSH，
或改完直接开新会话。

**设置页没有「Instagram」** —— 先确认 profile 的 `cordis.patch.yml` 里这一条不是 `disabled: true`，
再确认 DSH 是重启过的（Host 代码改动必须重启才生效，只刷新页面不够）。

**一直「还没登录」** —— 浏览器导出的 `sessionid` 可能已被 IG 作废：重新导一次，在设置页粘贴保存；
插件在检测到登录失效时会自动暂停发布并在日志里写明。

**点了发布没反应 / 只发出一半** —— 先看设置页按钮下面的提示，现在会逐类显示原因（`story: …`、`note: …`）。
安全阀的判定顺序：暂停 → 失败冷却 → 每日上限 → 每类每天一次 → 最小间隔 → 安静时段。
其中**失败冷却只对「网络 / 限流 / 未知错误」生效**（2026-10-25 修）：未登录、人机验证这类
「识别得出来的问题」不再冷却，处理完可以立刻重试。
同一个自然日想连发 Story + Note 时会被 `minIntervalMinutes`（默认 30）拦住，属正常保护；
临时把「最小间隔」改成 0 发完再改回来即可。单测回归在 `test/safety.test.mjs`。

## 开发

```bash
node test/run.mjs      # 全部单元测试（进程内跑，沙箱可用）
node scripts/probe_shape.mjs   # 看一眼本机 DSH 会话事件形状
```

代码结构：

```
index.js                 Host 半端：路由 / 工具 / 定时器 / venv 安装 / 草稿与发布
client.js                设置页（window.__ModuleLoader__ 自注册，非 ESM）
lib/usage.mjs            纯函数：事件 → 活动块 → 按天/周/连续天数/活跃时段
lib/dshusage.mjs         IO：读 zstd 会话日志与计费文件，产出 content 需要的 stats
lib/content.mjs          文案模板、LLM prompt、Story 卡片 spec
lib/safety.mjs           发布安全阀（暂停/上限/间隔/安静时段/失败冷却）
lib/plan.mjs             当天的 10 条 Story 计划（种子=日期，可重算）
lib/persona.mjs          人格/记忆/语气 → 给模型的 prompt
lib/commands.mjs         主人私信指令判定（只认 ownerPk）
vendor/instagram-mcp/ig_cli.py    instagrapi 一次性 CLI（登录/uid/发 Story/发 Note/私信轮询与回复/诊断）
vendor/instagram-mcp/render_card.py  Pillow 1080×1920 卡片渲染
test/*.test.mjs          单元测试（node:test）
docs/research/           设计调研（含 DSH 插件实现指南）
```

插件家目录 `$DSH_HOME/instagram-assistant/`：

```
config.json      设置
session.json     instagrapi 会话（含设备指纹与授权，勿外传）
credential.json  你粘贴的 sessionid
account.json     登录后的账号信息
posts.json       发布历史（幂等 / 安全阀依据）
persona.json     人格与记忆（名字/心情/自我设定/最近的记忆/话头）
dm-state.json    私信水位与今日回复数
drafts/<day>.json  当天预览（story + note）
out/card-<day>-<index>.png  当天第 index 条的卡片
log.txt          运行日志（设置页显示）
install.log      依赖安装日志
.venv/           独立 Python 环境
```

## License

MIT
