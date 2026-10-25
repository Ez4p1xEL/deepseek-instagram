# instagrapi 3.2.0 API 速查表：sessionid 登录 / 发 Story 图片 / 发 Note

> **证据版本**：instagrapi **3.2.0**（`__version__` 与 `importlib.metadata` 双证，见附录 A 第 1 节）
> **站点包路径**：`D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi`
> **Python**：3.12.3 ｜ **探测用的 venv**：`D:\Space\Workspace\deepseek-instagram\.venv-api`
> **所有签名均为 `inspect.signature()` 的真实输出**，原始日志见附录 A 或 `docs/research/probe-output.txt`
> **复现命令**：`.venv-api\Scripts\python.exe scripts\probe_instagrapi.py`（**不联网、不登录**）

---

## 0. 一页结论（TL;DR）

| 要做的事 | 正确方法 | 定义位置 |
| --- | --- | --- |
| 用 sessionid 登录 | `Client.login_by_sessionid(sessionid: str) -> bool` | `instagrapi/mixins/auth.py:701` |
| 持久化会话 | `get_settings()` / `set_settings()` / `dump_settings()` / `load_settings()` | `mixins/auth.py:1075 / 1136 / 1172 / 1148` |
| 发 Story 图片 | `Client.photo_upload_to_story(path, caption="", ...) -> Story` | `mixins/photo.py:555` |
| 发个人 Note | `Client.create_note(text, audience=NoteAudience.MUTUAL_FOLLOWERS) -> Note` | `mixins/note.py:238` |
| Note 受众常量 | `from instagrapi.mixins.note import NoteAudience`（**顶层 `instagrapi` 不导出**） | `mixins/note.py:16` |
| 当前账号信息 | `Client.account_info() -> Account` | `mixins/account.py:56` |

| **不存在**的 API | 实际情况 |
| --- | --- |
| `Client.note_create(...)` | 没有。同类方法名是 `create_note` / `create_music_note`（另有 `media_note_create` 是"贴在 Reel 上的 Note"，不是个人 Note） |
| `Client.get_current_user()` | 没有。用 `account_info()` 或 `user_info(client.user_id)` |
| `Client(device={...})` / `Client(user_agent="...")` | **会 `TypeError`**（实测）。见第 1 节 |
| `media_configure_to_story` | 没有。内部方法名是 `photo_configure_to_story`（且**不需要**手工调用，caption 是 `photo_upload_to_story` 的参数） |

---

## 1. Client 构造：能传什么、不能传什么

真实签名（`inspect.signature(Client.__init__)`，见附录 A 第 2 节）：

```text
class Client.__init__(self, settings: Optional[dict] = None, proxy: Optional[str] = None,
                      delay_range: Optional[list] = None,
                      logger=<Logger instagrapi (WARNING)>,
                      override_app_version: bool = False, **kwargs)
```

源码：`instagrapi/__init__.py:114-150`。`**kwargs` 里**只被消费**下面这些键（其余一路透传）：

```text
tls_verify=True            request_timeout=1              public_request_retries_count=3
public_request_retries_timeout=2                          session_retry_total=3
session_retry_backoff_factor=2                            session_retry_statuses=[429,500,502,503,504]
timezone_offset=-14400     timezone_name=""              push_disabled=True
```

剩下的 kwargs 会被 `super().__init__(**kwargs)` 传给 `LoginMixin.__init__(self)`（`mixins/auth.py:457`，**不接受任何参数**）→ 直接炸。实测（附录 A 第 2 节）：

```text
Client(**{'device': {}})      -> TypeError: LoginMixin.__init__() got an unexpected keyword argument 'device'
Client(**{'user_agent': 'x'}) -> TypeError: LoginMixin.__init__() got an unexpected keyword argument 'user_agent'
Client(**{'settings': {}})    -> OK
Client(**{'private_transport': 'requests'}) -> OK
```

**正确姿势**：

```python
from instagrapi import Client

cl = Client()                              # 可选 Client(proxy="http://u:p@host:port",
                                           #          delay_range=[1, 3])
cl.set_device({                            # 想换设备指纹：登录后调用，再 dump_settings
    "manufacturer": "Google", "model": "Pixel 8 Pro",
    "android_version": 34, "android_release": "14",
})
cl.set_user_agent()                        # 一般不用动；要改就传完整 UA 字符串
```

- `set_device(device: Dict = None, reset: bool = False, hydrate_app_profile: bool = False) -> bool`（`auth.py:1256`）：**每次调用都从 `config.DEVICE_SETTINGS` 重新开始**再 overlay 你的 dict，并 `set_app(seed=uuids.uuid)` 选出 `app_version/version_code/bloks_versioning_id`（`auth.py:1291`）。所以要改硬件信息就**一次性传全**。
- 更稳的替代：把设备塞进 settings 再交给 Client —— `Client(settings={"device_settings": {...}, "uuids": {...}})`，`Client.__init__` 末尾会 `init()` 全量还原（`__init__.py:143-150`）。
- `settings` 允许只给部分键（`init()` 全部用 `.get()` 带默认值），已离线实测（附录 A 第 8 节）。

**transport 不用动**（任务里特别问的）：

| 属性 | 默认值 | 可选值 | 来源 |
| --- | --- | --- | --- |
| `public_transport` | `"requests"` | `"requests"` / `"curl"` | `mixins/public.py:54`，校验见 `public.py:147-150` |
| `public_transport_impersonate` | `"chrome136"` | curl_cffi 的指纹名 | `public.py:55` |
| `private_transport` | `"curl"` | `"requests"` / `"curl"` / `"utls"` | `mixins/private.py:155` |

默认值可直接用；`private_transport="curl"` 依赖已装好的 **curl_cffi**（本 venv 里是 0.16.3）。不要为了"更稳"去改成 requests，镜像不出问题就别动。

---

## 2. sessionid 登录：`login_by_sessionid`

```text
def login_by_sessionid(self, sessionid: str) -> bool
```

源码 `mixins/auth.py:701-738`，逐行行为：

1. `assert isinstance(sessionid, str) and len(sessionid) > 30, "Invalid sessionid"`
2. `user_match = re.search(r"^\d+", sessionid)` → 从 sessionid 开头抠出数字用户 ID（典型形态 `52448022913%3Axxxx...`）；`assert user_match, "Invalid sessionid"`
3. `self.settings["cookies"] = {"sessionid": sessionid}` ← **覆盖** settings 里的 cookies
4. `self.init()` ← 重建 cookie jar / device / uuids / headers（`auth.py:617`）
5. `self.authorization_data = {"ds_user_id": user_id, "sessionid": sessionid, "should_use_header_over_cookies": True}`
6. `user = self.user_info_v1(int(user_id))`；失败依次 fallback `_user_short_from_private_stream(user_id)` → `user_short_gql(int(user_id))`
7. `self.username = user.username`；`authorization_data["ds_user_id"] = str(user.pk)`；`self.private.cookies.set("ds_user_id", str(user.pk))`；更新 `Authorization` 头
8. `return True`

