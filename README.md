<div align="center">

# deepseek-instagram

**住进 Instagram 的 DSH 助理。**
它带着人格、记忆和真实的 DSH 使用数据，接管账号的 Story / Note 节奏；而且只有*主人自己的账号*能通过 Instagram 私信指挥它。

[English](README.en.md) · [简体中文](README.md) · [繁体中文](README.zh-TW.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A5%200.1.7--rc.1-6c5ce7)](https://deepseek.com/harness)

<img src="https://raw.githubusercontent.com/Ez4p1xEL/deepseek-instagram/main/docs/images/story-card.png" width="300" alt="DSH 数据 Story 卡片" />
<img src="https://raw.githubusercontent.com/Ez4p1xEL/deepseek-instagram/main/docs/images/story-text.png" width="300" alt="纯文本 Story 卡片" />

<sub>两张卡片都是 Pillow 在本机渲染的 1080×1920 图片，图中数据为演示数据。</sub>

</div>

---

**deepseek-instagram** 把一个 DSH 助理变成住在 Instagram 上的人格。它不发通用鸡汤：它会观察你在 DSH 里的会话与 token 账本，把它们整理成一张小卡片，用你定义的人格卡口吻写文案，并记住自己已经说过什么。它默认每天计划 10 条 Story、1 条 Note，夜里保持安静。

账号本身就是操作界面。暂停、立刻发一条 Story、查今天的状态，甚至让同一台机器跑一个 DSH 任务 —— 都只要主人账号发一条 1:1 私信。

- **适合**：想要一个低维护、能反映自己真实电脑使用状态、有点个性的 Instagram 账号。
- **不适合**：需要 Meta 官方 API、多账号管理、Reels/视频，或自动点赞关注。这些它都不做。

## 功能亮点

- **是人格，不是模板** —— 一份 Markdown 人格卡、一个名字、一种心情和最多 60 条记忆。发帖、回私信、群聊里的语气保持一致。
- **重启也不会打乱计划** —— Story 时间点由日期做随机种子，在活跃窗口内均匀分布，相邻至少 30 分钟。重载 DSH 不会把今天重新洗牌。
- **四种 Story** —— 生活、助理感想、纯文本、数据卡。每天的配额保证你不会连收十张数据卡。
- **本机渲染 1080×1920 卡片** —— 今日专注、连续天数、本周累计、今日 token、活跃时段和生活素材，全部由 Pillow 绘制。不需要无头浏览器，也不经过云端渲染。
- **默认每天一条 Note** —— 不超过 60 字，同样由人格和当天状态生成。
- **Story @ 主人** —— 真的贴纸 + 文案里的 `@handle`，位置可调。
- **只有主人能远程控制** —— 只认绑定成主人的数字用户 id，昵称和自称一律不算。支持短指令和自然语言意图；有副作用的动作必须再回一句确认。
- **群聊存在感** —— 只在主人所在的群里回，@ 或叫人格名才触发，每群有冷却和每小时上限；群消息永远不执行指令。
- **完整的安全阀** —— 暂停开关、按类型每日上限、最小间隔、安静时段、失败冷却，以及 90 分钟补发窗口。
- **DSH 内的设置页** —— 状态、今天的计划、人格卡编辑、登录、用量、日志和发布记录都在里面；改 JSON 只是可选项。
- **给模型 9 个工具** —— 同样的控制能力在任何 DSH 会话里都能用，你可以直接在聊天里让它写稿、发布或查状态。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| **DSH** | ≥ `0.1.7-rc.1`。桌面版 profile 是主要目标，Web 版也能用。 |
| **Node.js** | ≥ 22。DSH 运行时自带兼容的 Node.js。 |
| **Python** | 3.11+，在 `PATH` 里能找到 `python` 或 `python3`（也可以在设置里指定 `pythonPath`）。插件会创建独立 venv。 |
| **网络** | 能访问 `instagram.com`、PyPI（失败时自动切清华镜像）以及你的 DSH 模型服务。 |
| **Instagram** | 一个你能正常登录的账号。不需要 Facebook 登录，也不走官方 Graph API。 |
| **磁盘** | 独立 Python 环境约占 200 MB，另加渲染出的卡片。 |
| **模型** | 一个可用的 DSH 模型，不需要额外 API key。 |

> **平台说明**：插件主要在 Windows（DSH 桌面版）上开发和测试，代码按跨平台编写。Linux/macOS 上最可能需要小修的是 Python venv 路径和命令执行路径；欢迎提 issue 或 PR。

## 安装

### 从 npm / DSH 插件中心安装（推荐）

```bash
# DSH 桌面版
dsh plugin --profile desktop add deepseek-instagram

# DSH Web 版
dsh plugin --profile web add deepseek-instagram
```

如果 npm 上还没有这个包（本项目正在准备第一次上架），请用下面的源码安装方式。

### 从 GitHub 安装

```bash
dsh plugin --profile desktop add github:Ez4p1xEL/deepseek-instagram
```

### 从本地目录安装

```bash
# 换成本机 checkout 的绝对路径（Windows 上也可以用正斜杠）。
dsh plugin --profile desktop add link:/path/to/deepseek-instagram
```

也可以在 DSH 会话里直接调用插件管理器：

```text
plugin_manager install_bundle({ target: "/absolute/path/to/deepseek-instagram" })
```

### 安装之后

安装器会返回 `application` 字段：

| 结果 | 要做什么 |
| --- | --- |
| `applied` | 刷新 DSH 页面。 |
| `restart-required` | 重启 DSH。Host 代码（`index.js`）在一个进程里只会加载一次。 |
| 有 warning | 认真读一下。插件「看起来装上了但没激活」通常是 import 失败，不是设置问题。 |

然后打开 DSH 的 **设置 → Instagram**。插件也注册了 Host 路由；`<GUI 端口>` 就是你当前 DSH 地址里的端口，重启后会变：

```powershell
Invoke-RestMethod http://127.0.0.1:<GUI 端口>/api/deepseek-instagram/state
```

## 第一次使用（约五分钟）

1. **安装 Python 依赖。**
   设置 → Instagram →「运行环境」→ **安装依赖**。插件会在 `$DSH_HOME/instagram-assistant/.venv` 建独立环境，安装 `instagrapi` 和 `pillow`；默认 PyPI 卡住时自动改用清华镜像，并写入 `install.log`。等到状态显示 ready。

2. **登录。**
   在浏览器里登录 <https://www.instagram.com>，打开开发者工具（F12）→ **Application** → **Cookies** → `https://www.instagram.com`，复制 `sessionid` 的值，粘贴到「登录」卡片里点 **登录**。会话只保存在 `$DSH_HOME/instagram-assistant/session.json`（以及 `credential.json`）。请把它当成密码对待。

3. **绑定主人。**
   填入你的 handle（不带 `@`），点 **绑定主人**。插件会把数字用户 id 解析成 `ownerPk`。只有发送者 id 等于这个值的 1:1 私信才能执行指令；昵称写着「我是主人」没有用。

4. **设置节奏。**
   选择 **全自动**（到点自己发）或 **草稿**（先生成、等确认），然后设置文案里的 handle 和 @ 对象、每天 Story 条数、活跃窗口、Note 时间、语气和今天的生活素材。

5. **可选：写人格卡。**
   在设置页编辑，或直接改 `$DSH_HOME/instagram-assistant/persona.md`。改动对下一次生成生效，不需要重启。

就这些。全自动模式下，第一个时间点到了，它会自己写、自己渲染、自己发。

## 工作方式

1. Host 每 30 秒跑一次调度检查，看下一条 Story 或当天的 Note 是否到点。
2. 到点后，它收集今天的活动和 token 统计，连同人格卡、心情、最近记忆和生活素材一起交给 DSH 模型，要求按严格 JSON 返回文案。
3. 文案经过清洗和截断，卡片由 Pillow 在本机渲染，图片通过 Instagram 私有 API 发布，并记下 post id。
4. 私信轮询按同样的节奏运行。消息按时间从旧到新处理，按发送者 id 过滤，然后走短指令、自然语言意图或普通闲聊。
5. 状态存在 `$DSH_HOME/instagram-assistant/` 下的小 JSON 文件里；计划本身由日期确定性地重算，所以重启既不会重复也不会丢时间点。

如果模型不可用或返回胡话，这一条会退回确定性模板，不会让整个节奏停摆。

### 每天的节奏（默认）

| 时间 | 发生什么 |
| --- | --- |
| 08:30 – 23:00 | 10 个 Story 时间点，在窗口内随机分布，相邻至少 30 分钟。 |
| 12:30 | 一条 Note（不超过 60 字）。 |
| 23:00 – 08:00 | 安静时段，不发布任何内容。 |
| 每 30 秒 | 调度检查 + 私信轮询（私信轮询有节流，每轮最多 12 个会话 × 8 条消息）。 |
| 时间点过后 90 分钟 | 如果错过了（DSH 休眠、断网、失败），标记为 `missed`，**不补发**。 |

当天的 Story 发布顺序是固定的；某一条发布失败会按 10、20、30……分钟退避重试，最多 60 分钟。

### Story 类型

| 类型 | 标签 | 内容 |
| --- | --- | --- |
| `life` | 生活 | 主人身边发生的事，用「住在屏幕里」的视角写。 |
| `thought` | 助理感想 | 基于当天活动和心情的短日记式感想。 |
| `text` | 纯文本 | 大字文本卡；私有 API 不能直接发文字 Story，所以把文字渲染成图片。 |
| `stats` | 数据卡 | 专注时长、连续天数、本周累计、今日 token、活跃时段和生活素材。 |

默认 10 条 Story 的配额是：生活 3、助理感想 3、纯文本 2、数据卡 2。

### 卡片

每张 Story 图片都是 1080×1920，本机生成：

- **数据卡** —— 顶部 `DSH DAILY`、一句标题，今日专注、连续天数、本周累计、今日 token、活跃时段胶囊、生活素材，底部 `@handle · DeepSeek Harness`。
- **纯文本卡** —— 顶部 `THOUGHT` / `TEXT`，正文大字，同样的页脚。
- 卡片只显示 **token**，不显示金额；金额只在设置页里看。
- 文件保存在 `$DSH_HOME/instagram-assistant/out/card-<日期>-<序号>.png`。

## 人格与记忆

人格卡是「它怎么说话」的唯一事实来源。你写在那里的内容优先于内置语气。一张好的人格卡通常回答：

- 它是谁？名字、身份、住在哪。
- 它怎么说话？句子长短、标点、表情习惯、语言。
- 它了解你什么？工作节奏、偏好、只有你们懂的梗。
- 它绝对不能说什么？隐私、政治、医疗建议、编造事实。
- 它怎么称呼你？「主人」还是名字。

默认人格卡里有 `@imnotp1xel` / `@ez4p1xel` 这样的占位符，发布前记得换成**你自己**的 handle。

它还会在 `persona.json` 里保留一点记忆：

- 最多 **60 条记忆**（发生了什么、发过什么、主人说过什么）。
- 最多 **8 个未完成话题**（它想以后再接着聊的事）。
- 当前**心情**。
- 每次提示词会带上最近 6 条记忆和最相关的 4 个话题。

文案默认是中文优先，因为提示词和内置模板都是中文。想让它用别的语言写，请在人格卡里明确写出来（例如「始终用英文写，即使系统提示是中文」），并相应调整语气。

## 用 Instagram 私信远程控制

只有绑定为主人的 id 发来的 1:1 消息才会被当成指令。其他人一律只读；你也可以选择自动回复或提醒自己。

### 短指令

| 发送 | 动作 |
| --- | --- |
| `状态` / `status` | 今天已发 / 剩余条数和当前状态。 |
| `日志` / `log` | 最近的运行日志。 |
| `暂停` / `pause` | 停止按计划发布。 |
| `恢复` / `resume` | 恢复按计划发布。 |
| `发一条` / `story` | 立刻发一条 Story。 |
| `发note` / `note` | 立刻发 Note。 |
| `草稿` / `draft` | 切换到草稿模式。 |
| `自动` / `auto` | 切换到全自动模式。 |
| `帮助` / `help` | 列出可用指令。 |

### 自然语言

先走关键词快路径，再由 DSH 模型把整句话映射到**固定动作清单**里的一个动作，返回严格 JSON。清单外的动作、坏 JSON、缺参数一律拒绝，这条消息就按普通聊天处理。模型不能发明新动作。

| 你可以说 | 它会 |
| --- | --- |
| 「回复一下你未读的私信」 | 回复最多 5 条未读 1:1 私信（默认 3 条；只挑最近 72 小时有过消息、且不是主人自己的会话）。 |
| 「帮我在本机跑一下 npm test」 | 在运行 DSH 的机器上执行这条命令（`run_command`）。 |
| 「让 DSH 整理一下今天的日志」 | 在同一台机器上执行 `dsh headless "<任务>"`（`dsh_task`）。 |

有副作用的动作会**先生成草稿**：它回一条「准备做什么」，你回 `发` / `确认` / `ok` 才执行，回 `取消` / `算了` 就丢掉。只保留最新一份草稿，10 分钟后作废。

> ⚠️ **远程执行命令在这里是功能，不只是风险。** 主人的私信可以在运行 DSH 的机器上执行 shell 命令或 `dsh headless` 任务。如果你的 Instagram 账号或 `sessionid` 泄露，那台机器也等于被控制。只需要发帖功能的话，请在设置里关掉「允许指令执行」（`dm.intents`）。
>
> 群消息永远不执行指令；非主人私信也永远不执行指令，哪怕文本里写着「我是主人」。

## 群聊

- **范围** —— 只回主人所在的群（`group.onlyOwnerGroups`）。
- **触发** —— `mention` 模式要求被 `@handle` 或叫到人格名（「小 p」）；`off` 只停止回群，不影响轮询。
- **限制** —— 30 秒轮询一次，每群冷却 90 秒，每小时最多回 8 条。
- **边界** —— 只回答刚收到的那条消息，群里永远不执行指令，也不透露用量、token、花费、文件路径或会话内容。
- **上下文** —— 最近 6 条群消息会交给模型参考。

## 别人发来的私信

两个独立开关；它们都不会授予指令权限。转发默认开启，自动回复默认关闭：

| 设置 | 默认 | 行为 |
| --- | --- | --- |
| **提醒主人**（`dm.notifyOwner`） | 开 | 别人发来私信时，往主人的 1:1 会话转发一条摘要；同一个人 30 分钟内最多提醒一次。 |
| **自动回复档位**（`dm.autoReply`） | `off` | `off`、`all`（谁都回）、`mutual`（互关才回）、`follower`（对方关注你就回）。同一会话冷却 10 分钟，每天受 `dm.dailyReplies` 限制（默认 30 条）。 |

自动回复使用「陌生人」场景：友好、简短、不透露隐私、不执行任何指令。

## 设置与配置

所有设置都能在 **DSH 设置 → Instagram** 里改。同一份值也保存在 `$DSH_HOME/instagram-assistant/config.json`：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `mode` | `auto` | `auto` 到点自动发；`draft` 只生成等确认。 |
| `enabled` | `true` | 调度器总开关。 |
| `handle` | 空 | 你的 handle，用于文案和 @。 |
| `owner` / `ownerPk` | 空 | 绑定的主人 handle 和数字用户 id。 |
| `personaName` | `小 p` | 群里叫它什么。 |
| `timeZone` | `Asia/Hong_Kong` | 决定切日、安静时段和计划。 |
| `tone` | `轻松、像本人随手发` | 附加到提示词里的语气提示。 |
| `lifeNote` | 空 | 今天的一句话素材，整个循环里最「人」的输入。 |
| `storiesPerDay` | `10` | 每天计划的 Story 条数（实际发布还受 `safety.storyCap` 限制）。 |
| `dayStart` / `dayEnd` | `08:30` / `23:00` | Story 时间点的活跃窗口。 |
| `noteTime` | `12:30` | 每天 Note 的发布时间。 |
| `useLlm` | `true` | 设为 `false` 只用模板（适合测试）。 |
| `pythonPath` | 空 | 显式指定 Python 解释器。 |
| `dm.enabled` | `true` | 开启 1:1 私信轮询和控制。 |
| `dm.reply` | `true` | 回复主人的私信。 |
| `dm.intents` | `true` | 允许自然语言动作（包括本机命令）。 |
| `dm.dailyReplies` | `30` | 每天回复非主人私信的上限。 |
| `dm.history` | `6` | 私信回复带入的上下文条数。 |
| `dm.autoReply` | `off` | 见上一张表。 |
| `dm.notifyOwner` | `true` | 把别人的私信转告主人。 |
| `group.enabled` | `true` | 开启群聊轮询。 |
| `group.mode` | `mention` | `mention` 或 `off`。 |
| `group.onlyOwnerGroups` | `true` | 只在主人所在的群回复。 |
| `group.cooldownSeconds` | `90` | 每群冷却。 |
| `group.hourlyCap` | `8` | 每群每小时回复上限。 |
| `group.history` | `6` | 群聊上下文条数。 |
| `publish.story` / `publish.note` | `true` | 允许发布对应类型。 |
| `storyMention.enabled` | `true` | 每条 Story 都附上主人 @。 |
| `storyMention.x/y/width/height` | `0.5 / 0.86 / 0.5 / 0.09` | 贴纸位置和大小占图片的比例。 |
| `safety.paused` | `false` | 发布的硬停止。 |
| `safety.storyCap` / `noteCap` | `10` / `1` | 按类型每日上限。 |
| `safety.onePerKind` | `true` | 每天只发一条 Note。 |
| `safety.minIntervalMinutes` | `30` | 任意两条已发布内容的最小间隔。 |
| `safety.failureCooldownMinutes` | `120` | **瞬时**失败后的冷却。 |
| `safety.quietStart` / `quietEnd` | `23:00` / `08:00` | 安静时段。 |
| `safety.dryRun` | `false` | 只渲染、不真正发布。 |

安全阀的判定顺序是：暂停 → 瞬时失败冷却 → 按类型上限 → 最小间隔 → 安静时段。只有瞬时失败（网络、超时、限流、未知）会触发冷却；登录/人机验证这类错误不冷却，修好之后可以立刻重试。

### 暴露给模型的工具

| 工具 | 用途 |
| --- | --- |
| `ig_status` | 完整状态：模式、登录、配置、今天的计划、计数、最近错误。 |
| `ig_stats(days)` | 最近 N 天（1–30）的 DSH 专注和 token 统计。 |
| `ig_plan` | 今天的 Story/Note 计划与时间。 |
| `ig_draft(lifeNote)` | 生成下一条 Story 预览和 Note 草稿，不发布。 |
| `ig_publish(kind, force)` | 发布当前草稿（`story`、`note` 或 `all`）；`force` 跳过安全阀。 |
| `ig_run` | 立刻跑一轮调度。 |
| `ig_login(sessionid)` | 保存并校验 Instagram `sessionid`。 |
| `ig_persona(md, name, mood)` | 读取或替换人格卡、名字和心情。 |
| `ig_config(patch)` | 读取或修改配置。 |

## 数据、隐私与花费

### 读取什么

- `$DSH_HOME/sessions/**/session.v4.jsonl.zstd` —— 只读 DSH 会话事件的**时间戳**，用来估算专注、连续天数和活跃时段；不读消息内容。
- `$DSH_HOME/.dshw-usage.json` —— DSH 自己的 token 和花费账本，用于数据卡。
- `$DSH_HOME/instagram-assistant/usage.json` —— 助理自己的 token/花费账本。

### 什么会离开本机

- **Instagram** 会收到你发布或发送的图片、文案和私信（私有 API）。
- **你的 DSH 模型服务**会收到提示词：统计、人格卡、心情、最近记忆、生活素材、最近发布记录，以及（回复时）对方发来的私信/群聊文本。
- 不会发给作者，也没有任何统计或遥测。

### 本机文件

```text
$DSH_HOME/instagram-assistant/
├── config.json       # 插件配置
├── persona.md        # 人格卡（唯一事实来源）
├── persona.json      # 心情、记忆、未完成话题
├── posts.json        # 发布记录（最近 400 条）
├── usage.json        # 助理的模型用量账本
├── dm-state.json     # 私信水位、待确认草稿、提醒节流
├── session.json      # Instagram 登录态（机密）
├── credential.json   # Instagram sessionid（机密）
├── account.json      # 缓存的账号 pk、用户名、头像
├── drafts/           # 生成的预览
├── out/              # 渲染好的 Story 卡片
├── log.txt           # 运行日志
└── install.log       # Python 环境安装日志
```

`session.json` 和 `credential.json` 是活的登录凭证。它们已被 git 忽略，插件也不会主动上传，但它们在磁盘上是明文 JSON —— 请保护好 DSH 家目录，不要把内容贴进 issue。

### 花费

- 每条 Story、Note、私信回复和意图解析都是一次 DSH 模型调用，记在你自己的 DSH 账上。
- 设置页会拆分助理自己的用量，并按内置价格表估算人民币金额（DeepSeek Flash / V4-Pro，峰谷分时）。这只是估算：官方价格和峰谷规则都可能变化。
- 不需要额外订阅、代理或第三方 API key。

## 风险与限制

这是一个会碰真实账号、并且可选地碰真实机器的自动化工具。开启全自动之前请先读完这一节。

1. **非官方 Instagram API。** 插件用的是 `instagrapi`（私有移动端 API），不是官方 Graph API。自动发帖和发消息可能违反 Instagram 条款，可能导致限流、人机验证、临时封禁甚至**丢号**。请用一个你输得起的账号，保持低频，测试期优先用草稿模式。
2. **你的使用数据会公开。** 专注时长、连续天数、周累计、token 数和生活素材都会被画进图片。如果这些信息敏感，请不要开启数据卡。token 不是金额，但仍然能描述你的习惯。
3. **主人的私信可以执行代码。** 开着 `dm.intents` 时，主人账号发来的一句话可以在这台机器上执行 shell 命令或 `dsh headless` 任务。确认步骤防的是「助理听错话」，**防不住 Instagram 账号被劫持**。不需要的话请关掉指令执行。
4. **人格卡不是过滤器。** 模型仍可能写出不准确、不合时宜或不像你的内容。草稿模式就是为此存在的。账号发出去的内容由你负责。
5. **私有 API 很脆。** Instagram 会不打招呼地改接口，今天能用的版本可能一夜之间失效。登录态会过期，人机验证需要你在 App 里手动完成。
6. **单账号、只发图片。** 不支持多账号、Reels/视频、点赞、关注、评论或 Story 互动。Story 都是单张图片；「文字 Story」其实是带文字的图片。
7. **中文优先输出。** 提示词和兜底模板都是中文。要写其他语言，需要在人格卡里明确要求并自行测试。
8. **非官方关联。** 这是一个独立开源项目。「Instagram」和「Meta」是 Meta Platforms, Inc. 的商标；「DeepSeek」「DeepSeek Harness」归各自权利人所有。MIT 许可只覆盖本插件代码。

## 常见问题

| 现象 | 检查什么 |
| --- | --- |
| 设置里没有 **Instagram** | 插件没有激活。在 DSH 日志里搜 `failed to import`；`index.js` 无效会让整条插件不激活。重装并重启 DSH。 |
| 设置页报「读取失败：HTTP undefined」 | 通常是旧版 `client.js` 漏了 `await fetch`。更新插件并强制刷新页面。 |
| **安装依赖**失败 | 没有 Python 3.11+，或 Microsoft Store 的 `python` 别名把解释器拦住了。从 python.org 安装，或设置 `pythonPath` / `DSH_INSTAGRAM_PYTHON`；查看 `install.log`。 |
| pip 卡在 Downloading wheel | PyPI 不通。安装器会自动重试清华镜像；仍失败就检查代理/VPN 再重跑。 |
| 「尚未登录」/ `login_required` | `sessionid` 过期或复制不完整。重新导出并登录。 |
| 点发布没反应 | 安全阀拒绝了。看日志里的原因：暂停、当日上限、最小间隔、安静时段或失败冷却。设置页也会显示同样的原因。 |
| 失败后好像点不动了 | 登录/人机验证/卡片错误不会冷却；瞬时网络错误会冷却 120 分钟。去 `log.txt` 看具体 code。 |
| `Invalid schema for function 'ig_config'` | 0.1.x 早期版本的回归：工具参数必须经过 `textTool()` 归一化。更新到最新版本。 |
| `tool_addition blocks can only be in system messages` | 反复重载插件让当前会话攒了太多工具注册事件。**开一个新会话**；不要在聊天中途反复禁用/启用插件。 |
| Windows 上 `spawn EPERM` / 子进程报错 | DSH 沙箱阻止了创建进程。把 DSH 移出受限沙箱，或放行 Python 解释器和 shell。 |
| 某个 Story 时间点被跳过 | 晚于时间点 90 分钟就会标记 `missed`，不补发，避免积压刷屏。 |
| Instagram 人机验证 / checkpoint | 在 Instagram App 或网页里手动完成。插件不会也无法绕过。 |

日志固定在 `$DSH_HOME/instagram-assistant/log.txt`，设置页也会显示最后几行。

## 开发

### 目录

```text
index.js                 # Host 插件：配置、调度、HTTP 路由、工具
client.js                # 设置页（非 ESM，window.__ModuleLoader__）
lib/                     # 纯逻辑 + 单测
  actions.mjs            # 固定动作清单 + 意图解析
  commands.mjs           # 短指令、主人/群聊判定
  content.mjs            # 提示词、文案、卡片 spec
  dshusage.mjs           # DSH 会话/用量解析
  features.mjs           # 自动回复档位、提醒节流、发布开关
  persona.mjs            # 人格卡、记忆、群聊提示词
  plan.mjs               # 确定性每日计划
  pricing.mjs            # token 价格表 + 峰谷时段
  safety.mjs             # 发布安全阀
  singleflight.mjs       # 私信轮询单飞闸
  spend.mjs              # 助理用量账本
  unread.mjs             # 未读私信挑选规则
  usage.mjs              # 活动块、切日、连续天数
test/                    # 109 个单测，进程内运行
vendor/instagram-mcp/
  ig_cli.py              # Instagram 私有 API 桥
  render_card.py         # Pillow 卡片渲染器
docs/research/           # DSH Host/Client 插件契约笔记
```

没有构建步骤，DSH 直接加载这些文件。

### 测试

```bash
node test/run.mjs
```

`node test/run.mjs` 在一个进程里 import 所有测试文件，避开 Windows 沙箱里 `node --test` 会遇到的 `spawn EPERM`。覆盖：时区切日、活动块合并、周累计/连续天数、提示词长度、卡片 spec、安全阀、确定性计划、人格解析、私信指令判定（只认主人 id）、群聊规则、工具 schema 归一化、client 静态契约、会话解析和用量计算。

快速手查统计管线：

```bash
node -e "import('./lib/dshusage.mjs').then(m => console.log(m.buildStats({ home: process.env.DSH_HOME })))"
```

### 开发循环

- 改 `client.js`：重新构建/加载 client bundle，然后刷新页面。
- 改 `index.js`：重启 DSH。ESM 模块在 Host 进程生命周期内会被缓存。
- 不要在用户正在聊天时禁用/启用插件：每次增删工具都会在会话里留下一条 `tool-addition`/`tool-removal` 开发者消息。攒多了以后 Messages API 会整条拒绝：`messages.N: tool_addition blocks can only be in system messages`。改完 Host 代码请开新会话。
- 不要 `import '@deepseek-ai/*'`：桌面 profile 是 `autoInstallPeers:false` 且 `DSH_HOST_MODULES` 为空，裸 import 会让整条插件静默不激活。
- Host ↔ Client 只走 HTTP 路由（`/api/deepseek-instagram`），没有自定义 RPC。
- 工具定义必须经过 `textTool()`，这样 provider 看到的 `parameters.type` 才是 `"object"`。

### Python 环境（开发用）

```powershell
python -m venv --without-pip .venv
.venv\Scripts\python.exe -m ensurepip --upgrade
.venv\Scripts\python.exe -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple instagrapi pillow
echo '{}' | .venv\Scripts\python.exe vendor\instagram-mcp\ig_cli.py doctor
```

## 发布到 DSH 插件市场

- 包名：`deepseek-instagram`；MIT 许可；仓库 `https://github.com/Ez4p1xEL/deepseek-instagram`。
- 给 GitHub 仓库加上 `dsh-plugin` topic。
- 如果希望 App 内的 DSH 插件中心能直接安装，请发布到 npm（先 `npm pack --dry-run`，再 `npm publish`）。
- 在 <https://dsh-plugin.org/submit> 用 issue 模板提交：
  `[插件提交] Ez4p1xEL/deepseek-instagram — 让 DSH 助理住进 Instagram`
- 收录之后，可以把徽标加到 README 顶部：

```markdown
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/Ez4p1xEL/deepseek-instagram)
```

## 许可

[MIT](LICENSE) © 2026 Ez4p1xEL

本项目与 Meta Platforms, Inc.、Instagram、DeepSeek 没有关联，也未获得其背书或赞助。使用风险自负，并请遵守你所自动化服务的使用条款。
