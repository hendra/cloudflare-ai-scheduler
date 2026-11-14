"""Deterministic frame capture: seek every CSS animation to an exact frame time and
screenshot it. No real-time recording, so output is identical run to run."""
import os
import pathlib

from playwright.sync_api import sync_playwright

from .scenes import SAFE
from .timeline import FPS

CHROME = "/usr/bin/google-chrome"

_SETUP_JS = """async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
  window.__anims = document.getAnimations();
  window.__anims.forEach(a => a.pause());
  return window.__anims.length;
}"""
_SEEK_JS = "t => { window.__anims.forEach(a => { a.currentTime = t; }); }"
_OVERFLOW_JS = """safe => [...document.querySelectorAll('.safe')].flatMap(el => {
  const r = el.getBoundingClientRect();
  const ok = r.left >= safe.left - 1 && r.right <= safe.right + 1 && r.top >= safe.top - 1 && r.bottom <= safe.bottom + 1;
  return ok ? [] : [`${el.className}: ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)} "${el.textContent.trim().slice(0, 40)}"`];
})"""
_HOOK_JS = """() => { const el = document.querySelector('.hook-text');
  return !!el && getComputedStyle(el).opacity === '1' && getComputedStyle(document.querySelector('.scene')).opacity === '1'; }"""


class Capturer:
    """One browser for the whole Reel; capture() per scene."""

    def __enter__(self):
        self._pw = sync_playwright().start()
        exe = CHROME if os.path.exists(CHROME) else None  # local dev: Playwright's bundled browser
        self._browser = self._pw.chromium.launch(executable_path=exe)
        self._page = self._browser.new_page(viewport={"width": 1080, "height": 1920})
        return self

    def __exit__(self, *exc):
        self._browser.close()
        self._pw.stop()

    def capture(self, html_path, n_frames, out_dir, start_index):
        """Writes out_dir/fNNNNN.jpg for frames start_index…start_index+n_frames-1.
        Returns {"frames", "overflow", "hook_visible_at_0"}."""
        page = self._page
        page.goto(pathlib.Path(html_path).resolve().as_uri(), wait_until="load")
        page.evaluate(_SETUP_JS)
        page.evaluate(_SEEK_JS, 0)
        hook_ok = page.evaluate(_HOOK_JS)
        for i in range(n_frames):
            page.evaluate(_SEEK_JS, i * 1000 / FPS)
            page.screenshot(path=str(pathlib.Path(out_dir) / f"f{start_index + i:05d}.jpg"), type="jpeg", quality=92)
        overflow = page.evaluate(_OVERFLOW_JS, SAFE)
        return {"frames": n_frames, "overflow": overflow, "hook_visible_at_0": hook_ok}