**返回值不可信**：它没有 `False` 分支，失败一律抛异常。所以要把异常当登录失败信号：

```python
from instagrapi import Client
from instagrapi.exceptions import LoginRequired, ChallengeRequired, PrivateError

cl = Client()
try:
    cl.login_by_sessionid(SESSIONID)
except AssertionError as e:          # sessionid 太短 / 开头不是数字（复制粘贴带了 "sessionid=" 前缀之类）
    raise RuntimeError(f"sessionid 格式不对（需 >30 字符且以数字开头）: {e}")
except LoginRequired:                # 403 {"message": "login_required"} → sessionid 过期
    raise RuntimeError("sessionid 已失效，请重新取一次")
except ChallengeRequired:            # IG 要求挑战/确认
    raise RuntimeError("账号被要求 challenge，需要在 App 里人工确认")
```

失败模式与异常（第 6 节有全表）：

| 现象 | 异常 |
| --- | --- |
| 长度 ≤ 30 或开头没有数字 | `AssertionError`（不是 ValidationError） |
| sessionid 过期/被踢 | `LoginRequired`（`private.py:560-561`） |
| 账号被要求验证 | `ChallengeRequired` / `AccountSuspended` |
| 网络/代理问题 | `ClientConnectionError`（连接层）/ `ProxyAddressIsBlocked`（代理被 IG 挡） |

**`login()` 不能用于 sessionid 会话**：`login()` 开头就 `if self.username is None or self.password is None: raise BadCredentials(...)`（`auth.py:785-786`）。你只有 sessionid 时调用它会立刻 `BadCredentials`。

---

## 3. 会话持久化（推荐流程，含离线实证）

### 3.1 结论

- **首次**：`login_by_sessionid(sid)` → **立刻** `dump_settings(path)`。
- **之后每次**：`Client()` → `load_settings(path)` → **直接调 API**。`load_settings` 内部就是 `set_settings(json.load(fp))`（`auth.py:1168-1170`），`set_settings` 会 `self.settings = deepcopy(...)` + `init()`，把 cookie jar、`authorization_data`（→ `Authorization` 头）、device、uuids、headers 全部还回来。
- **不要再调 `login_by_sessionid`**（能用也没必要，多一次 `user_info_v1` 请求 = 多一次风控暴露）；也**不要调 `login()`**（没有密码 → `BadCredentials`）。
- **绝不要调 `logout()`**：`auth.py:1558-1570` 会 `POST accounts/logout/`，服务端注销这个 sessionid，落盘的 settings 立刻作废。
- **会话是否还活着**：`cl.account_info()`；`LoginRequired` = 死了，用新 sessionid 重登并重 dump。

### 3.2 为什么这就够了（源码依据）

- `get_settings()`（`auth.py:1075`）落盘 27 个键，其中决定"能不能直接用"的是：
  - `cookies`：`requests.utils.dict_from_cookiejar(self.private.cookies)` → 登录后含 **`sessionid` + `ds_user_id`**
  - `authorization_data`：`Authorization: Bearer IGT:2:<base64>` 由它生成（`auth.py:1586-1593`）
  - `uuids`：`phone_id/uuid/client_session_id/advertising_id/android_device_id/request_id/tray_session_id`（决定设备指纹 + `set_app` 的 app 版本选择，别让它每次变）
  - `device_settings` / `user_agent` / `mid` / `ig_u_rur` / `ig_www_claim` / `last_login` / `timezone_offset` / `timezone_name` 等
- `user_id` **不在** settings 里，它是 property：先读 `cookies["ds_user_id"]`，再读 `authorization_data["ds_user_id"]`（`auth.py:1059-1065`）。`sessionid` 同理（`auth.py:1039-1043`）。→ 只要这两块在，恢复后 `cl.user_id` / `cl.sessionid` 立即可用（`create_note` 的 `assert self.user_id` 也过）。
- **settings 里没有 `password`/`username`**，所以别指望"load 完再 login()"。

### 3.3 离线实证（不联网，附录 A 第 8 节原样输出）

```text
Client() 未登录: user_id=None  sessionid=None
set_settings 之后: user_id=1234567890  sessionid='1234567890%3AAbCdEfGhIjKl%3A12x'
  private cookies      = {'sessionid': '...', 'ds_user_id': '1234567890'}
  private.headers 有 Authorization? True
dump_settings -> ...\ig_probe_settings.json（27 个键，cookies 键 = ['sessionid', 'ds_user_id']）
load_settings 到新 Client: user_id=1234567890  sessionid 一致? True
Client(settings=dict) 直传: user_id=1234567890  sessionid 一致? True
```

### 3.4 推荐代码

```python
import json
from pathlib import Path
from instagrapi import Client
from instagrapi.exceptions import LoginRequired

SETTINGS_PATH = Path(r"D:\Space\Workspace\deepseek-instagram\data\ig_settings.json")


def login_with_sessionid(sessionid: str) -> Client:
    cl = Client()                       # 不要 Client(device=...)
    cl.login_by_sessionid(sessionid)    # 抛异常=失败，不看返回值
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    cl.dump_settings(SETTINGS_PATH)     # dump_settings 不会帮你建目录
    return cl


def get_client(sessionid: str | None = None) -> Client:
    """有落盘就恢复；恢复失败/没落盘就用 sessionid 重登。"""
    if SETTINGS_PATH.exists():
        cl = Client()
        cl.load_settings(SETTINGS_PATH)  # 内部 set_settings → init()
        try:
            cl.account_info()            # 唯一的"会话还活着吗"探针
            return cl
        except LoginRequired:
            pass                          # 掉线，走下面重登
    if not sessionid:
        raise RuntimeError("settings 失效且没有提供新 sessionid")
    return login_with_sessionid(sessionid)
```

等价写法（`Client(settings=json_dict)` 在构造函数里就 `init()`）：`Client(json.loads(SETTINGS_PATH.read_text()))`。

**坑**：`login_by_sessionid` 内部会 `self.init()`，而 `init()` 用 `self.settings.get("device_settings")` 调 `set_device()`；如果 settings 里没有 `device_settings`，就会把设备重置成库默认值、并 `set_uuids({})` **重新生成所有 uuid**。因此：

- 想要"同设备指纹"：先 `cl.set_settings({"device_settings": my_dev, "uuids": saved_uuids})`，**再** `login_by_sessionid()`；或
- 图省事：`login_by_sessionid()` 之后 `cl.set_device(my_dev)`，再 `dump_settings()`。

---

## 4. 发 Story 图片：`photo_upload_to_story`

### 4.1 精确签名（`inspect` 原样）

