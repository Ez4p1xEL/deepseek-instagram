#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Render a 1080x1920 Instagram Story card from a JSON spec (stdin).

Protocol:  echo '{"spec": {...}, "out": "C:/path/card.png"}' | python render_card.py
Success:   {"ok": true, "path": "...", "width": 1080, "height": 1920}
Failure:   {"ok": false, "error": "..."}

Only Pillow is required. Chinese text needs a CJK font; the list below covers a stock Windows.
"""
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",   # Microsoft YaHei Bold
    r"C:\Windows\Fonts\msyh.ttc",     # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",   # SimHei
    r"C:\Windows\Fonts\Deng.ttf",     # DengXian
    r"C:\Windows\Fonts\arialbd.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
]


def hex_rgb(value, fallback=(255, 255, 255)):
    text = str(value or "").strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) != 6:
        return fallback
    try:
        return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return fallback


def pick_font(size, bold=True):
    cache_key = (size, bold)
    if cache_key in _FONT_CACHE:
        return _FONT_CACHE[cache_key]
    order = FONT_CANDIDATES if bold else FONT_CANDIDATES[1:] + FONT_CANDIDATES[:1]
    for path in order:
        try:
            if os.path.exists(path):
                font = ImageFont.truetype(path, size)
                _FONT_CACHE[cache_key] = font
                return font
        except OSError:
            continue
    font = ImageFont.load_default()
    _FONT_CACHE[cache_key] = font
    return font


_FONT_CACHE = {}


def wrap(draw, text, font, max_width):
    """Greedy wrap that works for CJK (no spaces) and latin text."""
    text = str(text or "").strip()
    if not text:
        return []
    lines, current = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(current)
            current = ""
            continue
        probe = current + ch
        if draw.textlength(probe, font=font) <= max_width or not current:
            current = probe
        else:
            lines.append(current)
            current = ch
    lines.append(current)
    lines = [line for line in lines if line != ""] or [""]
    # 中文排版：标点不能出现在行首，把行首标点收回上一行（允许轻微超宽）。
    no_start = "，。、；：！？）》」』%…—·"
    units = "分时天条次秒个位万亿"
    changed = True
    while changed:
        changed = False
        for i in range(1, len(lines)):
            while lines[i] and lines[i][0] in no_start:
                lines[i - 1] += lines[i][0]
                lines[i] = lines[i][1:]
                changed = True
            # 数字和单位不要拆行（"6 分" 不能把「分」甩到下一行）
            while lines[i] and lines[i][0] in units and re.search(r"[0-9]\s*$", lines[i - 1]):
                lines[i - 1] += lines[i][0]
                lines[i] = lines[i][1:]
                changed = True
    return [line for line in lines if line != ""] or [""]


def gradient(draw, top, bottom):
    for y in range(H):
        t = y / (H - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (W, y)], fill=color)


def rounded(draw, box, radius, fill, outline=None, width=2):
    try:
        draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
    except AttributeError:  # Pillow < 8.2
        draw.rectangle(box, fill=fill, outline=outline)


def render(spec, out_path):
    theme = spec.get("theme") or {}
    bg1 = hex_rgb(theme.get("bg1"), (11, 16, 38))
    bg2 = hex_rgb(theme.get("bg2"), (34, 16, 70))
    accent = hex_rgb(theme.get("accent"), (255, 77, 141))
    accent2 = hex_rgb(theme.get("accent2"), (124, 92, 255))
    text_color = hex_rgb(theme.get("text"), (255, 255, 255))
    muted = hex_rgb(theme.get("muted"), (169, 166, 200))

    img = Image.new("RGB", (W, H), bg1)
    draw = ImageDraw.Draw(img, "RGBA")
    gradient(draw, bg1, bg2)

    # soft accent blobs for depth
    draw.ellipse([W - 420, -160, W + 200, 460], fill=(accent[0], accent[1], accent[2], 40))
    draw.ellipse([-260, H - 700, 420, H - 40], fill=(accent2[0], accent2[1], accent2[2], 46))

    x = 96
    width = W - 2 * x

    # ── header ────────────────────────────────────────────────────────────
    kicker_font = pick_font(38)
    kicker = str(spec.get("kicker") or "DSH DAILY")
    spaced = " ".join(kicker.upper())
    draw.text((x, 148), spaced, font=kicker_font, fill=accent)

    date_font = pick_font(34, bold=False)
    date_line = " · ".join([str(spec.get("date") or ""), str(spec.get("weekday") or "")]).strip(" ·")
    draw.text((x, 210), date_line, font=date_font, fill=muted)

    # ── headline ──────────────────────────────────────────────────────────
    y = 296
    headline_font = pick_font(84)
    for line in wrap(draw, spec.get("headline") or "", headline_font, width)[:3]:
        draw.text((x, y), line, font=headline_font, fill=text_color)
        y += 104
    y += 28

    # ── stat grid (2 x 2) ─────────────────────────────────────────────────
    stats = [s for s in (spec.get("stats") or []) if isinstance(s, dict)][:4]
    gap = 28
    card_w = (width - gap) // 2
    card_h = 236
    label_font = pick_font(32, bold=False)
    value_font = pick_font(66)
    for index, stat in enumerate(stats):
        col, row = index % 2, index // 2
        left = x + col * (card_w + gap)
        top = y + row * (card_h + gap)
        rounded(draw, [left, top, left + card_w, top + card_h], 34, (255, 255, 255, 20), (255, 255, 255, 26), 2)
        draw.text((left + 36, top + 40), str(stat.get("label") or ""), font=label_font, fill=muted)
        value = str(stat.get("value") or "")
        size = 66
        fitted = value_font
        while size > 34 and draw.textlength(value, font=fitted) > card_w - 64:
            size -= 4
            fitted = pick_font(size)
        draw.text((left + 36, top + 104), value, font=fitted, fill=text_color)
    y += ((len(stats) + 1) // 2) * (card_h + gap) + 28

    # ── peak hours chips ──────────────────────────────────────────────────
    peaks = [p for p in (spec.get("peaks") or []) if isinstance(p, dict)][:3]
    if peaks:
        chip_font = pick_font(32, bold=False)
        draw.text((x, y), "活跃时段", font=label_font, fill=muted)
        y += 56
        chip_x = x
        for peak in peaks:
            label = str(peak.get("label") or "")
            tw = draw.textlength(label, font=chip_font)
            chip_w = int(tw) + 56
            if chip_x + chip_w > x + width:
                chip_x = x
                y += 76
            rounded(draw, [chip_x, y, chip_x + chip_w, y + 60], 30, (accent[0], accent[1], accent[2], 210))
            draw.text((chip_x + 28, y + 12), label, font=chip_font, fill=(255, 255, 255))
            chip_x += chip_w + 18
        y += 96

    # ── life note ─────────────────────────────────────────────────────────
    life = str(spec.get("life") or "").strip()
    if life:
        life_font = pick_font(40, bold=False)
        lines = wrap(draw, life, life_font, width)[:3]
        box_top = H - 440 - len(lines) * 56
        rounded(draw, [x - 12, box_top - 28, x + width + 12, box_top + len(lines) * 56 + 12], 28, (255, 255, 255, 16))
        line_y = box_top
        for line in lines:
            draw.text((x, line_y), line, font=life_font, fill=(238, 236, 250))
            line_y += 56

    # ── footer ────────────────────────────────────────────────────────────
    footer_font = pick_font(32, bold=False)
    draw.text((x, H - 150), str(spec.get("footer") or ""), font=footer_font, fill=muted)
    draw.line([(x, H - 196), (x + 120, H - 196)], fill=accent, width=6)
    draw.text((x, H - 96), "deepseek-instagram · DSH 插件", font=footer_font, fill=(120, 118, 150))

    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    img.save(out_path, "PNG", optimize=True)
    return out_path


def render_text(spec, out_path):
    """Full-bleed text story: gradient + a few big lines + small footer.

    Instagram 私有 API 没有「文字 Story」接口，只能发图片；这里用纯色底 + 大字来模拟，
    视觉上与合作账号里的文字 Story 一致（README 里写明了这个限制）。
    """
    theme = spec.get("theme") or {}
    bg1 = hex_rgb(theme.get("bg1"), (11, 16, 38))
    bg2 = hex_rgb(theme.get("bg2"), (34, 16, 70))
    accent = hex_rgb(theme.get("accent"), (255, 77, 141))
    accent2 = hex_rgb(theme.get("accent2"), (124, 92, 255))
    text_color = hex_rgb(theme.get("text"), (255, 255, 255))
    muted = hex_rgb(theme.get("muted"), (169, 166, 200))

    img = Image.new("RGB", (W, H), bg1)
    draw = ImageDraw.Draw(img, "RGBA")
    gradient(draw, bg1, bg2)
    draw.ellipse([-260, -220, 520, 560], fill=(accent2[0], accent2[1], accent2[2], 42))
    draw.ellipse([W - 460, H - 640, W + 220, H + 80], fill=(accent[0], accent[1], accent[2], 34))

    x = 108
    width = W - 2 * x
    text = str(spec.get("text") or "").strip()

    kicker = str(spec.get("kicker") or "").strip()
    if kicker:
        draw.text((x, 200), " ".join(kicker.upper()), font=pick_font(34), fill=accent)

    # 自适应字号：优先 68px，行数超了就缩，最多 9 行。
    size = 68
    lines = [text]
    while size > 40:
        font = pick_font(size)
        lines = wrap(draw, text, font, width)
        if len(lines) <= 9:
            break
        size -= 4
    font = pick_font(size)
    line_h = int(size * 1.46)
    total = len(lines) * line_h
    y = int((H - total) / 2) + (24 if kicker else 0)
    # 长段落左对齐（整块水平居中），短句保持居中更像一张卡片。
    longest = max((draw.textlength(line, font=font) for line in lines), default=0)
    left = int((W - longest) / 2)
    for line in lines:
        lx = left if len(lines) > 2 else int((W - draw.textlength(line, font=font)) / 2)
        draw.text((lx, y), line, font=font, fill=text_color)
        y += line_h

    draw.line([(x, H - 286), (x + 120, H - 286)], fill=accent, width=6)
    footer_font = pick_font(30, bold=False)
    handle = str(spec.get("footer") or spec.get("handle") or "").strip()
    if handle:
        draw.text((x, H - 246), handle, font=footer_font, fill=muted)
    draw.text((x, H - 196), "deepseek-instagram · DSH 插件", font=footer_font, fill=(120, 118, 150))

    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    img.save(out_path, "PNG", optimize=True)
    return out_path


def emit(obj):
    # Windows console/stdin defaults to a legacy code page; always speak UTF-8 bytes instead.
    sys.stdout.buffer.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


def main():
    try:
        raw = sys.stdin.buffer.read().decode("utf-8", "replace") or "{}"
        payload = json.loads(raw)
    except ValueError as exc:
        emit({"ok": False, "error": f"bad json: {exc}"})
        return 1
    spec = payload.get("spec") or {}
    out = payload.get("out")
    if not out:
        emit({"ok": False, "error": "missing out path"})
        return 1
    try:
        if str(spec.get("mode") or "") == "text":
            render_text(spec, out)
        else:
            render(spec, out)
        emit({"ok": True, "path": out, "width": W, "height": H, "mode": spec.get("mode") or "card"})
        return 0
    except Exception as exc:  # noqa: BLE001 - report every failure as JSON
        emit({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
