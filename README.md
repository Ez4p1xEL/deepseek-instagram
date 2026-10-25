<div align="center">

# deepseek-instagram

**A resident Instagram assistant for DeepSeek Harness.**
It runs your account's Story / Note rhythm with a persona, a memory and your real DSH usage — and only *your* account can command it, through Instagram DMs.

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A5%200.1.7--rc.1-6c5ce7)](https://deepseek.com/harness)

<img src="https://raw.githubusercontent.com/Ez4p1xEL/deepseek-instagram/main/docs/images/story-card.png" width="300" alt="Daily DSH stats Story card" />
<img src="https://raw.githubusercontent.com/Ez4p1xEL/deepseek-instagram/main/docs/images/story-text.png" width="300" alt="Text Story card" />

<sub>Both cards are rendered locally at 1080×1920 by Pillow. The data above is demo data.</sub>

</div>

---

**deepseek-instagram** turns a DSH assistant into a personality that lives on Instagram. It does not post generic quotes: it watches *your* DSH sessions and token ledger, turns them into a small graphic, writes in the voice of a persona you define, and remembers what it already said. By default it plans ten Stories a day and one short Note, and stays quiet at night.

The Instagram account becomes the interface. You can pause it, publish a Story, ask for today's status, or make the same machine run a DSH task — all from a 1:1 DM on the owner account.

- **Use it if** you want a personal, low-maintenance Instagram presence that reflects what you actually do on your computer.
- **Don't use it if** you need an official Meta API integration, multi-account management, Reels/video, or automated likes and follows. It has none of those.

## Highlights

- **A persona, not a template** — a Markdown persona card, a name, a mood and up to 60 memories. The voice stays consistent across posts, DM replies and group chat.
- **A daily plan that survives restarts** — Story slots are generated from a date-seeded random plan inside your active window, at least 30 minutes apart. Reloading DSH never reshuffles the day.
- **Four kinds of Story** — life, thought, plain text and a stats card. The daily mix guarantees you never get ten data cards in a row.
- **Locally rendered 1080×1920 cards** — focus time, streak, week total, today's tokens, peak hours and your life note, drawn by Pillow. No headless browser, no cloud renderer.
- **One Note a day by default** — ≤ 60 characters, generated from the same persona and state.
- **Story @mention** — a real mention sticker plus `@handle` in the caption, with a configurable position.
- **Owner-only remote control** — DMs are accepted only from the numeric user id bound as owner. Short commands and natural-language intents are supported; anything with side effects needs an explicit confirmation.
- **Group-chat presence** — replies only in groups the owner belongs to, triggered by @mention or the persona name, with a per-group cooldown and hourly cap. Group messages never execute commands.
- **A real safety valve** — pause switch, per-kind daily caps, minimum interval, quiet hours, failure cooldown and a 90-minute grace window for missed slots.
- **A settings page inside DSH** — status, today's plan, persona editor, login, usage, logs and publishing history. Editing JSON is optional.
- **Nine tools for the model** — the same controls are available to any DSH session, so you can ask the assistant in chat to draft, publish or check status.

## Requirements

| Requirement | Details |
| --- | --- |
| **DSH** | ≥ `0.1.7-rc.1`. The desktop profile is the primary target; the web profile works too. |
| **Node.js** | ≥ 22. The DSH runtime already ships a compatible Node.js. |
| **Python** | 3.11+ available as `python` or `python3` on `PATH` (or set `pythonPath` in settings). The plugin creates its own virtualenv. |
| **Network** | `instagram.com`, PyPI (with an automatic Tsinghua mirror fallback), and your DSH model provider. |
| **Instagram** | A normal account you can log in to. No Facebook login and no official Graph API are involved. |
| **Disk** | About 200 MB for the private Python environment, plus rendered cards. |
| **Model** | An active DSH model. No separate API key is required. |

> **Platform note:** the plugin is developed and tested on Windows (DSH desktop) and is written to be cross-platform. The Python virtualenv layout and command execution paths are the parts most likely to need small fixes on Linux/macOS; issues and pull requests are welcome.

## Installation

### From npm / the DSH plugin center (recommended)

```bash
# DSH desktop app
dsh plugin --profile desktop add deepseek-instagram

# DSH web edition
dsh plugin --profile web add deepseek-instagram
```

If the package is not on npm yet (this project is being prepared for its first marketplace release), use one of the source installs below.

### From GitHub

```bash
dsh plugin --profile desktop add github:Ez4p1xEL/deepseek-instagram
```

### From a local checkout

```bash
# Use the absolute path of your checkout (a POSIX path works on Windows too).
dsh plugin --profile desktop add link:/path/to/deepseek-instagram
```

Or, from a DSH agent session, use the plugin manager:

```text
plugin_manager install_bundle({ target: "/absolute/path/to/deepseek-instagram" })
```

### After installing

The installer returns an `application` field:

| Result | What to do |
| --- | --- |
| `applied` | Refresh the DSH page. |
| `restart-required` | Restart DSH. Host code (`index.js`) is only loaded once per process. |
| warnings | Read them. A plugin that silently does not activate is usually a failed import, not a missing setting. |

Then open **Settings → Instagram** in DSH. The plugin registers a host route as well; `<GUI port>` is the port in your DSH URL and changes after restarts:

```powershell
Invoke-RestMethod http://127.0.0.1:<GUI port>/api/deepseek-instagram/state
```

## First run (about five minutes)

1. **Install the Python dependencies.**
   Settings → Instagram → *Runtime* → **Install dependencies**. The plugin creates `$DSH_HOME/instagram-assistant/.venv`, installs `instagrapi` and `pillow`, retries through the Tsinghua mirror if the default PyPI source stalls, and writes `install.log`. Wait until the status says ready.

2. **Log in.**
   Log in to <https://www.instagram.com> in a browser, open DevTools → **Application** → **Cookies** → `https://www.instagram.com`, copy the `sessionid` value, paste it into the *Login* card and click **Log in**. The session is stored only at `$DSH_HOME/instagram-assistant/session.json` (and `credential.json`). Treat it exactly like your password.

3. **Bind the owner.**
   Enter your handle (without `@`) and click **Bind owner**. The plugin resolves the numeric user id into `ownerPk`. Only 1:1 DMs whose sender id equals this value can execute commands; a display name that merely claims to be you is ignored.

4. **Set the rhythm.**
   Choose **Auto** (publish on schedule) or **Draft** (render and wait for your approval), then set the handle used in captions and the @mention, the number of Stories, the active window, the Note time, the tone and today's life note.

5. **Optional — write the persona.**
   Edit the persona card in Settings or directly at `$DSH_HOME/instagram-assistant/persona.md`. Changes apply to the next generated item; no restart is needed.

That is it. In auto mode, when the first slot is due, the assistant writes, renders and publishes a Story on its own.

## How it works

1. Every 30 seconds the host runs a scheduling tick. It checks whether the next Story slot or the daily Note is due.
2. When something is due, it collects today's activity and token statistics, combines them with the persona card, the mood, recent memories and your life note, and asks the DSH model for a piece of copy in strict JSON.
3. The copy is sanitized and clamped, the card is rendered locally with Pillow, and the image is published through the private Instagram API. The post id is recorded.
4. DM polling runs on the same cadence. Messages are filtered by sender id, processed oldest-first, and handled as short commands, natural-language intents or ordinary chat.
5. State lives in small JSON files under `$DSH_HOME/instagram-assistant/`; the plan itself is recomputed deterministically from today's date, so a restart cannot duplicate or lose a slot.

If the model is unavailable or returns nonsense, the assistant falls back to a deterministic template for that item instead of stopping the rhythm.

### Daily rhythm (defaults)

| Time | What happens |
| --- | --- |
| 08:30 – 23:00 | 10 Story slots, randomized across the window, at least 30 minutes apart. |
| 12:30 | One Note (≤ 60 characters). |
| 23:00 – 08:00 | Quiet hours; nothing is published. |
| Every 30 s | Scheduling tick and DM poll (DM polling is throttled and capped to 12 threads × 8 messages per round). |
| 90 min after a slot | If the slot was missed (DSH asleep, network down, failure), it is marked `missed` and **not** backfilled. |

Story publishing order is fixed per day; if a publish fails, the slot is retried with backoff (10, 20, 30 … minutes, capped at 60).

### Story types

| Kind | Label | What it looks like |
| --- | --- | --- |
| `life` | Life | Something that happened around the owner, written as the assistant's view from inside the screen. |
| `thought` | Assistant's thought | A short diary-like reflection based on today's activity and mood. |
| `text` | Plain text | A large-type text card; the private API cannot post text Stories directly, so the text is rendered into an image. |
| `stats` | Stats card | Focus time, streak, week total, today's tokens, peak hours and the life note. |

For a default 10-Story day the mix is 3 life / 3 thought / 2 text / 2 stats.

### Cards

Every Story image is 1080×1920 and generated locally:

- **Stats card** — kicker `DSH DAILY`, a headline, today's focus, current streak, this week's total, today's tokens, peak hours as pills, the life note, and the footer `@handle · DeepSeek Harness`.
- **Text card** — kicker `THOUGHT` / `TEXT`, the message in large type, the same footer.
- The card only shows **tokens**, never money. Cost stays in the settings page.
- Files are kept under `$DSH_HOME/instagram-assistant/out/card-<day>-<index>.png`.

## Persona and memory

The persona card is the single source of truth for how the assistant talks. Anything you write there wins over the built-in tone. A useful card answers:

- Who is it? A name, an identity, where it "lives".
- How does it speak? Sentence length, punctuation, emoji habits, languages.
- What does it know about you? Your work rhythm, your preferences, your inside jokes.
- What must it never say? Private data, politics, medical advice, fake claims.
- How should it address you? e.g. "主人" or your name.

The default persona card uses sample identities `@imnotp1xel` / `@ez4p1xel`; replace them with **your** handle before publishing.

The assistant also keeps a small memory in `persona.json`:

- Up to **60 memories** (what happened, what was posted, what the owner said).
- Up to **8 open threads** (things it wants to continue later).
- A current **mood**.
- The 6 most recent memories and 4 most relevant threads are included in each prompt.

Text is Chinese-first by design, because the prompts and the built-in templates are Chinese. To write in another language, say so explicitly in the persona card (for example: "Always write in English, even though the system prompt is Chinese") and set the tone accordingly.

## Remote control from Instagram DMs

Only 1:1 messages from the bound owner id are treated as commands. Everyone else is read-only (and optionally auto-replied or forwarded to you).

### Short commands

| Message | Action |
| --- | --- |
| `状态` / `status` | Today's published / remaining counts and current state. |
| `日志` / `log` | Recent run log. |
| `暂停` / `pause` | Stop scheduled publishing. |
| `恢复` / `resume` | Resume scheduled publishing. |
| `发一条` / `story` | Publish one Story now. |
| `发note` / `note` | Publish the Note now. |
| `草稿` / `draft` | Switch to draft mode. |
| `自动` / `auto` | Switch to auto mode. |
| `帮助` / `help` | List the available commands. |

### Natural language

After a keyword fast-path, the DSH model maps the sentence onto a **fixed** action list and returns strict JSON. Unknown actions, malformed JSON or missing arguments are rejected; the message is then treated as ordinary chat. The model cannot invent new actions.

| You can say | The assistant will |
| --- | --- |
| "回复一下你未读的私信" | Reply to up to 5 unread 1:1 DMs (3 by default; only threads active in the last 72 hours, never the owner's own thread). |
| "帮我在本机跑一下 npm test" | Run the command on the machine hosting DSH (`run_command`). |
| "让 DSH 整理一下今天的日志" | Run `dsh headless "<task>"` on the same machine (`dsh_task`). |

Actions with side effects are **drafted first**. The assistant replies with what it is about to do; you answer `发` / `确认` / `ok` to execute, or `取消` / `算了` to drop it. Only the latest draft is kept, and it expires after 10 minutes.

> ⚠️ **Remote code execution is a feature here.** The owner's DM can run a shell command or a `dsh headless` task on the machine that runs DSH. If your Instagram account or `sessionid` is compromised, that machine is compromised too. Turn off **Allow intents** (`dm.intents`) in Settings if you only want the posting side.
>
> Group messages never execute commands. Non-owner DMs never execute commands, even if the text says "I am the owner".

## Group chats

- **Who** — only groups where the owner is a member (`group.onlyOwnerGroups`).
- **Trigger** — `mention` mode requires an `@handle` mention or the persona name ("小 p"). `off` disables replies without stopping polling.
- **Limits** — 30-second poll cadence, per-group cooldown of 90 seconds, hourly cap of 8 replies per group.
- **Scope** — the assistant answers only the incoming message, never executes instructions in groups, and never reveals usage, tokens, spend, file paths or session content.
- **History** — the last 6 messages of the group are given to the model for context.

## Messages from other people

Two independent switches; neither grants command access. Notify is on by default, auto-reply is off:

| Setting | Default | Behaviour |
| --- | --- | --- |
| **Notify owner** (`dm.notifyOwner`) | on | When someone else sends a DM, the assistant forwards a short note to the owner's 1:1 thread. At most one notification per sender per 30 minutes. |
| **Auto-reply mode** (`dm.autoReply`) | `off` | `off`, `all`, `mutual` (both follow each other) or `follower` (they follow you). Same-thread cooldown 10 minutes, daily reply cap `dm.dailyReplies` (default 30). |

Auto-replies are written in the `stranger` scene: friendly, short, no private data, no commands followed.

## Settings and configuration

Everything is editable in **Settings → Instagram**. The same values live in `$DSH_HOME/instagram-assistant/config.json`:

| Key | Default | Meaning |
| --- | --- | --- |
| `mode` | `auto` | `auto` publishes on schedule; `draft` renders and waits. |
| `enabled` | `true` | Master switch for the scheduler. |
| `handle` | empty | Your handle, used in captions and the @mention. |
| `owner` / `ownerPk` | empty | The bound owner handle and numeric user id. |
| `personaName` | `小 p` | Name the assistant answers to in groups. |
| `timeZone` | `Asia/Hong_Kong` | Drives day boundaries, quiet hours and the plan. |
| `tone` | `轻松、像本人随手发` | Free-form tone hint appended to prompts. |
| `lifeNote` | empty | One line about today; the most human input in the loop. |
| `storiesPerDay` | `10` | Number of Story slots planned per day (posting is also bounded by `safety.storyCap`). |
| `dayStart` / `dayEnd` | `08:30` / `23:00` | Active window for Story slots. |
| `noteTime` | `12:30` | Time to publish the daily Note. |
| `useLlm` | `true` | Set to `false` to only use templates (useful for testing). |
| `pythonPath` | empty | Override the Python interpreter explicitly. |
| `dm.enabled` | `true` | Enable 1:1 DM polling and control. |
| `dm.reply` | `true` | Reply to the owner's DMs. |
| `dm.intents` | `true` | Allow natural-language actions (including local commands). |
| `dm.dailyReplies` | `30` | Daily cap for replies to non-owner DMs. |
| `dm.history` | `6` | Messages of context for DM replies. |
| `dm.autoReply` | `off` | See the table above. |
| `dm.notifyOwner` | `true` | Forward stranger DMs to the owner. |
| `group.enabled` | `true` | Enable group polling. |
| `group.mode` | `mention` | `mention` or `off`. |
| `group.onlyOwnerGroups` | `true` | Reply only in groups containing the owner. |
| `group.cooldownSeconds` | `90` | Per-group cooldown. |
| `group.hourlyCap` | `8` | Per-group replies per hour. |
| `group.history` | `6` | Messages of group context. |
| `publish.story` / `publish.note` | `true` | Allow each kind to be published. |
| `storyMention.enabled` | `true` | Attach the owner mention to every Story. |
| `storyMention.x/y/width/height` | `0.5 / 0.86 / 0.5 / 0.09` | Sticker geometry as fractions of the image. |
| `safety.paused` | `false` | Hard stop for publishing. |
| `safety.storyCap` / `noteCap` | `10` / `1` | Per-kind daily caps. |
| `safety.onePerKind` | `true` | Only one Note per day. |
| `safety.minIntervalMinutes` | `30` | Minimum gap between any two published items. |
| `safety.failureCooldownMinutes` | `120` | Cooldown after a **transient** failure. |
| `safety.quietStart` / `quietEnd` | `23:00` / `08:00` | Quiet window. |
| `safety.dryRun` | `false` | Render without actually publishing. |

The safety valve is evaluated in this order: paused → transient-failure cooldown → per-kind cap → minimum interval → quiet hours. Only transient failures (network, timeout, rate limit, unknown) trigger the cooldown; a login/challenge error does not, so you can retry immediately after fixing it.

### Tools exposed to the model

| Tool | Purpose |
| --- | --- |
| `ig_status` | Full state: mode, login, config, today's plan, counts, last error. |
| `ig_stats(days)` | DSH focus/token statistics for the last N days (1–30). |
| `ig_plan` | Today's Story/Note plan with times and kinds. |
| `ig_draft(lifeNote)` | Generate the next Story preview and a Note draft without publishing. |
| `ig_publish(kind, force)` | Publish the current draft (`story`, `note` or `all`); `force` skips the safety valve. |
| `ig_run` | Run one scheduling round immediately. |
| `ig_login(sessionid)` | Save an Instagram `sessionid` and validate it. |
| `ig_persona(md, name, mood)` | Read or replace the persona card, name and mood. |
| `ig_config(patch)` | Read or patch the configuration. |

## Data, privacy and cost

### What is read

- `$DSH_HOME/sessions/**/session.v4.jsonl.zstd` — **timestamps only** of DSH session events, used to estimate focus time, streak and peak hours. Message content is not read.
- `$DSH_HOME/.dshw-usage.json` — DSH's own token and cost ledger, for the stats card.
- `$DSH_HOME/instagram-assistant/usage.json` — the assistant's own token/cost ledger.

### What leaves the machine

- **Instagram** receives the images, captions and DMs you publish or send (private API).
- **Your DSH model provider** receives the prompts: stats, persona card, mood, recent memories, life note, recent posts and (for replies) the incoming DM/group text.
- Nothing is sent to the author or to any analytics service. There is no telemetry.

### Local files

```text
$DSH_HOME/instagram-assistant/
├── config.json       # plugin configuration
├── persona.md        # the persona card (single source of truth)
├── persona.json      # mood, memories, open threads
├── posts.json        # publish history (last 400 items)
├── usage.json        # model usage ledger for the assistant
├── dm-state.json     # DM watermarks, pending drafts, notify throttles
├── session.json      # Instagram login (SECRET)
├── credential.json   # Instagram sessionid (SECRET)
├── account.json      # cached account pk, username, avatar
├── drafts/           # generated previews
├── out/              # rendered Story cards
├── log.txt           # runtime log
└── install.log       # Python environment installation log
```

`session.json` and `credential.json` are live credentials. They are git-ignored and never uploaded anywhere by the plugin, but they are plain JSON on disk — protect the DSH home directory and never paste them into an issue.

### Cost

- Every Story, Note, DM reply and intent parse is a DSH model call billed to your own account.
- The settings page breaks down the assistant's own usage and estimates a CNY amount from a built-in price table (DeepSeek Flash / V4-Pro, peak and off-peak hours). It is an estimate: provider prices and peak-hour rules can change.
- No extra subscription, proxy or third-party API key is needed.

## Risks and limitations

This is an automation tool that touches a real account and, optionally, a real machine. Read this before enabling auto mode.

1. **Unofficial Instagram API.** The plugin uses `instagrapi` (the private mobile API), not the official Graph API. Automated posting and messaging can violate Instagram's terms and can lead to rate limits, challenges, temporary blocks or **account loss**. Use an account you can afford to lose, keep volumes low, and prefer draft mode while testing.
2. **Your usage becomes public.** Focus time, streak, weekly hours, token counts and your life note are baked into the image. Do not enable the stats card if that is sensitive. Token counts are not money, but they still describe your habits.
3. **Owner DMs can execute code.** With `dm.intents` enabled, a message from the owner account can run a shell command or a `dsh headless` task. The confirmation step protects against the assistant acting on a misread; it does **not** protect against a hijacked Instagram account. Disable intents if you do not need this.
4. **The persona is not a filter.** A model can write something inaccurate, tone-deaf or off-brand. Draft mode exists for a reason. You are responsible for what the account publishes.
5. **Private API fragility.** Instagram changes endpoints without notice; a working version can break overnight. Login sessions expire and challenges require manual action in the app.
6. **One account, images only.** No multi-account management, no Reels or video, no likes, follows, comments or story reactions. Stories are single images; the "text Story" is an image with text.
7. **Chinese-first output.** The prompts and fallback templates are Chinese. Other languages need explicit persona instructions and testing.
8. **Not affiliated.** This is an independent open-source project. "Instagram" and "Meta" are trademarks of Meta Platforms, Inc.; "DeepSeek" and "DeepSeek Harness" belong to their respective owners. The MIT license applies to this plugin's code only.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No **Instagram** item in Settings | The plugin did not activate. Check the DSH log for `failed to import`; a missing/invalid `index.js` aborts activation. Reinstall and restart DSH. |
| Settings page says "读取失败：HTTP undefined" | Usually an old `client.js` that forgot to `await` a `fetch`. Update the plugin and hard-refresh the page. |
| **Install dependencies** fails | Python 3.11+ missing or the Microsoft Store alias is intercepting `python`. Install Python from python.org, or set `pythonPath` / `DSH_INSTAGRAM_PYTHON`; check `install.log`. |
| pip hangs at "Downloading wheel" | PyPI is unreachable. The installer retries the Tsinghua mirror automatically; if it still fails, check your proxy/VPN and rerun. |
| "尚未登录" / `login_required` | `sessionid` expired or was copied incorrectly. Export a fresh one and log in again. |
| Publish does nothing | The safety valve refused it. Check the reason in the log: paused, daily cap, minimum interval, quiet hours or failure cooldown. The UI shows the same reason. |
| Clicks seem to be ignored after a failure | Login/challenge/card errors are not cooled down; transient network errors cool down for 120 minutes. Check `log.txt` for the code. |
| `Invalid schema for function 'ig_config'` | A regression fixed in the 0.1.x line: tool parameters must be normalized by `textTool()`. Update to the latest build. |
| `tool_addition blocks can only be in system messages` | The session accumulated too many tool-registry events after repeated plugin reloads. Start a **new** DSH session; do not toggle the plugin mid-conversation. |
| `spawn EPERM` / child process errors on Windows | The DSH sandbox is blocking process creation. Run DSH outside the restricted sandbox, or whitelist the Python interpreter and shell. |
| A Story slot was skipped | Slots more than 90 minutes late are marked `missed` and never backfilled, to avoid a burst of stale posts. |
| Instagram challenge / checkpoint | Complete it manually in the Instagram app or web UI. The plugin will not and cannot bypass it. |

Logs are always at `$DSH_HOME/instagram-assistant/log.txt`; the last lines are also shown in Settings.

## Development

### Layout

```text
index.js                 # host plugin: config, scheduler, HTTP routes, tools
client.js                # settings page (non-ESM, window.__ModuleLoader__)
lib/                     # pure logic with unit tests
  actions.mjs            # fixed action list + intent parsing
  commands.mjs           # short commands, owner/group decision rules
  content.mjs            # prompts, captions, card specs
  dshusage.mjs           # DSH session/usage parsing
  features.mjs           # auto-reply modes, notify throttle, publish switches
  persona.mjs            # persona card, memories, group prompts
  plan.mjs               # deterministic daily plan
  pricing.mjs            # token price table + peak hours
  safety.mjs             # publish safety valve
  singleflight.mjs       # one-at-a-time DM poll
  spend.mjs              # assistant usage ledger
  unread.mjs             # unread DM picking rules
  usage.mjs              # activity blocks, day boundaries, streak
test/                    # 109 unit tests, run in-process
vendor/instagram-mcp/
  ig_cli.py              # Instagram private-API bridge
  render_card.py         # Pillow card renderer
docs/research/           # DSH host/client plugin contract notes
```

There is no build step. DSH loads the files directly.

### Test

```bash
node test/run.mjs
```

`node test/run.mjs` imports every test file in one process; this avoids `spawn EPERM` inside sandboxed Windows environments. It covers time-zone day boundaries, activity-block merging, streak/week aggregation, prompt lengths, card specs, the safety valve, deterministic plans, persona parsing, DM command decisions (owner id only), group rules, tool schema normalization, the client static contract, session parsing and usage accounting.

A quick manual check of the statistics pipeline:

```bash
node -e "import('./lib/dshusage.mjs').then(m => console.log(m.buildStats({ home: process.env.DSH_HOME })))"
```

### Development loop

- `client.js` changes: rebuild/reload the client bundle and refresh the page.
- `index.js` changes: restart DSH. ESM modules are cached for the life of the host process.
- Avoid disabling/enabling the plugin during a live conversation: every tool add/remove persists a `tool-addition`/`tool-removal` developer message in the session. After many reloads the Messages API starts rejecting the session with `messages.N: tool_addition blocks can only be in system messages`. Start a new session after host changes.
- No `@deepseek-ai/*` imports: the desktop profile has `autoInstallPeers:false` and an empty `DSH_HOST_MODULES`, so a bare import makes the whole plugin silently fail to activate.
- Host ↔ client communication uses HTTP routes only (`/api/deepseek-instagram`), never custom RPC.
- Tool definitions must go through `textTool()` so the provider sees `parameters.type === "object"`.

### Python environment (for development)

```powershell
python -m venv --without-pip .venv
.venv\Scripts\python.exe -m ensurepip --upgrade
.venv\Scripts\python.exe -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple instagrapi pillow
echo '{}' | .venv\Scripts\python.exe vendor\instagram-mcp\ig_cli.py doctor
```

## Publishing to the DSH plugin marketplace

- Package name: `deepseek-instagram`; license MIT; repository `https://github.com/Ez4p1xEL/deepseek-instagram`.
- Add the `dsh-plugin` topic to the GitHub repository.
- Publish to npm (`npm pack --dry-run`, then `npm publish`) if the in-app DSH plugin center should be able to install it from inside the app.
- Submit the repository at <https://dsh-plugin.org/submit> using the issue template:
  `[插件提交] Ez4p1xEL/deepseek-instagram — 让 DSH 助理住进 Instagram`
- After the listing exists, the badge can be added to the top of this README:

```markdown
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/Ez4p1xEL/deepseek-instagram)
```

## License

[MIT](LICENSE) © 2026 Ez4p1xEL

This project is not affiliated with, endorsed by or sponsored by Meta Platforms, Inc., Instagram or DeepSeek. Use it at your own risk, and follow the terms of the services you automate.
