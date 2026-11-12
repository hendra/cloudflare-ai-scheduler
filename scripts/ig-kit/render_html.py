"""Render a self-contained HTML file to an image with headless Chrome.

Usage: python3 render_html.py page.html out.jpg 1080x1350 [--png]

- The HTML must be fully self-contained (inline CSS; images as data: URIs).
  Google Fonts are NOT reachable from the workspace: use locally installed
  fonts only — "Inter", "Inter Display", "DejaVu Sans".
- Output is JPEG (quality 90) unless --png is given (use PNG for video frames).
"""
import pathlib, sys
from playwright.sync_api import sync_playwright
from PIL import Image

src, out, size = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
as_png = "--png" in sys.argv
w, h = map(int, size.lower().split("x"))
html = pathlib.Path(src).read_text()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg = b.new_page(viewport={"width": w, "height": h})
    pg.set_content(html)
    pg.wait_for_timeout(300)
    tmp = out.with_suffix(".render.png")
    pg.screenshot(path=str(tmp), clip={"x": 0, "y": 0, "width": w, "height": h})
    b.close()

if as_png:
    tmp.replace(out.with_suffix(".png"))
    print("saved", out.with_suffix(".png"))
else:
    Image.open(tmp).convert("RGB").save(out, "JPEG", quality=90, optimize=True)
    tmp.unlink()
    print("saved", out)
