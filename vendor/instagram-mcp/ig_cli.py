#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Instagram side-car for the deepseek-instagram DSH plugin.

One-shot CLI: read a JSON payload from stdin, print exactly one JSON object on stdout.

    echo '{"sessionid":"..."}' | python ig_cli.py login
    echo '{"image":"card.png","caption":"hi"}' | python ig_cli.py story
    echo '{"text":"..."}' | python ig_cli.py note
    echo '{}' | python ig_cli.py whoami
    echo '{}' | python ig_cli.py doctor

Why a CLI instead of a long-lived MCP server: the DSH host can call it with a hard
timeout, it never holds a socket open, and a crashed call cannot poison the next one.

Security: the session is stored under the plugin home directory only; never echoed back
in full, and the payload never contains the sessionid on the output side.
"""
import json
import os
import sys
import time
import traceback

HOME = os.environ.get("DSH_INSTAGRAM_HOME") or os.path.join(
    os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh"),
    "instagram-assistant",
)
SETTINGS_PATH = os.path.join(HOME, "session.json")
CRED_PATH = os.path.join(HOME, "credential.json")


def emit(obj):
    # Windows defaults to a legacy code page; the DSH host always speaks UTF-8.
    sys.stdout.buffer.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


def fail(code, message, extra=None):
    out = {"ok": False, "code": code, "error": str(message)}
    if extra:
        out.update(extra)
    emit(out)
    return 1


def ensure_home():
    os.makedirs(HOME, exist_ok=True)


def read_payload():
    try:
        raw = sys.stdin.buffer.read().decode("utf-8", "replace") or "{}"
        return json.loads(raw)
    except ValueError:
        return {}


def classify(exc):
    """Map instagrapi failures onto the codes the DSH plugin understands."""
    name = type(exc).__name__
    text = str(exc)
    lowered = text.lower()
    if "尚未登录" in text or "会话文件缺少" in text:
        return "not-logged-in", text
    if name in ("LoginRequired",):
        return "login-required", "登录已失效：请在设置页重新填 sessionid"
    if name in ("ChallengeRequired",):
        return "challenge", "Instagram 要求人机验证：请在手机 App 里处理后再试"
    if name in ("PleaseWaitFewMinutes", "RateLimitError"):
        return "rate-limit", "请求太频繁被限流：等几分钟再试"
    if name in ("FeedbackRequired",):
        return "feedback", "Instagram 提示操作异常（feedback_required）：先停一天再试"
    if name in ("BadPassword",):
        return "bad-password", "凭证被拒绝（bad_password）"
    if "login_required" in lowered:
        return "login-required", "登录已失效：请在设置页重新填 sessionid"
    if "challenge_required" in lowered:
        return "challenge", "Instagram 要求人机验证：请在手机 App 里处理后再试"
    if "wait a few minutes" in lowered or "please_wait" in lowered:
        return "rate-limit", "请求太频繁被限流：等几分钟再试"
    return "error", f"{name}: {text}"


def build_client():
    """A client that reuses the saved device/session; no navigation, no login request."""
    from instagrapi import Client

    client = Client()
    client.request_timeout = 45
    client.delay_range = [1, 3]
    if os.path.exists(SETTINGS_PATH):
        client.load_settings(SETTINGS_PATH)
    return client


def logged_client():
    if not os.path.exists(SETTINGS_PATH):
        raise RuntimeError("尚未登录：请先在设置页用 sessionid 登录")
    client = build_client()
    if not client.user_id:
        raise RuntimeError("会话文件缺少 user_id：请重新登录")
    return client


def current_sessionid():
    """Return the stored sessionid (needed to refresh it when Instagram rotates it)."""
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        auth = data.get("authorization_data") or {}
        return auth.get("sessionid")
    except (OSError, ValueError):
        return None


# ── commands ────────────────────────────────────────────────────────────────


def cmd_doctor(_payload):
    out = {"ok": True, "python": sys.version.split()[0], "home": HOME}
    try:
        import instagrapi

        out["instagrapi"] = getattr(instagrapi, "__version__", "?")
        names = dir(instagrapi.Client)
        out["note_methods"] = sorted(n for n in names if "note" in n.lower())
        out["story_methods"] = sorted(n for n in names if "story" in n.lower())
    except Exception as exc:  # noqa: BLE001
        out["instagrapi"] = None
        out["instagrapi_error"] = f"{type(exc).__name__}: {exc}"
    try:
        import PIL

        out["pillow"] = getattr(PIL, "__version__", "?")
    except Exception as exc:  # noqa: BLE001
        out["pillow"] = None
        out["pillow_error"] = f"{type(exc).__name__}: {exc}"
    out["logged_in"] = os.path.exists(SETTINGS_PATH)
    emit(out)
    return 0


def cmd_login(payload):
    sessionid = str(payload.get("sessionid") or "").strip()
    if not sessionid:
        return fail("bad-input", "缺少 sessionid")
    from instagrapi import Client

    ensure_home()
    client = Client()
    client.request_timeout = 45
    if os.path.exists(SETTINGS_PATH):
        client.load_settings(SETTINGS_PATH)  # keep the same device identity across logins
    client.login_by_sessionid(sessionid)
    client.dump_settings(SETTINGS_PATH)

    account = {}
    try:
        info = client.account_info()
        account = {"username": info.username, "pk": str(info.pk), "fullName": info.full_name}
    except Exception:  # noqa: BLE001 - account_info is a nicety, not the login proof
        account = {"username": client.username, "pk": str(client.user_id or "")}

    with open(CRED_PATH, "w", encoding="utf-8") as handle:
        json.dump({"sessionid": sessionid, "savedAt": int(time.time() * 1000)}, handle)
        try:
            os.chmod(CRED_PATH, 0o600)
        except OSError:
            pass
    emit({"ok": True, "account": account, "settingsPath": SETTINGS_PATH})
    return 0


def cmd_whoami(_payload):
    if not os.path.exists(SETTINGS_PATH):
        emit({"ok": False, "code": "not-logged-in", "error": "尚未登录"})
        return 1
    client = build_client()
    try:
        info = client.account_info()
        emit({"ok": True, "account": {"username": info.username, "pk": str(info.pk), "fullName": info.full_name}})
        return 0
    except Exception as exc:  # noqa: BLE001
        code, message = classify(exc)
        emit({"ok": False, "code": code, "error": message, "username": getattr(client, "username", None)})
        return 1


def cmd_story(payload):
    image = str(payload.get("image") or "").strip()
    caption = str(payload.get("caption") or "")
    mention_handle = str(payload.get("mentionHandle") or "").strip().lstrip("@")
    if not image or not os.path.exists(image):
        return fail("bad-input", f"找不到图片：{image}")
    client = logged_client()
    from pathlib import Path

    if mention_handle and f"@{mention_handle}".lower() not in caption.lower():
        caption = f"{caption} @{mention_handle}".strip()

    # 主人必须被 @ 到：贴纸（可点进主页）+ 文案里的 @ 文本，两处都放。
    mentions = []
    owner_pk = str(payload.get("ownerPk") or "").strip()
    if not owner_pk and mention_handle and payload.get("mentionSticker", True):
        # 设置页可能还没绑定 pk：发之前用用户名换一次，保证贴纸真的贴上
        try:
            owner_pk = str(client.user_id_from_username(mention_handle) or "")
        except Exception:  # noqa: BLE001 - 换不到就只保留文案里的 @
            owner_pk = ""
    if owner_pk and payload.get("mentionSticker", True):
        from instagrapi.types import StoryMention, UserShort

        mentions.append(StoryMention(
            user=UserShort(pk=int(owner_pk)),
            x=float(payload.get("mentionX", 0.5)),
            y=float(payload.get("mentionY", 0.86)),
            width=float(payload.get("mentionWidth", 0.5)),
            height=float(payload.get("mentionHeight", 0.09)),
        ))

    story = client.photo_upload_to_story(Path(image), caption, mentions=mentions)
    emit({
        "ok": True,
        "kind": "story",
        "mediaId": str(getattr(story, "id", "") or ""),
        "mediaPk": str(getattr(story, "pk", "") or ""),
        "takenAt": str(getattr(story, "taken_at", "") or ""),
        "mentioned": mention_handle or "",
        "mentionSticker": bool(mentions),
    })
    return 0


def cmd_note(payload):
    text = str(payload.get("text") or "").strip()
    if not text:
        return fail("bad-input", "Note 文本为空")
    if len(text) > 60:
        return fail("bad-input", f"Note 超过 60 字符（{len(text)}）")
    from instagrapi.mixins.note import NoteAudience

    audience = NoteAudience.CLOSE_FRIENDS if payload.get("closeFriends") else NoteAudience.MUTUAL_FOLLOWERS
    client = logged_client()
    note = client.create_note(text, audience=audience)
    emit({"ok": True, "kind": "note", "noteId": str(getattr(note, "id", "") or ""), "text": text})
    return 0


def cmd_delete_story(payload):
    media_id = str(payload.get("mediaId") or "").strip()
    if not media_id:
        return fail("bad-input", "缺少 mediaId")
    client = logged_client()
    ok = client.story_delete(media_id)
    emit({"ok": bool(ok), "kind": "story", "mediaId": media_id})
    return 0


def cmd_stories(_payload):
    """List the account's currently active stories (used to verify a publish)."""
    client = logged_client()
    items = client.user_stories(client.user_id) or []
    rows = []
    for item in items[:12]:
        taken = getattr(item, "taken_at", 0)
        if hasattr(taken, "timestamp"):
            taken = int(taken.timestamp())
        rows.append({
            "id": str(getattr(item, "id", "") or ""),
            "pk": str(getattr(item, "pk", "") or ""),
            "takenAt": int(taken or 0),
        })
    emit({"ok": True, "kind": "stories", "count": len(items), "items": rows})
    return 0


