#!/usr/bin/env python3
"""Render a 1200x630 text-on-brand cover PNG for a RailsDev blog post.

Usage: python3 scripts/make-cover.py '<title>' <out.png>
Layout: dark background (#090d16), title centered (wrapped), emerald→indigo
rule under it, 'railsdev.io' footer-left, 'RAILSDEV' footer-right.
Requires DejaVu Sans Bold (present on most Linux distros and on
ubuntu-latest GitHub runners) and Pillow.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (9, 13, 22)
EMERALD = (16, 185, 129)
INDIGO = (99, 102, 241)
WHITE = (255, 255, 255)
GREY = (156, 163, 175)
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def wrap(text, font, max_width):
    words = text.split()
    lines, line = [], ""
    for w in words:
        trial = f"{line} {w}".strip()
        if font.getlength(trial) <= max_width:
            line = trial
        else:
            if line:
                lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def main():
    title, out = sys.argv[1], sys.argv[2]
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    # gradient rule
    for x in range(W):
        t = x / (W - 1)
        c = tuple(int(EMERALD[i] + (INDIGO[i] - EMERALD[i]) * t) for i in range(3))
        draw.line([(x, 470), (x, 494)], fill=c)
    # title (shrink to fit up to 4 lines)
    size = 72
    while size >= 34:
        font = ImageFont.truetype(FONT_BOLD, size)
        lines = wrap(title, font, W - 160)
        total_h = sum(font.getbbox(l)[3] - font.getbbox(l)[1] + 12 for l in lines)
        if len(lines) <= 4 and total_h <= 380:
            break
        size -= 4
    y = (470 - total_h) // 2 + 10
    for l in lines:
        bbox = font.getbbox(l)
        lh = bbox[3] - bbox[1]
        w = font.getlength(l)
        draw.text(((W - w) / 2, y), l, font=font, fill=WHITE)
        y += lh + 12
    # footers
    f_small = ImageFont.truetype(FONT_BOLD, 26)
    f_tiny = ImageFont.truetype(FONT_REG, 18)
    draw.text((80, H - 82), "railsdev.io", font=f_small, fill=EMERALD)
    draw.text((W - 80, H - 78), "RAILSDEV", font=f_tiny, fill=GREY, anchor="ra")
    img.save(out)
    print("cover written:", out)


if __name__ == "__main__":
    main()