```text
def photo_upload_to_story(
    self,
    path: pathlib.Path,
    caption: str = '',
    upload_id: str = '',
    mentions: List[instagrapi.types.StoryMention] = [],
    locations: List[instagrapi.types.StoryLocation] = [],
    links: List[instagrapi.types.StoryLink] = [],
    hashtags: List[instagrapi.types.StoryHashtag] = [],
    stickers: List[instagrapi.types.StorySticker] = [],
    medias: List[instagrapi.types.StoryMedia] = [],
    polls: List[instagrapi.types.StoryPoll] = [],
    extra_data: Dict[str, str] = {},
    resize_mode: Literal['fill', 'fit'] = 'fill',
) -> instagrapi.types.Story
```

来源：`mixins/photo.py:555`。视频版 `video_upload_to_story(self, path, caption='', thumbnail: Path = None, mentions=[], locations=[], links=[], hashtags=[], stickers=[], medias=[], polls=[], extra_data={}, resize_mode='fill') -> Story`（`mixins/video.py:639`）。

### 4.2 内部调用链（源码 `photo.py:605-642`）

```text
photo_upload_to_story(path, caption, ..., resize_mode)
├─ path = Path(path)                                  # 所以传 str 也能跑
├─ photo_rupload(path, upload_id, for_story=True, resize_mode=...)
│   ├─ 扩展名白名单 .jpg/.jpeg/.png/.webp，否则 ValueError（photo.py:183-185）
│   ├─ resize_mode 校验：只允许 "fill"/"fit"（photo.py:179-182）
│   ├─ prepare_image(...)                    # fill：按 9:16~90:47 裁切 + 缩到 ≤1080×1920
│   │   prepare_story_image_fit(...)         # fit ：等比缩进 1080×1920 画布 + 黑底
│   ├─ POST https://i.instagram.com/rupload_igphoto/<upload_name>
│   │   失败（HTTP != 200）→ PhotoNotUpload（photo.py:239-242）
│   └─ return (upload_id, width, height)
├─ previous_story_ids = _current_story_ids()          # ← 额外一次 user_stories 请求
└─ for attempt in range(10):                          # photo.py:617-641
       time.sleep(3)                                  # ← 固定 3 秒
       configured = photo_configure_to_story(upload_id, width, height, caption, ...)
       #   POST media/configure_to_story/（photo.py:1002）；caption 在这里进 data
       成功 → _extract_configured_story_or_recent(...) → Story
   10 次都失败 → PhotoConfigureStoryError
```

**`caption` 是参数，不是二次调用**：`photo_configure_to_story` 里 `if caption: data["caption"] = caption`（`photo.py:837-838`）。外部永远不需要手动调 configure。

### 4.3 最小可用代码

```python
from pathlib import Path
from instagrapi import Client

cl = Client()
cl.load_settings(r"D:\Space\Workspace\deepseek-instagram\data\ig_settings.json")

story = cl.photo_upload_to_story(
    Path(r"D:\Space\Workspace\deepseek-instagram\data\story.jpg"),  # 本地文件；仅 jpg/jpeg/png/webp
    caption="今天的图",          # "" = 不带文字
    resize_mode="fill",         # 默认 fill（裁切铺满）；fit = 加黑边不裁
)
print(story.pk, story.id, story.media_type, story.taken_at)
```

- **路径类型**：形参标 `pathlib.Path`，但函数体立刻 `Path(path)`，所以 `str` 也行；**不能是 URL**（`photo_rupload` 里 `assert isinstance(path, Path)`）。
- **图片处理**：`image_util.prepare_image()`（`image_util.py:101`）会裁到 Story 比例、缩到 ≤1080×1920、非 RGB 一律转 RGB（PNG 透明→白底）**并以 JPEG 编码上传**；`fit` 模式走 `prepare_story_image_fit()`（`image_util.py:144`），输出固定 1080×1920 黑底画布。
- **返回值**：`Story` pydantic 对象，20 个字段（附录 A 第 5 节）：`pk, id, code, taken_at, imported_taken_at, media_type, product_type, thumbnail_url, user, video_url, video_duration, sponsor_tags, is_paid_partnership, mentions, links, hashtags, locations, stickers, medias, polls`。常用 `story.pk` / `story.id` / `story.code`。

### 4.4 Story 的坑（都来自源码，不是猜的）

1. **至少 3 秒**：configure 前 `time.sleep(3)`，最坏 10×3=30 秒 + 网络。HTTP 超时别设得比这短。
2. **多一次请求**：上传前 `_current_story_ids()` 会 `user_stories(user_id)`（`media.py:289-297`，异常被吞掉）。日志里多一条属正常。
3. **尺寸元数据不对称**：`fill` 模式下 `width/height` 是**原图**尺寸（`photo.py:243-248` 重新 `Image.open(path)`），但上传字节已经被裁/缩；`fit` 模式才是加工后的 1080×1920。→ 想让 configure 元数据和图片完全一致，自己先产出 1080×1920 的 JPEG 再传。
4. **扩展名白名单**：`.jpg/.jpeg/.png/.webp`（`suffix.lower()`），`.bmp/.gif/.heic` 在发请求前就 `ValueError("Invalid file format...")`。
5. **"抛异常 ≠ 没发出去"**：configure 成功但响应里没 media payload 时，库会用 `_new_story_after_upload()` 再查 5 次（每次 3 秒，`media.py:299-314`），仍找不到才抛 `PhotoConfigureStoryError`。**重试前先用 `cl.user_stories(cl.user_id, amount=5)` 看有没有已发出去**，否则容易重复发。
6. **PNG 会被转 JPEG**（`prepare_image`），但 `X-Entity-Type` 仍按后缀报 `image/png`。直接给 JPEG 最省事。

---

## 5. 发 Note：`create_note`（没有 `note_create`）

### 5.1 精确签名（`inspect` 原样）

```text
def create_note(self,
                text: str,
                audience: instagrapi.mixins.note.NoteAudience = <NoteAudience.MUTUAL_FOLLOWERS: 0>
                ) -> instagrapi.types.Note

def create_music_note(self,
                      track: Union[instagrapi.types.Track, Dict],
                      text: str = '',
                      audience: NoteAudience = <NoteAudience.MUTUAL_FOLLOWERS: 0>,
                      start_time: Optional[int] = None,
                      duration: int = 30000,
                      browse_session_id: Optional[str] = None,
                      alacorn_session_id: Optional[str] = None) -> instagrapi.types.Note
```

来源：`mixins/note.py:238` / `mixins/note.py:265`。

`NoteAudience`（`mixins/note.py:16-18`，`IntEnum`）：

```python
from instagrapi.mixins.note import NoteAudience
# NoteAudience.MUTUAL_FOLLOWERS = 0   互关好友可见
# NoteAudience.CLOSE_FRIENDS    = 1   密友可见
assert hasattr(instagrapi, "NoteAudience") is False   # 顶层不导出（实测）
```

### 5.2 实现（`note.py:238-263`）