def cmd_uid(payload):
    """Resolve a username to its numeric user id (used to bind the owner account)."""
    username = str(payload.get("username") or "").strip().lstrip("@")
    if not username:
        return fail("bad-input", "缺少 username")
    client = logged_client()
    uid = client.user_id_from_username(username)
    emit({"ok": True, "username": username, "pk": str(uid)})
    return 0


def _msg_row(msg, thread, is_group, title, names_by_pk=None):
    timestamp = getattr(msg, "timestamp", None)
    if hasattr(timestamp, "timestamp"):
        timestamp = int(timestamp.timestamp() * 1000)
    user = getattr(msg, "user", None)
    sender_pk = str(getattr(msg, "user_id", "") or "")
    username = str(getattr(user, "username", "") or "") or (names_by_pk or {}).get(sender_pk, "")
    return {
        "id": str(getattr(msg, "id", "") or ""),
        "threadId": str(getattr(thread, "id", "") or ""),
        "threadTitle": title,
        "isGroup": bool(is_group),
        "userId": sender_pk,
        "username": username,
        "itemType": str(getattr(msg, "item_type", "") or "text"),
        "text": str(getattr(msg, "text", None) or ""),
        "timestamp": int(timestamp or 0),
    }


def cmd_dm_poll(payload):
    """Read recent direct messages (1:1 + group); the Host decides who may command / reply."""
    owner_pk = str(payload.get("ownerPk") or "").strip()
    include_all = bool(payload.get("includeAll"))
    limit = max(1, min(30, int(payload.get("limit") or 15)))
    per_thread = max(1, min(30, int(payload.get("perThread") or 10)))
    client = logged_client()
    threads = client.direct_threads(amount=limit, thread_message_limit=per_thread) or []
    rows = []
    messages = []
    for thread in threads:
        users = [str(getattr(user, "pk", "") or "") for user in (getattr(thread, "users", None) or [])]
        names = [str(getattr(user, "username", "") or "") for user in (getattr(thread, "users", None) or [])]
        title = str(getattr(thread, "thread_title", "") or "")
        is_group = bool(getattr(thread, "is_group", False)) or len(users) > 2
        if not include_all and owner_pk and owner_pk not in users:
            continue
        last_activity = getattr(thread, "last_activity_at", None)
        if hasattr(last_activity, "timestamp"):
            last_activity = int(last_activity.timestamp() * 1000)
        rows.append({
            "id": str(getattr(thread, "id", "") or ""),
            "isGroup": is_group,
            "title": title,
            "memberPks": users,
            "memberUsernames": names,
            "lastActivityAt": int(last_activity or 0),
        })
        names_by_pk = {str(getattr(user, "pk", "") or ""): str(getattr(user, "username", "") or "")
                       for user in (getattr(thread, "users", None) or [])}
        for msg in (getattr(thread, "messages", None) or []):
            row = _msg_row(msg, thread, is_group, title, names_by_pk)
            if not row["text"].strip():
                continue
            messages.append(row)
    messages.sort(key=lambda item: item["timestamp"])
    emit({
        "ok": True,
        "kind": "dm-poll",
        "threads": len(rows),
        "threadRows": rows,
        "messages": messages[-max(limit * 3, 40):],
    })
    return 0


