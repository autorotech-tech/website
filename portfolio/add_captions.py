#!/usr/bin/env python3
"""Add English caption bars to portfolio screenshots."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
ASSETS = Path("/Users/vlad_x/.cursor/projects/Users-vlad-x-Desktop-n8n-autoro-tech-website/assets")
OUT_RU = ROOT / "screenshots"
OUT_EN = ROOT / "screenshots-en"
DATA = json.loads((ROOT / "projects.json").read_text(encoding="utf-8"))


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ):
        p = Path(path)
        if p.exists():
            return ImageFont.truetype(str(p), size=size)
    return ImageFont.load_default()


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [text]


def add_caption(
    src: Path,
    dst: Path,
    *,
    title: str,
    subtitle: str,
    badge: str,
    lang: str,
) -> None:
    img = Image.open(src).convert("RGB")
    w, h = img.size
    bar_h = 130 if lang == "en" else 120
    canvas = Image.new("RGB", (w, h + bar_h), "#111111")
    canvas.paste(img, (0, 0))

    draw = ImageDraw.Draw(canvas)
    title_font = load_font(28)
    sub_font = load_font(18)
    badge_font = load_font(14)

    y = h + 16
    draw.text((24, y), title, fill="#ffffff", font=title_font)
    draw.text((24, y + 36), "AUTORO SWOOP", fill="#a78bfa", font=badge_font)

    badge_w = draw.textlength(badge, font=badge_font) + 20
    draw.rounded_rectangle((w - badge_w - 24, y, w - 24, y + 28), radius=6, fill="#7c3aed")
    draw.text((w - badge_w - 14, y + 6), badge, fill="#ffffff", font=badge_font)

    lines = wrap_text(draw, subtitle, sub_font, w - 48)
    ty = y + 58
    for line in lines[:2]:
        draw.text((24, ty), line, fill="#d1d5db", font=sub_font)
        ty += 24

    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dst, format="PNG", optimize=True)
    print(f"saved {dst.name}")


def main() -> None:
    for folder in (OUT_RU, OUT_EN):
        folder.mkdir(parents=True, exist_ok=True)

    for item in DATA:
        src = ASSETS / item["image"]
        if not src.exists():
            print(f"skip missing {src}")
            continue

        add_caption(
            src,
            OUT_RU / item["image"],
            title=item["title_ru"],
            subtitle=item["caption_ru"],
            badge=item["status"],
            lang="ru",
        )
        add_caption(
            src,
            OUT_EN / item["image"],
            title=item["title_en"],
            subtitle=item["caption_en"],
            badge=item["status"],
            lang="en",
        )


if __name__ == "__main__":
    main()