```python
assert self.user_id, "Login required"                     # 唯一的本地校验
audience_value = self._note_audience_value(audience)      # assert isinstance(audience, NoteAudience)
data = {"note_style": 0, "text": text, "_uuid": self.uuid, "audience": audience_value}
result = self.private_request("notes/create_note", data=data)
assert result.pop("status", "") == "ok", "Failed to create new Note"
return Note(**result)
```

- **文本长度：源码里没有任何本地长度校验**（既没有 `len(text)` 判断，也没有截断）。长度限制完全在服务端；业务侧请自己卡（IG App 的表现是 ~60 字符，但这不是本库的约束，源码里查不到，标注为"未从源码证实"）。
- `audience` 必须传枚举实例，传 `0`/`1` 这种 int 会在 `_note_audience_value` 里 `AssertionError`（`note.py:23-28`）。
- 返回 `Note`（10 字段）：`id, text, user_id, user, audience, created_at, expires_at, is_emoji_only, has_translation, note_style`。

### 5.3 最小可用代码

```python
from instagrapi import Client
from instagrapi.mixins.note import NoteAudience

cl = Client()
cl.load_settings(r"D:\Space\Workspace\deepseek-instagram\data\ig_settings.json")

note = cl.create_note("今天早点睡", NoteAudience.MUTUAL_FOLLOWERS)
print(note.id, note.text, note.audience, note.expires_at)
```

### 5.4 其余 note 相关方法（`dir(Client)` 实测，共 14 个含 `note` 的可调用成员）

| 方法 | 签名 | 备注 |
| --- | --- | --- |
| `create_note` | `(text: str, audience: NoteAudience = MUTUAL_FOLLOWERS) -> Note` | 个人 Note，本任务用这个 |
| `create_music_note` | `(track, text='', audience=..., start_time=None, duration=30000, browse_session_id=None, alacorn_session_id=None) -> Note` | 带音乐的 Note；需要 `notes_music_browser()` 的 session |
| `get_notes` | `() -> List[Note]` | 读 Direct 里的 Notes（GraphQL） |
| `get_note_by_user` | `(notes: List[Note], username: str) -> Optional[Note]` | 纯本地过滤 |
| `get_note_text_by_user` | `(notes: List[Note], username: str) -> Optional[str]` | 同上 |
| `last_seen_update_note` | `() -> bool` | POST `notes/update_notes_last_seen_timestamp/` |
| `delete_note` | `(note_id: int) -> bool` | POST `notes/delete_note/`，`status == "ok"` |
| `notes_music_browser` | `() -> Dict` | POST `music/notes_audio_browser/` |
| `media_note_create` | `(media_id: str, text: str = '', audience: int = 7, note_style: int = 13, extra_data: Optional[Dict] = None) -> Dict` | **另一个功能**：贴在 Reel/帖子上，POST `media/create_note/v2/`，返回**原始 dict**（不是 `Note` 模型） |
| `media_note_delete` | `(note_id: str, extra_data: Optional[Dict] = None) -> bool` | POST `media/delete_note/` |
| `_note_audience_value` | `(audience: NoteAudience) -> int`（staticmethod） | 内部校验 |
| `_note_from_note_dict` / `_note_dict_from_inbox_tray_item` / `_note_dict_from_create_inbox_tray_item` | 内部解析 | 不用管 |

⚠️ `media_note_create` 不是"发个人 Note"：它给某条 media 挂一条 Note（Android 原始值 `audience=7`、`note_style=13`，`mixins/media.py:914-963`）。如果目标是"我主页/私信里那条 Note"，用 `create_note`。

---

## 6. 异常清单与处理建议

继承关系（实测 MRO，附录 A 第 6 节）：`ClientError(Exception)` 是根，`PrivateError(ClientError)` 是私钥 API 的中转层。

| 异常 | 触发条件（源码位置） | 建议 |
| --- | --- | --- |
| `LoginRequired` | 403 且 body `{"message":"login_required"}`（`private.py:559-561`） | 会话死了 → 用新 sessionid 重登 + 重 dump |
| `ClientLoginRequired` | public/graphql/web_profile 层缺少会话（`public.py:362`、`graphql.py:245`、`user.py:157`） | 同上，或该接口本就需要登录 |
| `ChallengeRequired` | 400 `message=="challenge_required"` 且 url 不含 `/suspended/`；或 404 且 body 恰为 `b"Not Found"`（masked challenge）（`private.py:577-581`, `657-663`） | 需要人工在 App 里确认；别自动重试 |
| `ChallengeRedirection` / `ChallengeSelfieCaptcha` / `ChallengeUnknownStep` | challenge 各步骤 | 同上，且基本等于自动化到此为止 |
| `AccountSuspended` | 400 challenge url 含 `/suspended/`（`private.py:579-580`） | 账号被停用 → 停止一切重试，通知用户 |
| `TwoFactorRequired` | 400 带 `two_factor_info` 或 `error_type=="two_factor_required"`（`private.py:567-576`） | sessionid 流程一般碰不到（登录密码流才有） |
| `RateLimitError` | 400 `error_type=="rate_limit_error"`（`private.py:591-592`） | 退避 + 当天降频；这是"发太快" |
| `PleaseWaitFewMinutes` | 任意错误 body 里含 `"Please wait a few minutes"`（`private.py:557-558`） | 冷却 5~30 分钟，别硬重试 |
| `ClientThrottledError` | HTTP 429（`private.py:648-649`） | 指数退避；不要立即重发 |
| `FeedbackRequired` | 400 `message=="feedback_required"`（`private.py:582-588`） | 账号被"限制活动"，停用一段时间 |
| `SentryBlock` | 400 `error_type=="sentry_block"`（`private.py:589-590`） | 风控拦截，换环境/停手 |
| `BadPassword` | 400 `error_type=="bad_password"`（`private.py:593-602`） | 只有密码登录会碰到 |
| `BadCredentials` | `login()` 时 username/password 缺任一（`auth.py:785-786`） | **sessionid 会话不要调 `login()`** |
| `ClientForbiddenError` | 403 且不是 login_required（`private.py:559-564`） | 权限/风控，读 `e.response.text` |
| `ClientUnauthorizedError` | 401（`private.py:651-652`） | 同 LoginRequired |
| `ClientNotFoundError` | 404（非 masked challenge）（`private.py:663`） | 媒体/用户不存在 |
| `ClientRequestTimeout` | 408（`private.py:665-666`） | 可重试 |
| `ClientConnectionError` | 连接/代理层错误 | 可重试（带退避） |
| `ClientJSONDecodeError` | 响应不是 JSON（`private.py:547-550`） | 可能被 HTML 拦截页顶替；看 `last_response.text` |
| `ProxyAddressIsBlocked` | 私钥 API 返回代理被挡 | 换代理 |
| `UnknownError` → `ClientNeedsUpgradeError` | 400 `needs_upgrade`（`private.py:636-637`） | 提升 app_version/库版本 |
| `PhotoNotUpload` | rupload HTTP != 200（`photo.py:239-242`） | 图片/网络问题，可重试 1 次 |
| `PhotoConfigureStoryError` | configure 连续 10 次无结果（`photo.py:642`） | **先查是否已发**（见 4.4 第 5 条），再决定重试 |
| `VideoNotUpload` / `VideoConfigureStoryError` | 视频路径同上 | 同上 |
| `NoteNotFound` / `StoryNotFound` / `MediaNotFound` / `UserNotFound` | `NotFoundError` 子类 | 资源不存在 |
| `ValidationError`（instagrapi 自己的，`AssertionError` 子类） | 部分解析校验 | **与 pydantic 的 `ValidationError` 同名不同物**；模型解析失败抛的是 pydantic 那个 |
| `AssertionError`（原生） | `audience` 传 int、`path` 不是 Path、sessionid 太短、`assert self.user_id` | 调用参数问题，**不要重试** |
| `ValueError` | 图片后缀不在白名单、`resize_mode` 不是 fill/fit（`photo.py:179-185`） | 改调用，不重试 |