def cmd_dm_threads(payload):
    """List threads with metadata; the settings page uses this to show groups."""
    include_all = bool(payload.get("includeAll"))
    owner_pk = str(payload.get("ownerPk") or "").strip()
    limit = max(1, min(40, int(payload.get("limit") or 20)))
    client = logged_client()
    threads = client.direct_threads(amount=limit) or []
    rows = []
    for thread in threads:
        users = [str(getattr(user, "pk", "") or "") for user in (getattr(thread, "users", None) or [])]
        names = [str(getattr(user, "username", "") or "") for user in (getattr(thread, "users", None) or [])]
        is_group = bool(getattr(thread, "is_group", False)) or len(users) > 2
        if not include_all and owner_pk and owner_pk not in users:
            continue
        rows.append({
            "id": str(getattr(thread, "id", "") or ""),
            "isGroup": is_group,
            "title": str(getattr(thread, "thread_title", "") or ""),
            "memberUsernames": names,
            "ownerInside": owner_pk in users if owner_pk else None,
        })
    emit({"ok": True, "kind": "dm-threads", "threads": len(rows), "items": rows})
    return 0


def cmd_dm_send(payload):
    text = str(payload.get("text") or "").strip()
    thread_id = str(payload.get("threadId") or "").strip()
    user_id = str(payload.get("userId") or "").strip()
    if not text:
        return fail("bad-input", "回复内容为空")
    client = logged_client()
    if thread_id:
        message = client.direct_answer(int(thread_id), text)
    elif user_id:
        message = client.direct_send(text, user_ids=[int(user_id)])
    else:
        return fail("bad-input", "需要 threadId 或 userId")
    emit({"ok": True, "kind": "dm-send", "messageId": str(getattr(message, "id", "") or "")})
    return 0


