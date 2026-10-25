"""instagrapi 3.2.0 离线自检：打印真实签名 / note 方法 / 异常继承 / 持久化字段。

约束：**不联网、不登录**。只做 import + inspect + 构造一个空 Client。
用法：
    .venv-api\\Scripts\\python.exe scripts\\probe_instagrapi.py
"""

import inspect
import sys
from pathlib import Path

# Windows 控制台默认不是 UTF-8，中文会乱码
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import instagrapi  # noqa: E402
from instagrapi import Client  # noqa: E402
from instagrapi import exceptions as ig_exc  # noqa: E402

METHODS = [
    "login_by_sessionid",
    "login",
    "get_settings",
    "set_settings",
    "load_settings",
    "dump_settings",
    "set_device",
    "photo_upload_to_story",
    "video_upload_to_story",
    "get_timeline_feed",
    "user_info",
    "account_info",
    "get_current_user",
    "logout",
]


def hr(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def signature_of(name: str) -> None:
    obj = getattr(Client, name, None)
    if obj is None:
        print(f"[MISSING] Client.{name}  <-- 该方法不存在")
        return
    try:
        sig = inspect.signature(obj)
    except (TypeError, ValueError) as exc:  # pragma: no cover
        print(f"[UNINSPECTABLE] Client.{name}: {exc}")
        return
    print(f'def {name}{sig}')
    src = inspect.getsourcefile(obj)
    if src:
        print(f"    # source: {src}")


def main() -> None:
    hr("1. 版本与环境")
    print(f"instagrapi.__version__ = {instagrapi.__version__}")
    print(f"instagrapi.__file__    = {instagrapi.__file__}")
    print(f"python                 = {sys.version.split()[0]}")
    try:
        from importlib.metadata import distribution

        dist = distribution("instagrapi")
        print(f"dist version           = {dist.version}")
        print(f"dist location          = {dist.locate_file('')}")
    except Exception as exc:  # pragma: no cover
        print(f"(dist 信息读取失败: {exc})")

    hr("2. Client 构造函数与 transport 默认值")
    print(f"class Client.__init__{inspect.signature(Client.__init__)}")
    print(f"Client() 可调用签名: {inspect.signature(Client)}")
    print(f"Client.public_transport  (类默认) = {Client.public_transport!r}")
    print(f"Client.private_transport (类默认) = {Client.private_transport!r}")
    print(f"Client.public_transport_impersonate = {Client.public_transport_impersonate!r}")
    print("\n关键 kwargs 探测（只构造对象，不联网）:")
    for kwargs in ({"device": {}}, {"user_agent": "x"}, {"settings": {}}, {"private_transport": "requests"}):
        try:
            c = Client(**kwargs)
            print(f"  Client(**{kwargs!r}) -> OK ({type(c).__name__})")
        except Exception as exc:  # noqa: BLE001
            print(f"  Client(**{kwargs!r}) -> {type(exc).__name__}: {exc}")

    hr("3. 指定方法的完整签名（inspect 原始输出）")
    for name in METHODS:
        signature_of(name)

    hr("4. note 相关方法（note_create 存在吗？）")
    note_attrs = sorted(
        n for n in dir(Client) if "note" in n.lower() and callable(getattr(Client, n, None))
    )
    print(f"note_create 是否存在: {hasattr(Client, 'note_create')}")
    print(f"含 'note' 的可调用成员共 {len(note_attrs)} 个:")
    for name in note_attrs:
        try:
            print(f"  def {name}{inspect.signature(getattr(Client, name))}")
        except (TypeError, ValueError):
            print(f"  def {name}(...)")

    hr("5. NoteAudience / 返回类型字段")
    try:
        from instagrapi.mixins.note import NoteAudience

        print(f"from instagrapi.mixins.note import NoteAudience -> {NoteAudience}")
        print(f"  members = {[(m.name, int(m)) for m in NoteAudience]}")
        print(f"  instagrapi.NoteAudience 顶层导出? {hasattr(instagrapi, 'NoteAudience')}")
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] 导入 NoteAudience 失败: {exc}")

    for type_name in ("Note", "Story", "Account"):
        t = getattr(instagrapi.types, type_name, None)
        if t is None:
            print(f"{type_name}: MISSING")
            continue
        fields = getattr(t, "model_fields", {})
        print(f"\n{type_name}.model_fields ({len(fields)}):")
        for fname, finfo in fields.items():
            ann = getattr(finfo.annotation, "__name__", str(finfo.annotation))
            print(f"  - {fname}: {ann} = {finfo.default!r}")

    hr("6. 异常类清单与继承关系")
    exc_names = [
        "ClientError",
        "ClientUnknownError",
        "ClientLoginRequired",
        "ClientConnectionError",
        "ClientBadRequestError",
        "ClientUnauthorizedError",
        "ClientForbiddenError",
        "ClientNotFoundError",
        "ClientThrottledError",
        "ClientRequestTimeout",
        "ClientJSONDecodeError",
        "ClientGraphqlError",
        "PrivateError",
        "LoginRequired",
        "ChallengeError",
        "ChallengeRequired",
        "ChallengeRedirection",
        "ChallengeSelfieCaptcha",
        "ChallengeUnknownStep",
        "AccountSuspended",
        "TwoFactorRequired",
        "RateLimitError",
        "PleaseWaitFewMinutes",
        "FeedbackRequired",
        "SentryBlock",
        "ProxyAddressIsBlocked",
        "BadPassword",
        "BadCredentials",
        "ReloginAttemptExceeded",
        "UnknownError",
        "ClientNeedsUpgradeError",
        "PhotoNotUpload",
        "PhotoConfigureError",
        "PhotoConfigureStoryError",
        "VideoNotUpload",
        "VideoConfigureError",
        "VideoConfigureStoryError",
        "NoteNotFound",
        "MediaNotFound",
        "StoryNotFound",
        "UserNotFound",
        "ValidationError",
        "CaptchaChallengeRequired",
        "DirectMessageRequestsDisabled",
    ]
    for name in exc_names:
        cls = getattr(ig_exc, name, None)
        if cls is None:
            print(f"{name}: MISSING")
            continue
        mro = " <- ".join(c.__name__ for c in cls.__mro__[:6])
        print(f"{name}: {mro}")

    hr("7. 未登录状态下 get_settings() 的持久化字段（真实输出）")
    client = Client()
    settings = client.get_settings()
    for key, value in settings.items():
        if isinstance(value, dict):
            inner = ", ".join(list(value)[:12])
            print(f"  {key}: dict[{len(value)}] -> {inner}")
        else:
            print(f"  {key}: {type(value).__name__} = {value!r}")
    print(f"\n  user_id (未登录) = {client.user_id!r}")
    print(f"  sessionid 属性存在? {hasattr(client, 'sessionid')}")
    print(f"  account_info 存在? {hasattr(client, 'account_info')}；get_current_user 存在? "
          f"{hasattr(client, 'get_current_user')}")

    hr("8. 离线持久化往返（不联网：验证 set_settings 能否替代再次 login）")
    import json as _json
    import tempfile

    fake_sid = "1234567890%3AAbCdEfGhIjKl%3A12x"
    seed_settings = {
        "cookies": {"sessionid": fake_sid, "ds_user_id": "1234567890"},
        "authorization_data": {
            "ds_user_id": "1234567890",
            "sessionid": fake_sid,
            "should_use_header_over_cookies": True,
        },
        "uuids": {"uuid": "0f0e0d0c-0b0a-4908-8706-050403020100"},
        "device_settings": {
            "manufacturer": "Google",
            "model": "Pixel 8 Pro",
            "android_version": 34,
            "android_release": "14",
        },
        "mid": "ZXhhbXBsZW1pZA==",
    }
    c1 = Client()
    print(f"  Client() 未登录: user_id={c1.user_id!r}  sessionid={c1.sessionid!r}")
    c1.set_settings(seed_settings)
    print(f"  set_settings 之后: user_id={c1.user_id!r}  sessionid={c1.sessionid!r}")
    print(f"    private cookies      = {c1.cookie_dict}")
    print(f"    private.headers 有 Authorization? {'Authorization' in c1.private.headers}")
    print(f"    c1.device            = {c1.device}")

    tmp = Path(tempfile.gettempdir()) / "ig_probe_settings.json"
    c1.dump_settings(tmp)
    raw = _json.loads(tmp.read_text(encoding="utf-8"))
    print(f"  dump_settings -> {tmp}（{len(raw)} 个键，cookies 键 = {list(raw['cookies'])}）")

    c2 = Client()
    c2.load_settings(tmp)
    print(f"  load_settings 到新 Client: user_id={c2.user_id!r}  sessionid 一致? {c2.sessionid == fake_sid}")

    c3 = Client(_json.loads(tmp.read_text(encoding="utf-8")))
    print(f"  Client(settings=dict) 直传: user_id={c3.user_id!r}  sessionid 一致? {c3.sessionid == fake_sid}")
    tmp.unlink(missing_ok=True)

    hr("9. 结论速览（由上面真实输出推导）")
    print("- Client.__init__ 只认 settings/proxy/delay_range/logger/override_app_version，")
    print("  其余 kwarg 会一路透传到 LoginMixin.__init__(self) 而抛 TypeError（见第 2 节探测）。")
    print("- Note 的创建方法是 create_note / create_music_note；没有 note_create。")
    print("- Story 上传用 photo_upload_to_story(path, caption, ...)，内部再做 photo_configure_to_story。")
    print("- 会话持久化靠 get_settings()/set_settings() 这一对；cookies + authorization_data 是核心。")


if __name__ == "__main__":
    main()