统一处理骨架（分类，不吞错）：

```python
from instagrapi.exceptions import (
    LoginRequired, ClientLoginRequired, ChallengeRequired, AccountSuspended,
    RateLimitError, PleaseWaitFewMinutes, ClientThrottledError, FeedbackRequired,
    ClientConnectionError, ClientRequestTimeout, PhotoNotUpload, PhotoConfigureStoryError,
)

FATAL_HUMAN   = (ChallengeRequired, AccountSuspended)
SESSION_DEAD  = (LoginRequired, ClientLoginRequired)
BACKOFF       = (RateLimitError, ClientThrottledError, PleaseWaitFewMinutes, FeedbackRequired)
RETRY_NET     = (ClientConnectionError, ClientRequestTimeout, ClientJSONDecodeError)
RETRY_UPLOAD  = (PhotoNotUpload, PhotoConfigureStoryError)
```

- 发布类的失败**必须落到日志**（AGENTS.md 的约定），不要静默吞掉。

---

## 7. 其它被点名的方法（精确签名）

```text
def login(self, username: Optional[str] = None, password: Optional[str] = None,
          relogin: bool = False, verification_code: str = '') -> bool
def get_settings(self) -> Dict
def set_settings(self, settings: Dict) -> bool
def load_settings(self, path: Union[str, pathlib.Path], override_app_version: bool = False) -> Dict
def dump_settings(self, path: Union[str, pathlib.Path]) -> bool
def set_device(self, device: Dict = None, reset: bool = False,
               hydrate_app_profile: bool = False) -> bool
def set_user_agent(self, user_agent: str = "", reset: bool = False) -> bool
def user_info(self, user_id: str, use_cache: bool = True) -> instagrapi.types.User
def account_info(self) -> instagrapi.types.Account
def get_timeline_feed(self,
                      reason: Literal['cold_start_fetch', 'warm_start_fetch', 'pagination',
                                      'pull_to_refresh', 'auto_refresh'] = 'pull_to_refresh',
                      max_id: str = None,
                      seen_posts: Union[str, Iterable[str], None] = None,
                      feed_view_info: Union[str, List[Dict[str, Any]], None] = None) -> Dict
def logout(self) -> bool
def user_stories(self, user_id: str, amount: int = None) -> List[Story]
```

- `get_current_user`：**不存在**（`[MISSING]`）。当前账号用 `account_info()`（`GET accounts/current_user/?edit=true`，返回 `Account`：`pk, username, full_name, is_private, profile_pic_url, is_verified, biography, external_url, is_business, birthday, phone_number, gender, email`）。
- `logout()`：会让 sessionid 服务端失效，**持久化场景禁用**。
- `get_timeline_feed` 返回原始 `Dict`（不是模型），`reason` 限定 5 个 Literal 值。

---

## 8. 踩坑速查（按"会不会浪费你一小时"排序）

1. **没有 `note_create`、没有 `get_current_user`** —— 博客/老代码里常见的错名。
2. **`Client(device=...)` / `Client(user_agent=...)` 直接 TypeError** —— 用 `set_device()` / `set_user_agent()` / `Client(settings={...})`。
3. **sessionid 会话不能调 `login()`** —— 立刻 `BadCredentials`（password 为 None）。
4. **不要 `logout()`** —— 会把落盘的 sessionid 弄废。
5. **`login_by_sessionid` 用 assert 校验**：副本 sessionid 带了 `sessionid=` 前缀、或长度 ≤30、或开头不是数字 → `AssertionError`，错误信息只有 `"Invalid sessionid"`。
6. **`login_by_sessionid` 内部 `init()` 会重置 device/uuids** —— 自定义设备要先进 settings，或登录后再 set + dump。
7. **Story 上传固定 3 秒起跳**（`sleep(3)` × 最多 10 次），还额外 GET 一次 `user_stories`。
8. **Story `fill` 模式的 width/height 是原图尺寸**，与实际上传字节不一致；想完全可控就自己先出 1080×1920 JPEG。
9. **图片后缀白名单** `.jpg/.jpeg/.png/.webp`，其他后缀在发请求前 `ValueError`。
10. **`PhotoConfigureStoryError` ≠ 没发出去**，重试前先 `user_stories` 查。
11. **`NoteAudience` 顶层不导出**：必须 `from instagrapi.mixins.note import NoteAudience`。
12. **`create_note` 的 audience 传 int 会 AssertionError**。
13. **settings 里没有 username/password**，只有 `cookies` + `authorization_data` 撑起登录态；`user_id` 是从 `ds_user_id` 推导的 property。
14. `dump_settings` 用 `open(path,"w")`（不建目录、跟随系统编码）；`load_settings` 用 `open(path,"r")`。Windows 上要确保父目录存在。
15. `request_timeout` 不是 HTTP 超时，是**重试前的 sleep 秒数**（`private.py:488`、`graphql.py:333-334`）；私钥请求本身没设 requests timeout。

---

## 9. 未验证的边界（诚实边界）

- 本文全部结论来自**源码 + inspect + 离线构造 Client**，**没有真实登录、没有真实发帖**（任务要求不联网）。
- 未验证：真实 sessionid 的成功率、Note 的 60 字符服务端限制、`fill` 尺寸不对称在 IG 端的实际表现、challenge 触发阈值、`media_note_create` 在 App 端的效果。
- 上面这些都需要一次真机/真号冒烟测试才能落定为"事实"。

---

## 附录 A：`probe_instagrapi.py` 真实输出