def cmd_friendship(payload):
    """Relation between the logged-in account and one user (drives auto-reply modes)."""
    user_id = str(payload.get("userId") or "").strip()
    if not user_id:
        return fail("bad-input", "缺少 userId")
    client = logged_client()
    relation = client.user_friendship_v1(int(user_id))
    emit({
        "ok": True,
        "kind": "friendship",
        "userId": user_id,
        "following": bool(getattr(relation, "following", False)),
        "followedBy": bool(getattr(relation, "followed_by", False)),
        "isPrivate": bool(getattr(relation, "is_private", False)),
    })
    return 0


COMMANDS = {
    "doctor": cmd_doctor,
    "login": cmd_login,
    "whoami": cmd_whoami,
    "story": cmd_story,
    "note": cmd_note,
    "delete-story": cmd_delete_story,
    "stories": cmd_stories,
    "uid": cmd_uid,
    "dm-poll": cmd_dm_poll,
    "dm-threads": cmd_dm_threads,
    "dm-send": cmd_dm_send,
    "friendship": cmd_friendship,
}


def main():
    command = (sys.argv[1] if len(sys.argv) > 1 else "doctor").strip()
    handler = COMMANDS.get(command)
    if handler is None:
        return fail("bad-command", f"未知命令：{command}")
    payload = read_payload()
    try:
        return handler(payload)
    except Exception as exc:  # noqa: BLE001 - everything becomes one JSON answer
        code, message = classify(exc)
        # 调用方（DSH 工具/设置页）只需要一句人话；堆栈只在调试时输出，
        # 否则会把本机路径和内部结构带进模型上下文。
        extra = {"traceback": traceback.format_exc(limit=6)} if os.environ.get("DSH_IG_DEBUG") == "1" else None
        return fail(code, message, extra)


if __name__ == "__main__":
    sys.exit(main())
