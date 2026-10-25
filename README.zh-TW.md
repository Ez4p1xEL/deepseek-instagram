<div align="center">

# deepseek-instagram

**住進 Instagram 的 DSH 助理。**
它帶著人格、記憶和真實的 DSH 使用資料，接手帳號的 Story / Note 節奏；而且只有*主人自己的帳號*能透過 Instagram 私訊指揮它。

[English](README.md) · [簡體中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A5%200.1.7--rc.1-6c5ce7)](https://deepseek.com/harness)

<img src="https://raw.githubusercontent.com/Ez4p1xEL/deepseek-instagram/main/docs/images/story-card.png" width="300" alt="DSH 資料 Story 卡片" />
<img src="https://raw.githubusercontent.com/Ez4p1xEL/deepseek-instagram/main/docs/images/story-text.png" width="300" alt="純文字 Story 卡片" />

<sub>兩張卡片都是 Pillow 在本機渲染的 1080×1920 圖片，圖中資料為示範資料。</sub>

</div>

---

**deepseek-instagram** 把一個 DSH 助理變成住在 Instagram 上的人格。它不發通用心靈雞湯：它會觀察你在 DSH 裡的會話與 token 帳本，把它們整理成一張小卡片，用你定義的人格卡口吻寫文案，並記住自己已經說過什麼。它預設每天規劃 10 則 Story、1 則 Note，夜裡保持安靜。

帳號本身就是操作介面。暫停、立刻發一則 Story、查今天的狀態，甚至讓同一台機器跑一個 DSH 任務 —— 都只要主人帳號傳一則 1:1 私訊。

- **適合**：想要一個低維護、能反映自己真實電腦使用狀態、有點個性的 Instagram 帳號。
- **不適合**：需要 Meta 官方 API、多帳號管理、Reels/影片，或自動按讚追蹤。這些它都不做。

## 功能亮點

- **是人格，不是模板** —— 一份 Markdown 人格卡、一個名字、一種心情和最多 60 則記憶。發文、回私訊、群組聊天裡的語氣保持一致。
- **重啟也不會打亂計畫** —— Story 時間點由日期做隨機種子，在活躍時段內均勻分布，相鄰至少 30 分鐘。重新載入 DSH 不會把今天重新洗牌。
- **四種 Story** —— 生活、助理感想、純文字、資料卡。每天的配額保證你不會連收十張資料卡。
- **本機渲染 1080×1920 卡片** —— 今日專注、連續天數、本週累計、今日 token、活躍時段和生活素材，全部由 Pillow 繪製。不需要無頭瀏覽器，也不經過雲端渲染。
- **預設每天一則 Note** —— 不超過 60 字，同樣由人格和當天狀態生成。
- **Story @ 主人** —— 真正的 @ 貼紙 + 文案裡的 `@handle`，位置可調。
- **只有主人能遠端控制** —— 只認綁定成主人的數字使用者 id，暱稱和自稱一律不算。支援短指令和自然語言意圖；有副作用的動作必須再回一句確認。
- **群組聊天存在感** —— 只在主人所在的群組回，@ 或叫人格名才觸發，每個群組有冷卻和每小時上限；群組訊息永遠不執行指令。
- **完整的安全閥** —— 暫停開關、依類型每日上限、最小間隔、安靜時段、失敗冷卻，以及 90 分鐘補發窗口。
- **DSH 內的設定頁** —— 狀態、今天的計畫、人格卡編輯、登入、用量、日誌和發布紀錄都在裡面；改 JSON 只是選項。
- **給模型 9 個工具** —— 同樣的控制能力在任何 DSH 會話裡都能用，你可以直接在聊天裡讓它寫稿、發布或查狀態。

## 環境需求

| 項目 | 要求 |
| --- | --- |
| **DSH** | ≥ `0.1.7-rc.1`。桌面版 profile 是主要目標，Web 版也能用。 |
| **Node.js** | ≥ 22。DSH 執行環境自帶相容的 Node.js。 |
| **Python** | 3.11+，在 `PATH` 裡能找到 `python` 或 `python3`（也可以在設定裡指定 `pythonPath`）。外掛會建立獨立虛擬環境。 |
| **網路** | 能存取 `instagram.com`、PyPI（失敗時自動切換清華鏡像）以及你的 DSH 模型服務。 |
| **Instagram** | 一個你能正常登入的帳號。不需要 Facebook 登入，也不走官方 Graph API。 |
| **磁碟** | 獨立 Python 環境約佔 200 MB，另加渲染出的卡片。 |
| **模型** | 一個可用的 DSH 模型，不需要額外 API key。 |

> **平台說明**：外掛主要在 Windows（DSH 桌面版）上開發和測試，程式碼按跨平台撰寫。Linux/macOS 上最可能需要小修的是 Python 虛擬環境路徑和指令執行路徑；歡迎提 issue 或 PR。

## 安裝

### 從 npm / DSH 外掛中心安裝（推薦）

```bash
# DSH 桌面版
dsh plugin --profile desktop add deepseek-instagram

# DSH Web 版
dsh plugin --profile web add deepseek-instagram
```

如果 npm 上還沒有這個套件（本專案正在準備第一次上架），請用下面的原始碼安裝方式。

### 從 GitHub 安裝

```bash
dsh plugin --profile desktop add github:Ez4p1xEL/deepseek-instagram
```

### 從本機目錄安裝

```bash
# 換成本機 checkout 的絕對路徑（Windows 上也可以用正斜線）。
dsh plugin --profile desktop add link:/path/to/deepseek-instagram
```

也可以在 DSH 會話裡直接呼叫外掛管理器：

```text
plugin_manager install_bundle({ target: "/absolute/path/to/deepseek-instagram" })
```

### 安裝之後

安裝器會回傳 `application` 欄位：

| 結果 | 要做什麼 |
| --- | --- |
| `applied` | 重新整理 DSH 頁面。 |
| `restart-required` | 重新啟動 DSH。Host 程式碼（`index.js`）在一個行程裡只會載入一次。 |
| 有 warning | 認真讀一下。外掛「看起來裝上了但沒啟用」通常是 import 失敗，不是設定問題。 |

然後打開 DSH 的 **設定 → Instagram**。外掛也註冊了 Host 路由；`<GUI 連接埠>` 就是你目前 DSH 網址裡的連接埠，重啟後會變：

```powershell
Invoke-RestMethod http://127.0.0.1:<GUI 連接埠>/api/deepseek-instagram/state
```

## 第一次使用（約五分鐘）

1. **安裝 Python 相依套件。**
   設定 → Instagram →「執行環境」→ **安裝相依套件**。外掛會在 `$DSH_HOME/instagram-assistant/.venv` 建立獨立環境，安裝 `instagrapi` 和 `pillow`；預設 PyPI 卡住時自動改用清華鏡像，並寫入 `install.log`。等到狀態顯示 ready。

2. **登入。**
   在瀏覽器登入 <https://www.instagram.com>，打開開發者工具（F12）→ **Application** → **Cookies** → `https://www.instagram.com`，複製 `sessionid` 的值，貼到「登入」卡片裡按 **登入**。會話只保存在 `$DSH_HOME/instagram-assistant/session.json`（以及 `credential.json`）。請把它當成密碼對待。

3. **綁定主人。**
   填入你的 handle（不含 `@`），按 **綁定主人**。外掛會把數字使用者 id 解析成 `ownerPk`。只有傳送者 id 等於這個值的 1:1 私訊才能執行指令；暱稱寫著「我是主人」沒有用。

4. **設定節奏。**
   選擇 **全自動**（到點自己發）或 **草稿**（先產生、等確認），然後設定文案裡的 handle 和 @ 對象、每天 Story 則數、活躍時段、Note 時間、語氣和今天的生活素材。

5. **選用：寫人格卡。**
   在設定頁編輯，或直接改 `$DSH_HOME/instagram-assistant/persona.md`。改動對下一次生成生效，不需要重啟。

就這樣。全自動模式下，第一個時間點到了，它會自己寫、自己渲染、自己發。

## 運作方式

1. Host 每 30 秒跑一次排程檢查，看下一則 Story 或當天的 Note 是否到點。
2. 到點後，它收集今天的活動和 token 統計，連同人格卡、心情、最近記憶和生活素材一起交給 DSH 模型，要求按嚴格 JSON 回傳文案。
3. 文案經過清洗和截斷，卡片由 Pillow 在本機渲染，圖片透過 Instagram 私有 API 發布，並記下 post id。
4. 私訊輪詢按同樣的節奏執行。訊息按時間從舊到新處理，依傳送者 id 過濾，然後走短指令、自然語言意圖或一般閒聊。
5. 狀態存在 `$DSH_HOME/instagram-assistant/` 下的小 JSON 檔案裡；計畫本身由日期確定性地重算，所以重啟既不會重複也不會遺失時間點。

如果模型不可用或回傳胡話，這一則會退回確定性模板，不會讓整個節奏停擺。

### 每天的節奏（預設）

| 時間 | 發生什麼 |
| --- | --- |
| 08:30 – 23:00 | 10 個 Story 時間點，在時段內隨機分布，相鄰至少 30 分鐘。 |
| 12:30 | 一則 Note（不超過 60 字）。 |
| 23:00 – 08:00 | 安靜時段，不發布任何內容。 |
| 每 30 秒 | 排程檢查 + 私訊輪詢（私訊輪詢有節流，每輪最多 12 個會話 × 8 則訊息）。 |
| 時間點過後 90 分鐘 | 如果錯過了（DSH 休眠、斷網、失敗），標記為 `missed`，**不補發**。 |

當天的 Story 發布順序是固定的；某一則發布失敗會按 10、20、30……分鐘退避重試，最多 60 分鐘。

### Story 類型

| 類型 | 標籤 | 內容 |
| --- | --- | --- |
| `life` | 生活 | 主人身邊發生的事，用「住在螢幕裡」的視角寫。 |
| `thought` | 助理感想 | 基於當天活動和心情的短日記式感想。 |
| `text` | 純文字 | 大字文字卡；私有 API 不能直接發文字 Story，所以把文字渲染成圖片。 |
| `stats` | 資料卡 | 專注時間、連續天數、本週累計、今日 token、活躍時段和生活素材。 |

預設 10 則 Story 的配額是：生活 3、助理感想 3、純文字 2、資料卡 2。

### 卡片

每張 Story 圖片都是 1080×1920，本機生成：

- **資料卡** —— 頂部 `DSH DAILY`、一句標題，今日專注、連續天數、本週累計、今日 token、活躍時段膠囊、生活素材，底部 `@handle · DeepSeek Harness`。
- **純文字卡** —— 頂部 `THOUGHT` / `TEXT`，正文大字，同樣的頁尾。
- 卡片只顯示 **token**，不顯示金額；金額只在設定頁裡看。
- 檔案保存在 `$DSH_HOME/instagram-assistant/out/card-<日期>-<序號>.png`。

## 人格與記憶

人格卡是「它怎麼說話」的唯一事實來源。你寫在那裡的內容優先於內建語氣。一張好的人格卡通常回答：

- 它是誰？名字、身分、住在哪。
- 它怎麼說話？句子長短、標點、表情習慣、語言。
- 它了解你什麼？工作節奏、偏好、只有你們懂的梗。
- 它絕對不能說什麼？隱私、政治、醫療建議、編造事實。
- 它怎麼稱呼你？「主人」還是名字。

預設人格卡裡有 `@imnotp1xel` / `@ez4p1xel` 這樣的佔位符，發布前記得換成**你自己**的 handle。

它還會在 `persona.json` 裡保留一點記憶：

- 最多 **60 則記憶**（發生了什麼、發過什麼、主人說過什麼）。
- 最多 **8 個未完成話題**（它想以後再接著聊的事）。
- 目前**心情**。
- 每次提示詞會帶上最近 6 則記憶和最相關的 4 個話題。

文案預設是中文優先，因為提示詞和內建模板都是中文。想讓它用別的語言寫，請在人格卡裡明確寫出來（例如「始終用英文寫，即使系統提示是中文」），並相應調整語氣。

## 用 Instagram 私訊遠端控制

只有綁定為主人的 id 傳來的 1:1 訊息才會被當成指令。其他人一律唯讀；你也可以選擇自動回覆或提醒自己。

### 短指令

| 傳送 | 動作 |
| --- | --- |
| `狀態` / `status` | 今天已發 / 剩餘則數和目前狀態。 |
| `日誌` / `log` | 最近的執行日誌。 |
| `暫停` / `pause` | 停止按計畫發布。 |
| `恢復` / `resume` | 恢復按計畫發布。 |
| `發一則` / `story` | 立刻發一則 Story。 |
| `發note` / `note` | 立刻發 Note。 |
| `草稿` / `draft` | 切換到草稿模式。 |
| `自動` / `auto` | 切換到全自動模式。 |
| `說明` / `help` | 列出可用指令。 |

### 自然語言

先走關鍵字快路徑，再由 DSH 模型把整句話對應到**固定動作清單**裡的一個動作，回傳嚴格 JSON。清單外的動作、壞 JSON、缺參數一律拒絕，這則訊息就按一般聊天處理。模型不能發明新動作。

| 你可以說 | 它會 |
| --- | --- |
| 「回覆一下你未讀的私訊」 | 回覆最多 5 則未讀 1:1 私訊（預設 3 則；只挑最近 72 小時有過訊息、且不是主人自己的會話）。 |
| 「幫我在本機跑一下 npm test」 | 在執行 DSH 的機器上執行這條指令（`run_command`）。 |
| 「讓 DSH 整理一下今天的日誌」 | 在同一台機器上執行 `dsh headless "<任務>"`（`dsh_task`）。 |

有副作用的動作會**先產生草稿**：它回一則「準備做什麼」，你回 `發` / `確認` / `ok` 才執行，回 `取消` / `算了` 就丟掉。只保留最新一份草稿，10 分鐘後作廢。

> ⚠️ **遠端執行指令在這裡是功能，不只是風險。** 主人的私訊可以在執行 DSH 的機器上執行 shell 指令或 `dsh headless` 任務。如果你的 Instagram 帳號或 `sessionid` 外洩，那台機器也等於被控制。只需要發文功能的話，請在設定裡關掉「允許指令執行」（`dm.intents`）。
>
> 群組訊息永遠不執行指令；非主人私訊也永遠不執行指令，即使文字裡寫著「我是主人」。

## 群組聊天

- **範圍** —— 只回主人所在的群組（`group.onlyOwnerGroups`）。
- **觸發** —— `mention` 模式要求被 `@handle` 或叫到人格名（「小 p」）；`off` 只停止回群組，不影響輪詢。
- **限制** —— 30 秒輪詢一次，每個群組冷卻 90 秒，每小時最多回 8 則。
- **邊界** —— 只回答剛收到的那則訊息，群組裡永遠不執行指令，也不透露用量、token、花費、檔案路徑或會話內容。
- **上下文** —— 最近 6 則群組訊息會交給模型參考。

## 別人傳來的私訊

兩個獨立開關；它們都不會授予指令權限。轉發預設開啟，自動回覆預設關閉：

| 設定 | 預設 | 行為 |
| --- | --- | --- |
| **提醒主人**（`dm.notifyOwner`） | 開 | 別人傳私訊時，往主人的 1:1 會話轉發一則摘要；同一個人 30 分鐘內最多提醒一次。 |
| **自動回覆等級**（`dm.autoReply`） | `off` | `off`、`all`（誰都回）、`mutual`（互相追蹤才回）、`follower`（對方追蹤你就回）。同一會話冷卻 10 分鐘，每天受 `dm.dailyReplies` 限制（預設 30 則）。 |

自動回覆使用「陌生人」場景：友善、簡短、不透露隱私、不執行任何指令。

## 設定與設定檔

所有設定都能在 **DSH 設定 → Instagram** 裡改。同一份值也保存在 `$DSH_HOME/instagram-assistant/config.json`：

| 鍵 | 預設 | 含義 |
| --- | --- | --- |
| `mode` | `auto` | `auto` 到點自動發；`draft` 只產生等確認。 |
| `enabled` | `true` | 排程器總開關。 |
| `handle` | 空 | 你的 handle，用於文案和 @。 |
| `owner` / `ownerPk` | 空 | 綁定的主人 handle 和數字使用者 id。 |
| `personaName` | `小 p` | 群組裡叫它什麼。 |
| `timeZone` | `Asia/Hong_Kong` | 決定換日、安靜時段和計畫。 |
| `tone` | `輕鬆、像本人隨手發` | 附加到提示詞裡的語氣提示。 |
| `lifeNote` | 空 | 今天的一句話素材，整個循環裡最「人」的輸入。 |
| `storiesPerDay` | `10` | 每天規劃的 Story 則數（實際發布還受 `safety.storyCap` 限制）。 |
| `dayStart` / `dayEnd` | `08:30` / `23:00` | Story 時間點的活躍時段。 |
| `noteTime` | `12:30` | 每天 Note 的發布時間。 |
| `useLlm` | `true` | 設為 `false` 只用模板（適合測試）。 |
| `pythonPath` | 空 | 明確指定 Python 解譯器。 |
| `dm.enabled` | `true` | 開啟 1:1 私訊輪詢和控制。 |
| `dm.reply` | `true` | 回覆主人的私訊。 |
| `dm.intents` | `true` | 允許自然語言動作（包括本機指令）。 |
| `dm.dailyReplies` | `30` | 每天回覆非主人私訊的上限。 |
| `dm.history` | `6` | 私訊回覆帶入的上下文則數。 |
| `dm.autoReply` | `off` | 見上一張表。 |
| `dm.notifyOwner` | `true` | 把別人的私訊轉告主人。 |
| `group.enabled` | `true` | 開啟群組輪詢。 |
| `group.mode` | `mention` | `mention` 或 `off`。 |
| `group.onlyOwnerGroups` | `true` | 只在主人所在的群組回覆。 |
| `group.cooldownSeconds` | `90` | 每個群組冷卻。 |
| `group.hourlyCap` | `8` | 每個群組每小時回覆上限。 |
| `group.history` | `6` | 群組上下文則數。 |
| `publish.story` / `publish.note` | `true` | 允許發布對應類型。 |
| `storyMention.enabled` | `true` | 每則 Story 都附上主人 @。 |
| `storyMention.x/y/width/height` | `0.5 / 0.86 / 0.5 / 0.09` | 貼紙位置和大小佔圖片的比例。 |
| `safety.paused` | `false` | 發布的強制停止。 |
| `safety.storyCap` / `noteCap` | `10` / `1` | 依類型每日上限。 |
| `safety.onePerKind` | `true` | 每天只發一則 Note。 |
| `safety.minIntervalMinutes` | `30` | 任意兩則已發布內容的最小間隔。 |
| `safety.failureCooldownMinutes` | `120` | **瞬時**失敗後的冷卻。 |
| `safety.quietStart` / `quietEnd` | `23:00` / `08:00` | 安靜時段。 |
| `safety.dryRun` | `false` | 只渲染、不真正發布。 |

安全閥的判定順序是：暫停 → 瞬時失敗冷卻 → 依類型上限 → 最小間隔 → 安靜時段。只有瞬時失敗（網路、逾時、流量限制、未知）會觸發冷卻；登入/人機驗證這類錯誤不冷卻，修好之後可以立刻重試。

### 提供給模型的工具

| 工具 | 用途 |
| --- | --- |
| `ig_status` | 完整狀態：模式、登入、設定、今天的計畫、計數、最近錯誤。 |
| `ig_stats(days)` | 最近 N 天（1–30）的 DSH 專注和 token 統計。 |
| `ig_plan` | 今天的 Story/Note 計畫與時間。 |
| `ig_draft(lifeNote)` | 產生下一則 Story 預覽和 Note 草稿，不發布。 |
| `ig_publish(kind, force)` | 發布目前草稿（`story`、`note` 或 `all`）；`force` 跳過安全閥。 |
| `ig_run` | 立刻跑一輪排程。 |
| `ig_login(sessionid)` | 儲存並驗證 Instagram `sessionid`。 |
| `ig_persona(md, name, mood)` | 讀取或取代人格卡、名字和心情。 |
| `ig_config(patch)` | 讀取或修改設定。 |

## 資料、隱私與花費

### 讀取什麼

- `$DSH_HOME/sessions/**/session.v4.jsonl.zstd` —— 只讀 DSH 會話事件的**時間戳記**，用來估算專注、連續天數和活躍時段；不讀訊息內容。
- `$DSH_HOME/.dshw-usage.json` —— DSH 自己的 token 和花費帳本，用於資料卡。
- `$DSH_HOME/instagram-assistant/usage.json` —— 助理自己的 token/花費帳本。

### 什麼會離開本機

- **Instagram** 會收到你發布或傳送的圖片、文案和私訊（私有 API）。
- **你的 DSH 模型服務**會收到提示詞：統計、人格卡、心情、最近記憶、生活素材、最近發布紀錄，以及（回覆時）對方傳來的私訊/群組文字。
- 不會傳給作者，也沒有任何統計或遙測。

### 本機檔案

```text
$DSH_HOME/instagram-assistant/
├── config.json       # 外掛設定
├── persona.md        # 人格卡（唯一事實來源）
├── persona.json      # 心情、記憶、未完成話題
├── posts.json        # 發布紀錄（最近 400 筆）
├── usage.json        # 助理的模型用量帳本
├── dm-state.json     # 私訊進度、待確認草稿、提醒節流
├── session.json      # Instagram 登入狀態（機密）
├── credential.json   # Instagram sessionid（機密）
├── account.json      # 快取的帳號 pk、使用者名稱、頭像
├── drafts/           # 產生的預覽
├── out/              # 渲染好的 Story 卡片
├── log.txt           # 執行日誌
└── install.log       # Python 環境安裝日誌
```

`session.json` 和 `credential.json` 是活的登入憑證。它們已被 git 忽略，外掛也不會主動上傳，但它們在磁碟上是明文 JSON —— 請保護好 DSH 家目錄，不要把內容貼進 issue。

### 花費

- 每則 Story、Note、私訊回覆和意圖解析都是一次 DSH 模型呼叫，記在你自己的 DSH 帳上。
- 設定頁會拆分助理自己的用量，並按內建價格表估算人民幣金額（DeepSeek Flash / V4-Pro，尖離峰時段）。這只是估算：官方價格和尖離峰規則都可能變化。
- 不需要額外訂閱、代理或第三方 API key。

## 風險與限制

這是一個會碰真實帳號、並且可選地碰真實機器的自動化工具。開啟全自動之前請先讀完這一節。

1. **非官方 Instagram API。** 外掛用的是 `instagrapi`（私有行動端 API），不是官方 Graph API。自動發文和傳訊息可能違反 Instagram 條款，可能導致流量限制、人機驗證、暫時封鎖甚至**失去帳號**。請用一個你輸得起的帳號，保持低頻，測試期優先使用草稿模式。
2. **你的使用資料會公開。** 專注時間、連續天數、週累計、token 數和生活素材都會被畫進圖片。如果這些資訊敏感，請不要開啟資料卡。token 不是金額，但仍然能描述你的習慣。
3. **主人的私訊可以執行程式碼。** 開著 `dm.intents` 時，主人帳號傳來的一句話可以在這台機器上執行 shell 指令或 `dsh headless` 任務。確認步驟防的是「助理聽錯話」，**防不住 Instagram 帳號被劫持**。不需要的話請關掉指令執行。
4. **人格卡不是過濾器。** 模型仍可能寫出不準確、不合時宜或不像你的內容。草稿模式就是為此存在的。帳號發出去的內容由你負責。
5. **私有 API 很脆。** Instagram 會不打招呼地改介面，今天能用的版本可能一夜之間失效。登入狀態會過期，人機驗證需要你在 App 裡手動完成。
6. **單一帳號、只發圖片。** 不支援多帳號、Reels/影片、按讚、追蹤、留言或 Story 互動。Story 都是單張圖片；「文字 Story」其實是帶文字的圖片。
7. **中文優先輸出。** 提示詞和備援模板都是中文。要寫其他語言，需要在人格卡裡明確要求並自行測試。
8. **非官方關聯。** 這是一個獨立開源專案。「Instagram」和「Meta」是 Meta Platforms, Inc. 的商標；「DeepSeek」「DeepSeek Harness」歸各自權利人所有。MIT 授權只涵蓋本外掛程式碼。

## 常見問題

| 現象 | 檢查什麼 |
| --- | --- |
| 設定裡沒有 **Instagram** | 外掛沒有啟用。在 DSH 日誌裡搜 `failed to import`；`index.js` 無效會讓整條外掛不啟用。重新安裝並重啟 DSH。 |
| 設定頁顯示「讀取失敗：HTTP undefined」 | 通常是舊版 `client.js` 漏了 `await fetch`。更新外掛並強制重新整理頁面。 |
| **安裝相依套件**失敗 | 沒有 Python 3.11+，或 Microsoft Store 的 `python` 別名把解譯器攔住了。從 python.org 安裝，或設定 `pythonPath` / `DSH_INSTAGRAM_PYTHON`；查看 `install.log`。 |
| pip 卡在 Downloading wheel | PyPI 不通。安裝器會自動重試清華鏡像；仍失敗就檢查代理/VPN 再重跑。 |
| 「尚未登入」/ `login_required` | `sessionid` 過期或複製不完整。重新匯出並登入。 |
| 按發布沒反應 | 安全閥拒絕了。看日誌裡的原因：暫停、當日上限、最小間隔、安靜時段或失敗冷卻。設定頁也會顯示同樣的原因。 |
| 失敗後好像按不動了 | 登入/人機驗證/卡片錯誤不會冷卻；瞬時網路錯誤會冷卻 120 分鐘。去 `log.txt` 看具體 code。 |
| `Invalid schema for function 'ig_config'` | 0.1.x 早期版本的迴歸：工具參數必須經過 `textTool()` 正規化。更新到最新版本。 |
| `tool_addition blocks can only be in system messages` | 反覆重新載入外掛讓目前會話累積了太多工具註冊事件。**開一個新會話**；不要在聊天中途反覆停用/啟用外掛。 |
| Windows 上 `spawn EPERM` / 子行程報錯 | DSH 沙箱阻止了建立行程。把 DSH 移出受限沙箱，或放行 Python 解譯器和 shell。 |
| 某個 Story 時間點被跳過 | 晚於時間點 90 分鐘就會標記 `missed`，不補發，避免積壓洗版。 |
| Instagram 人機驗證 / checkpoint | 在 Instagram App 或網頁裡手動完成。外掛不會也無法繞過。 |

日誌固定在 `$DSH_HOME/instagram-assistant/log.txt`，設定頁也會顯示最後幾行。

## 開發

### 目錄

```text
index.js                 # Host 外掛：設定、排程、HTTP 路由、工具
client.js                # 設定頁（非 ESM，window.__ModuleLoader__）
lib/                     # 純邏輯 + 單元測試
  actions.mjs            # 固定動作清單 + 意圖解析
  commands.mjs           # 短指令、主人/群組判定
  content.mjs            # 提示詞、文案、卡片 spec
  dshusage.mjs           # DSH 會話/用量解析
  features.mjs           # 自動回覆等級、提醒節流、發布開關
  persona.mjs            # 人格卡、記憶、群組提示詞
  plan.mjs               # 確定性每日計畫
  pricing.mjs            # token 價格表 + 尖離峰時段
  safety.mjs             # 發布安全閥
  singleflight.mjs       # 私訊輪詢單飛鎖
  spend.mjs              # 助理用量帳本
  unread.mjs             # 未讀私訊挑選規則
  usage.mjs              # 活動區塊、換日、連續天數
test/                    # 109 個單元測試，行程內執行
vendor/instagram-mcp/
  ig_cli.py              # Instagram 私有 API 橋接
  render_card.py         # Pillow 卡片渲染器
docs/research/           # DSH Host/Client 外掛契約筆記
```

沒有建置步驟，DSH 直接載入這些檔案。

### 測試

```bash
node test/run.mjs
```

`node test/run.mjs` 在一個行程裡 import 所有測試檔案，避開 Windows 沙箱裡 `node --test` 會遇到的 `spawn EPERM`。涵蓋：時區換日、活動區塊合併、週累計/連續天數、提示詞長度、卡片 spec、安全閥、確定性計畫、人格解析、私訊指令判定（只認主人 id）、群組規則、工具 schema 正規化、client 靜態契約、會話解析和用量計算。

快速手查統計管線：

```bash
node -e "import('./lib/dshusage.mjs').then(m => console.log(m.buildStats({ home: process.env.DSH_HOME })))"
```

### 開發循環

- 改 `client.js`：重新建置/載入 client bundle，然後重新整理頁面。
- 改 `index.js`：重啟 DSH。ESM 模組在 Host 行程生命週期內會被快取。
- 不要在使用者正在聊天時停用/啟用外掛：每次增刪工具都會在會話裡留下一則 `tool-addition`/`tool-removal` 開發者訊息。累積多了以後 Messages API 會整條拒絕：`messages.N: tool_addition blocks can only be in system messages`。改完 Host 程式碼請開新會話。
- 不要 `import '@deepseek-ai/*'`：桌面 profile 是 `autoInstallPeers:false` 且 `DSH_HOST_MODULES` 為空，裸 import 會讓整條外掛靜默不啟用。
- Host ↔ Client 只走 HTTP 路由（`/api/deepseek-instagram`），沒有自訂 RPC。
- 工具定義必須經過 `textTool()`，這樣 provider 看到的 `parameters.type` 才是 `"object"`。

### Python 環境（開發用）

```powershell
python -m venv --without-pip .venv
.venv\Scripts\python.exe -m ensurepip --upgrade
.venv\Scripts\python.exe -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple instagrapi pillow
echo '{}' | .venv\Scripts\python.exe vendor\instagram-mcp\ig_cli.py doctor
```

## 發布到 DSH 外掛市場

- 套件名：`deepseek-instagram`；MIT 授權；儲存庫 `https://github.com/Ez4p1xEL/deepseek-instagram`。
- 給 GitHub 儲存庫加上 `dsh-plugin` topic。
- 如果希望 App 內的 DSH 外掛中心能直接安裝，請發布到 npm（先 `npm pack --dry-run`，再 `npm publish`）。
- 在 <https://dsh-plugin.org/submit> 用 issue 模板提交：
  `[插件提交] Ez4p1xEL/deepseek-instagram — 讓 DSH 助理住進 Instagram`
- 收錄之後，可以把徽章加到 README 頂部：

```markdown
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/Ez4p1xEL/deepseek-instagram)
```

## 授權

[MIT](LICENSE) © 2026 Ez4p1xEL

本專案與 Meta Platforms, Inc.、Instagram、DeepSeek 沒有關聯，也未獲得其背書或贊助。使用風險自負，並請遵守你所自動化服務的使用條款。