```text


==============================================================================
1. 版本与环境
==============================================================================
instagrapi.__version__ = 3.2.0
instagrapi.__file__    = D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\__init__.py
python                 = 3.12.3
dist version           = 3.2.0
dist location          = D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages

==============================================================================
2. Client 构造函数与 transport 默认值
==============================================================================
class Client.__init__(self, settings: Optional[dict] = None, proxy: Optional[str] = None, delay_range: Optional[list] = None, logger=<Logger instagrapi (WARNING)>, override_app_version: bool = False, **kwargs)
Client() 可调用签名: (settings: Optional[dict] = None, proxy: Optional[str] = None, delay_range: Optional[list] = None, logger=<Logger instagrapi (WARNING)>, override_app_version: bool = False, **kwargs)
Client.public_transport  (类默认) = 'requests'
Client.private_transport (类默认) = 'curl'
Client.public_transport_impersonate = 'chrome136'

关键 kwargs 探测（只构造对象，不联网）:
  Client(**{'device': {}}) -> TypeError: LoginMixin.__init__() got an unexpected keyword argument 'device'
  Client(**{'user_agent': 'x'}) -> TypeError: LoginMixin.__init__() got an unexpected keyword argument 'user_agent'
  Client(**{'settings': {}}) -> OK (Client)
  Client(**{'private_transport': 'requests'}) -> OK (Client)

==============================================================================
3. 指定方法的完整签名（inspect 原始输出）
==============================================================================
def login_by_sessionid(self, sessionid: str) -> bool
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\auth.py
def login(self, username: Optional[str] = None, password: Optional[str] = None, relogin: bool = False, verification_code: str = '') -> bool
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\auth.py
def get_settings(self) -> Dict
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\auth.py
def set_settings(self, settings: Dict) -> bool
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\auth.py
def load_settings(self, path: Union[str, pathlib.Path], override_app_version: bool = False) -> Dict
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\auth.py
def dump_settings(self, path: Union[str, pathlib.Path]) -> bool
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\auth.py
def set_device(self, device: Dict = None, reset: bool = False, hydrate_app_profile: bool = False) -> bool
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\auth.py
def photo_upload_to_story(self, path: pathlib.Path, caption: str = '', upload_id: str = '', mentions: List[instagrapi.types.StoryMention] = [], locations: List[instagrapi.types.StoryLocation] = [], links: List[instagrapi.types.StoryLink] = [], hashtags: List[instagrapi.types.StoryHashtag] = [], stickers: List[instagrapi.types.StorySticker] = [], medias: List[instagrapi.types.StoryMedia] = [], polls: List[instagrapi.types.StoryPoll] = [], extra_data: Dict[str, str] = {}, resize_mode: Literal['fill', 'fit'] = 'fill') -> instagrapi.types.Story
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\photo.py
def video_upload_to_story(self, path: pathlib.Path, caption: str = '', thumbnail: pathlib.Path = None, mentions: List[instagrapi.types.StoryMention] = [], locations: List[instagrapi.types.StoryLocation] = [], links: List[instagrapi.types.StoryLink] = [], hashtags: List[instagrapi.types.StoryHashtag] = [], stickers: List[instagrapi.types.StorySticker] = [], medias: List[instagrapi.types.StoryMedia] = [], polls: List[instagrapi.types.StoryPoll] = [], extra_data: Dict[str, str] = {}, resize_mode: Literal['fill', 'fit'] = 'fill') -> instagrapi.types.Story
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\video.py
def get_timeline_feed(self, reason: Literal['cold_start_fetch', 'warm_start_fetch', 'pagination', 'pull_to_refresh', 'auto_refresh'] = 'pull_to_refresh', max_id: str = None, seen_posts: Union[str, Iterable[str], NoneType] = None, feed_view_info: Union[str, List[Dict[str, Any]], NoneType] = None) -> Dict
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\auth.py
def user_info(self, user_id: str, use_cache: bool = True) -> instagrapi.types.User
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\user.py
def account_info(self) -> instagrapi.types.Account
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\account.py
[MISSING] Client.get_current_user  <-- 该方法不存在
def logout(self) -> bool
    # source: D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\mixins\auth.py

==============================================================================
4. note 相关方法（note_create 存在吗？）
==============================================================================
note_create 是否存在: False
含 'note' 的可调用成员共 14 个:
  def _note_audience_value(audience: instagrapi.mixins.note.NoteAudience) -> int
  def _note_dict_from_create_inbox_tray_item(result: Dict) -> Dict
  def _note_dict_from_inbox_tray_item(item: Dict) -> Dict
  def _note_from_note_dict(data: Dict) -> instagrapi.types.Note
  def create_music_note(self, track: Union[instagrapi.types.Track, Dict], text: str = '', audience: instagrapi.mixins.note.NoteAudience = <NoteAudience.MUTUAL_FOLLOWERS: 0>, start_time: Optional[int] = None, duration: int = 30000, browse_session_id: Optional[str] = None, alacorn_session_id: Optional[str] = None) -> instagrapi.types.Note
  def create_note(self, text: str, audience: instagrapi.mixins.note.NoteAudience = <NoteAudience.MUTUAL_FOLLOWERS: 0>) -> instagrapi.types.Note
  def delete_note(self, note_id: int) -> bool
  def get_note_by_user(self, notes: List[instagrapi.types.Note], username: str) -> Optional[instagrapi.types.Note]
  def get_note_text_by_user(self, notes: List[instagrapi.types.Note], username: str) -> Optional[str]
  def get_notes(self) -> List[instagrapi.types.Note]
  def last_seen_update_note(self) -> bool
  def media_note_create(self, media_id: str, text: str = '', audience: int = 7, note_style: int = 13, extra_data: Optional[Dict] = None) -> Dict
  def media_note_delete(self, note_id: str, extra_data: Optional[Dict] = None) -> bool
  def notes_music_browser(self) -> Dict

==============================================================================
5. NoteAudience / 返回类型字段
==============================================================================
from instagrapi.mixins.note import NoteAudience -> <enum 'NoteAudience'>
  members = [('MUTUAL_FOLLOWERS', 0), ('CLOSE_FRIENDS', 1)]
  instagrapi.NoteAudience 顶层导出? False

Note.model_fields (10):
  - id: str = PydanticUndefined
  - text: str = PydanticUndefined
  - user_id: str = PydanticUndefined
  - user: UserShort = PydanticUndefined
  - audience: int = PydanticUndefined
  - created_at: datetime = PydanticUndefined
  - expires_at: datetime = PydanticUndefined
  - is_emoji_only: bool = PydanticUndefined
  - has_translation: bool = PydanticUndefined
  - note_style: int = PydanticUndefined

Story.model_fields (20):
  - pk: str = PydanticUndefined
  - id: str = PydanticUndefined
  - code: str = PydanticUndefined
  - taken_at: datetime = PydanticUndefined
  - imported_taken_at: Optional = None
  - media_type: int = PydanticUndefined
  - product_type: Optional = ''
  - thumbnail_url: Optional = None
  - user: UserShort = PydanticUndefined
  - video_url: Optional = None
  - video_duration: Optional = 0.0
  - sponsor_tags: List = PydanticUndefined
  - is_paid_partnership: Optional = False
  - mentions: List = PydanticUndefined
  - links: List = PydanticUndefined
  - hashtags: List = PydanticUndefined
  - locations: List = PydanticUndefined
  - stickers: List = PydanticUndefined
  - medias: List = []
  - polls: List = []

Account.model_fields (13):
  - pk: str = PydanticUndefined
  - username: str = PydanticUndefined
  - full_name: str = PydanticUndefined
  - is_private: bool = PydanticUndefined
  - profile_pic_url: HttpUrl = PydanticUndefined
  - is_verified: bool = PydanticUndefined
  - biography: Optional = ''
  - external_url: Optional = None
  - is_business: bool = PydanticUndefined
  - birthday: Optional = None
  - phone_number: Optional = None
  - gender: Optional = None
  - email: Optional = None

==============================================================================
6. 异常类清单与继承关系
==============================================================================
ClientError: ClientError <- Exception <- BaseException <- object
ClientUnknownError: ClientUnknownError <- ClientError <- Exception <- BaseException <- object
ClientLoginRequired: ClientLoginRequired <- ClientError <- Exception <- BaseException <- object
ClientConnectionError: ClientConnectionError <- ClientError <- Exception <- BaseException <- object
ClientBadRequestError: ClientBadRequestError <- ClientError <- Exception <- BaseException <- object
ClientUnauthorizedError: ClientUnauthorizedError <- ClientError <- Exception <- BaseException <- object
ClientForbiddenError: ClientForbiddenError <- ClientError <- Exception <- BaseException <- object
ClientNotFoundError: ClientNotFoundError <- ClientError <- Exception <- BaseException <- object
ClientThrottledError: ClientThrottledError <- ClientError <- Exception <- BaseException <- object
ClientRequestTimeout: ClientRequestTimeout <- ClientError <- Exception <- BaseException <- object
ClientJSONDecodeError: ClientJSONDecodeError <- ClientError <- Exception <- BaseException <- object
ClientGraphqlError: ClientGraphqlError <- ClientError <- Exception <- BaseException <- object
PrivateError: PrivateError <- ClientError <- Exception <- BaseException <- object
LoginRequired: LoginRequired <- PrivateError <- ClientError <- Exception <- BaseException <- object
ChallengeError: ChallengeError <- PrivateError <- ClientError <- Exception <- BaseException <- object
ChallengeRequired: ChallengeRequired <- ChallengeError <- PrivateError <- ClientError <- Exception <- BaseException
ChallengeRedirection: ChallengeRedirection <- ChallengeError <- PrivateError <- ClientError <- Exception <- BaseException
ChallengeSelfieCaptcha: ChallengeSelfieCaptcha <- ChallengeError <- PrivateError <- ClientError <- Exception <- BaseException
ChallengeUnknownStep: ChallengeUnknownStep <- ChallengeError <- PrivateError <- ClientError <- Exception <- BaseException
AccountSuspended: AccountSuspended <- ClientError <- Exception <- BaseException <- object
TwoFactorRequired: TwoFactorRequired <- PrivateError <- ClientError <- Exception <- BaseException <- object
RateLimitError: RateLimitError <- PrivateError <- ClientError <- Exception <- BaseException <- object
PleaseWaitFewMinutes: PleaseWaitFewMinutes <- PrivateError <- ClientError <- Exception <- BaseException <- object
FeedbackRequired: FeedbackRequired <- PrivateError <- ClientError <- Exception <- BaseException <- object
SentryBlock: SentryBlock <- PrivateError <- ClientError <- Exception <- BaseException <- object
ProxyAddressIsBlocked: ProxyAddressIsBlocked <- PrivateError <- ClientError <- Exception <- BaseException <- object
BadPassword: BadPassword <- PrivateError <- ClientError <- Exception <- BaseException <- object
BadCredentials: BadCredentials <- PrivateError <- ClientError <- Exception <- BaseException <- object
ReloginAttemptExceeded: ReloginAttemptExceeded <- ClientError <- Exception <- BaseException <- object
UnknownError: UnknownError <- PrivateError <- ClientError <- Exception <- BaseException <- object
ClientNeedsUpgradeError: ClientNeedsUpgradeError <- UnknownError <- PrivateError <- ClientError <- Exception <- BaseException
PhotoNotUpload: PhotoNotUpload <- PrivateError <- ClientError <- Exception <- BaseException <- object
PhotoConfigureError: PhotoConfigureError <- PhotoNotUpload <- PrivateError <- ClientError <- Exception <- BaseException
PhotoConfigureStoryError: PhotoConfigureStoryError <- PhotoConfigureError <- PhotoNotUpload <- PrivateError <- ClientError <- Exception
VideoNotUpload: VideoNotUpload <- PrivateError <- ClientError <- Exception <- BaseException <- object
VideoConfigureError: VideoConfigureError <- VideoNotUpload <- PrivateError <- ClientError <- Exception <- BaseException
VideoConfigureStoryError: VideoConfigureStoryError <- VideoConfigureError <- VideoNotUpload <- PrivateError <- ClientError <- Exception
NoteNotFound: NoteNotFound <- NotFoundError <- PrivateError <- ClientError <- Exception <- BaseException
MediaNotFound: MediaNotFound <- NotFoundError <- MediaError <- PrivateError <- ClientError <- Exception
StoryNotFound: StoryNotFound <- NotFoundError <- MediaError <- PrivateError <- ClientError <- Exception
UserNotFound: UserNotFound <- NotFoundError <- UserError <- PrivateError <- ClientError <- Exception
ValidationError: ValidationError <- AssertionError <- Exception <- BaseException <- object
CaptchaChallengeRequired: CaptchaChallengeRequired <- ClientError <- Exception <- BaseException <- object
DirectMessageRequestsDisabled: DirectMessageRequestsDisabled <- DirectError <- PrivateError <- ClientError <- Exception <- BaseException

==============================================================================
7. 未登录状态下 get_settings() 的持久化字段（真实输出）
==============================================================================
  uuids: dict[7] -> phone_id, uuid, client_session_id, advertising_id, android_device_id, request_id, tray_session_id
  mid: NoneType = None
  ig_u_rur: NoneType = None
  ig_www_claim: NoneType = None
  authorization_data: dict[0] -> 
  cookies: dict[0] -> 
  last_login: NoneType = None
  device_settings: dict[11] -> android_version, android_release, dpi, resolution, manufacturer, device, model, cpu, app_version, version_code, bloks_versioning_id
  user_agent: str = 'Instagram 449.0.0.52.84 Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; 1079242191)'
  country: str = 'US'
  country_code: int = 1
  locale: str = 'en_US'
  timezone_offset: int = -14400
  timezone_name: str = 'GMT-04:00'
  push_disabled: bool = True
  request_timeout: int = 1
  public_request_retries_count: int = 3
  public_request_retries_timeout: int = 2
  session_retry_total: int = 3
  session_retry_backoff_factor: int = 2
  session_retry_statuses: list = [429, 500, 502, 503, 504]
  public_transport: str = 'requests'
  public_user_agent: str = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/11.1.2 Safari/605.1.15'
  public_graphql_user_agent: str = 'Instagram 273.0.0.16.70 (iPhone15,2; iOS 17_5_1; en_US; en-US; scale=3.00; 1290x2796; 470085518)'
  private_transport: str = 'curl'
  public_transport_impersonate: str = 'chrome136'
  tls_verify: bool = True

  user_id (未登录) = None
  sessionid 属性存在? True
  account_info 存在? True；get_current_user 存在? False

==============================================================================
8. 离线持久化往返（不联网：验证 set_settings 能否替代再次 login）
==============================================================================
  Client() 未登录: user_id=None  sessionid=None
  set_settings 之后: user_id=1234567890  sessionid='1234567890%3AAbCdEfGhIjKl%3A12x'
    private cookies      = {'sessionid': '1234567890%3AAbCdEfGhIjKl%3A12x', 'ds_user_id': '1234567890'}
    private.headers 有 Authorization? True
    c1.device            = {'android_version': 34, 'android_release': '14', 'manufacturer': 'Google', 'model': 'Pixel 8 Pro'}
  dump_settings -> C:\Users\Ez4p1\AppData\Local\Temp\dsh-3N178a\ig_probe_settings.json（27 个键，cookies 键 = ['sessionid', 'ds_user_id']）
  load_settings 到新 Client: user_id=1234567890  sessionid 一致? True
  Client(settings=dict) 直传: user_id=1234567890  sessionid 一致? True

==============================================================================
9. 结论速览（由上面真实输出推导）
==============================================================================
- Client.__init__ 只认 settings/proxy/delay_range/logger/override_app_version，
  其余 kwarg 会一路透传到 LoginMixin.__init__(self) 而抛 TypeError（见第 2 节探测）。
- Note 的创建方法是 create_note / create_music_note；没有 note_create。
- Story 上传用 photo_upload_to_story(path, caption, ...)，内部再做 photo_configure_to_story。
- 会话持久化靠 get_settings()/set_settings() 这一对；cookies + authorization_data 是核心。

```

---

## 附录 B：证据清单（文件 + 行号）

站点包根：`D:\Space\Workspace\deepseek-instagram\.venv-api\Lib\site-packages\instagrapi\`

| 证据 | 路径:行号 | 用来支撑 |
| --- | --- | --- |
| `Client.__init__` 与 kwargs 白名单 | `instagrapi\__init__.py:114-150` | 第 1 节 |
| `LoginMixin.__init__(self)` 无参 | `instagrapi\mixins\auth.py:457` | `Client(device=...)` TypeError |
| public transport 默认 | `instagrapi\mixins\public.py:54-55` | 第 1 节 transport 表 |
| private transport 默认 | `instagrapi\mixins\private.py:155` | 同上 |
| `login_by_sessionid` | `instagrapi\mixins\auth.py:701-738` | 第 2 节逐行 |
| `login` 开头 BadCredentials | `instagrapi\mixins\auth.py:748, 785-786` | 第 2/3 节 |
| `get_settings` / `set_settings` | `instagrapi\mixins\auth.py:1075 / 1136` | 第 3 节 |
| `load_settings` / `dump_settings` | `instagrapi\mixins\auth.py:1148 / 1172` | 第 3 节 |
| `init()` 恢复逻辑 | `instagrapi\mixins\auth.py:617-660` | 第 3 节 |
| `set_device` | `instagrapi\mixins\auth.py:1256-1290` | 设备指纹坑 |
| `user_id` / `sessionid` property | `instagrapi\mixins\auth.py:1039-1043 / 1059-1065` | 第 3.2 节 |
| `Authorization` 头生成 | `instagrapi\mixins\auth.py:1586-1593` | 第 3.2 节 |
| `logout` | `instagrapi\mixins\auth.py:1558-1570` | 禁用 logout |
| `photo_upload_to_story` | `instagrapi\mixins\photo.py:555-642` | 第 4 节 |
| `photo_rupload`（校验/size/PhotoNotUpload） | `instagrapi\mixins\photo.py:150-260` | 第 4.2 / 4.4 节 |
| `photo_configure_to_story`（caption 进 data） | `instagrapi\mixins\photo.py:728-1002` | 第 4.2 节 |
| Story 后续轮询 | `instagrapi\mixins\media.py:289-330` | 坑 5 |
| 图片预处理（JPEG/裁切/fit 黑底） | `instagrapi\mixins\image_util.py:101-160` | 坑 3/6 |
| `video_upload_to_story` | `instagrapi\mixins\video.py:639` | 第 4.1 节 |
| `NoteAudience` | `instagrapi\mixins\note.py:16-18` | 第 5.1 节 |
| `create_note` | `instagrapi\mixins\note.py:238-263` | 第 5.2 节 |
| `create_music_note` | `instagrapi\mixins\note.py:265` | 第 5.4 节 |
| `media_note_create` / `media_note_delete` | `instagrapi\mixins\media.py:914 / 965` | 第 5.4 节 |
| 异常定义 | `instagrapi\exceptions.py` | 第 6 节 |
| 异常映射（HTTP → 异常） | `instagrapi\mixins\private.py:551-667` | 第 6 节"触发条件"列 |
| `user_stories` | `instagrapi\mixins\story.py:212` | 第 4.4 节 |
| 设备/App 版本常量 | `instagrapi\config.py:15, 25-26` | 第 1 节 |

工具链证据：

- `scripts\probe_instagrapi.py` —— 本文所有签名、`model_fields`、异常 MRO、settings 键、离线持久化往返，都由它产出（不联网、不登录）。
- `docs\research\probe-output.txt` —— 上面脚本的完整 stdout（235 行），即附录 A。
- venv：`.venv-api`（Python 3.12.3），`pip show instagrapi` → `Version: 3.2.0`。

## 附录 C：怎么复现

```powershell
cd D:\Space\Workspace\deepseek-instagram
.venv-api\Scripts\python.exe .\scripts\probe_instagrapi.py | Out-File -Encoding utf8 docs\research\probe-output.txt
```

脚本自检要点（离线）：

1. `instagrapi.__version__ == "3.2.0"`，且 dist 路径在本仓库 `.venv-api` 下；
2. `Client.__init__` 签名里出现 `**kwargs`；`Client(device={})` 抛 `TypeError`；
3. `dir(Client)` 里 `create_note` 在、`note_create` 不在；`get_current_user` 不在；
4. `NoteAudience.MUTUAL_FOLLOWERS == 0`、`CLOSE_FRIENDS == 1`；
5. `set_settings()` 假 settings 后 `user_id` / `sessionid` / `Authorization` 头都能立刻取到，且 `dump_settings` → `load_settings` 往返一致（证明"不必再 login"）。
