"""Cinematic scene templates (1080×1920 HTML) for the Reel.

Each scene is a self-contained document whose motion is plain CSS animations with
explicit durations, so capture.py can seek every animation to an exact frame time.
All visible text sits in elements with class "safe", which must stay inside the
safe area (x 72–930, y 240–1480) — capture.py checks this.
"""
import html
import pathlib
import re

from .timeline import BEAT_S, SCENE_BEATS

FONTS = pathlib.Path(__file__).resolve().parent / "fonts"
YELLOW = "#FFD23F"
SAFE = {"left": 72, "right": 930, "top": 240, "bottom": 1480}

TIP_KICKERS = {"context": "MASALAHNYA", "twist": "TRIKNYA", "why": "CONTOH PROMPT", "payoff": "HASILNYA"}
KICKERS = {"context": "YANG DITEMUKAN", "twist": "TAPI TUNGGU…", "why": "KENAPA PENTING", "payoff": "INTINYA"}
# scene → (image key, Ken Burns keyframes from → to)
SHOTS = {
    "hook": (1, "scale(1.00)", "scale(1.08)"),
    "context": (2, "scale(1.14) translateX(-3%)", "scale(1.14) translateX(3%)"),
    "twist": (3, "scale(1.04)", "scale(1.18)"),
    "why": (4, "scale(1.14) translateX(3%)", "scale(1.14) translateX(-3%)"),
    "payoff": (4, "scale(1.10)", "scale(1.02)"),
    "cta": (1, "scale(1.15)", "scale(1.15)"),
}
WORD_STAGGER = BEAT_S / 8
REVEAL_START = BEAT_S / 2

DURATION = {k: b * BEAT_S for k, b in SCENE_BEATS}


def _esc(s):
    return html.escape(str(s or ""), quote=True)


def _base_css(kind, dur, meta):
    img_from, img_to = SHOTS[kind][1], SHOTS[kind][2]
    return f"""
@font-face {{ font-family: 'Anton'; src: url('{(FONTS / "Anton-Regular.ttf").as_uri()}'); }}
@font-face {{ font-family: 'Inter'; src: url('{(FONTS / "Inter.ttf").as_uri()}'); font-weight: 100 900; }}
:root {{ --fs: {meta.get("font_scale", 1.0)}; }}
html, body {{ margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #000; }}
.scene {{ position: relative; width: 1080px; height: 1920px; overflow: hidden; }}
.bg {{ position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
       animation: kb {dur:.3f}s linear both; }}
.shade {{ position: absolute; inset: 0; background: linear-gradient(180deg,
          rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 20%, rgba(0,0,0,0) 38%, rgba(0,0,0,.82) 66%, rgba(0,0,0,.94) 100%); }}
.track {{ position: absolute; top: 150px; left: 72px; right: 72px; height: 6px; border-radius: 3px;
          background: rgba(255,255,255,.22); overflow: hidden; }}
.fill {{ height: 100%; background: {YELLOW}; animation: prog {dur:.3f}s linear both; }}
.stack {{ position: absolute; left: {SAFE["left"]}px; width: {SAFE["right"] - SAFE["left"]}px;
          bottom: {1920 - SAFE["bottom"]}px; display: flex; flex-direction: column; gap: 28px; }}
.kicker {{ font: 700 30px/1 'Inter'; letter-spacing: 8px; color: {YELLOW}; text-transform: uppercase; }}
.src {{ font: 500 26px/1.3 'Inter'; color: #CFCFCF; }}
.handle {{ font: 700 30px/1 'Inter'; letter-spacing: 3px; color: {YELLOW}; }}
.w {{ display: inline-block; white-space: pre-wrap; max-width: 100%; overflow-wrap: anywhere;
      animation: word .25s ease-out both; }}
@keyframes kb {{ from {{ transform: {img_from}; }} to {{ transform: {img_to}; }} }}
@keyframes prog {{ from {{ width: {meta["progress_from"] * 100:.2f}%; }} to {{ width: {meta["progress_to"] * 100:.2f}%; }} }}
@keyframes word {{ from {{ opacity: 0; transform: translateY(18px); }} to {{ opacity: 1; transform: none; }} }}
@keyframes pop {{ 0% {{ transform: scale(0); }} 70% {{ transform: scale(1.12); }} 100% {{ transform: scale(1); }} }}
@keyframes sweep {{ from {{ transform: scaleX(0); }} to {{ transform: scaleX(1); }} }}
@keyframes ink {{ from {{ color: #FFFFFF; }} to {{ color: #111111; }} }}
@keyframes rise {{ from {{ opacity: 0; transform: translateY(30px); }} to {{ opacity: 1; transform: none; }} }}
"""


def _words(text, start, cls="w"):
    """Each word as a span with a staggered reveal; returns (html, next_start)."""
    out = []
    for tok in re.findall(r"\S+\s*", text):
        out.append(f'<span class="{cls}" style="animation-delay:{start:.3f}s">{_esc(tok)}</span>')
        start += WORD_STAGGER
    return "".join(out), start


def _beat_text(text, highlight, hl_at):
    if highlight and highlight in text:
        pre, post = text.split(highlight, 1)
        a, t = _words(pre, REVEAL_START)
        hl_at = max(hl_at, t + WORD_STAGGER)  # never sweep before the highlighted words appear
        hl_words = "".join(f"<span>{_esc(w)}</span>" for w in re.findall(r"\S+\s*", highlight))
        b = (f'<span class="hl" style="animation-delay:{t:.3f}s"><span class="hlbox" '
             f'style="animation-delay:{hl_at:.3f}s"></span><span class="hltext" '
             f'style="animation-delay:{hl_at:.3f}s">{hl_words}</span></span>')
        c, _ = _words(post, t + WORD_STAGGER)
        gap = " " if post[:1].isspace() else ""  # _words drops leading whitespace
        return a + b + gap + c
    return _words(text, REVEAL_START)[0]


def _highlight_hook(hook, phrases):
    """Wrap whole-word, case-insensitive matches of each phrase in <em>. Matching runs on the
    raw hook and the HTML is built once, so phrases can never hit tags or entities."""
    if isinstance(phrases, str):
        phrases = [phrases]
    spans = []
    for p in phrases if isinstance(phrases, list) else []:
        p = str(p).strip()
        m = re.search(r"(?<!\w)" + re.escape(p) + r"(?!\w)", hook, re.I) if p else None
        if m and not any(m.start() < e and s < m.end() for s, e in spans):
            spans.append((m.start(), m.end()))
    out, pos = [], 0
    for s, e in sorted(spans):
        out += [_esc(hook[pos:s]), "<em>", _esc(hook[s:e]), "</em>"]
        pos = e
    out.append(_esc(hook[pos:]))
    return "".join(out)


def scene_html(kind, story, images, meta):
    dur = DURATION[kind]
    img = images[SHOTS[kind][0]]
    css = _base_css(kind, dur, meta)
    src = f'<div class="src safe">{_esc(meta.get("source_label", "Sumber"))}: {_esc(meta["source"])} · {_esc(meta["date"])}</div>'
    beats = {b["role"]: b for b in story.get("beats") or [] if isinstance(b, dict)}
    img_style = ""

    if kind == "hook":
        hook = str(story.get("hook") or "")
        size = 140 if len(hook) <= 24 else 120 if len(hook) <= 36 else 100
        css += f"""
.hook-text {{ margin: 0; font: calc({size}px * var(--fs))/1.0 'Anton'; color: #FFFFFF; text-transform: uppercase;
              overflow-wrap: anywhere; text-shadow: 0 4px 30px rgba(0,0,0,.6); }}
.hook-text em {{ font-style: normal; color: {YELLOW}; }}
.kicker.top {{ position: absolute; top: 260px; left: 72px; }}"""
        body = (f'<div class="kicker top safe">{_esc(meta.get("hook_kicker", "FAKTA SAINS"))}</div>'
                f'<div class="stack"><h1 class="hook-text safe">{_highlight_hook(hook, story.get("hook_highlight"))}</h1>'
                f'<div class="handle safe">{_esc(meta["handle"])}</div></div>')

    elif kind in ("context", "twist", "why"):
        b = beats.get(kind, {})
        css += f"""
.beat {{ margin: 0; font: 800 calc(62px * var(--fs))/1.22 'Inter'; color: #FFFFFF; text-shadow: 0 3px 24px rgba(0,0,0,.55); }}
.hl {{ position: relative; display: inline-block; white-space: pre-wrap; animation: word .25s ease-out both; }}
.hlbox {{ position: absolute; inset: 2px -10px; background: {YELLOW}; transform-origin: left center;
          animation: sweep .35s cubic-bezier(.2,.8,.2,1) both; z-index: 0; }}
.hltext {{ position: relative; z-index: 1; animation: ink .2s linear both; }}"""
        hl_at = 2 * BEAT_S
        body = (f'<div class="stack"><div class="kicker safe" style="animation: rise .3s ease-out both">{meta.get("kickers", KICKERS)[kind]}</div>'
                f'<p class="beat safe">{_beat_text(str(b.get("text") or ""), str(b.get("highlight") or ""), hl_at)}</p>{src}</div>')

    elif kind == "payoff":
        b = beats.get("payoff", {})
        img_style = ' style="filter: brightness(.55)"'
        css += f"""
.payoff {{ margin: 0; font: calc(92px * var(--fs))/1.05 'Anton'; color: #FFFFFF; text-transform: uppercase; overflow-wrap: anywhere; }}
.chip {{ align-self: flex-start; font: 800 34px/1 'Inter'; color: #111; background: {YELLOW}; padding: 16px 26px;
         border-radius: 999px; letter-spacing: 2px; transform-origin: left center;
         animation: pop .35s ease-out both; animation-delay: {2 * BEAT_S:.3f}s; }}"""
        body = (f'<div class="stack"><div class="kicker safe">{meta.get("kickers", KICKERS)["payoff"]}</div>'
                f'<p class="payoff safe">{_words(str(b.get("text") or ""), REVEAL_START)[0]}</p>'
                f'<div class="chip safe">🔖 SIMPAN INI</div>{src}</div>')

    elif kind == "cta":
        img_style = ' style="filter: blur(18px) brightness(.45)"'
        css += f"""
.stack.center {{ bottom: auto; top: 640px; text-align: center; align-items: center; gap: 44px; }}
.cta {{ margin: 0; font: 800 calc(66px * var(--fs))/1.2 'Inter'; color: #FFFFFF; }}
.follow {{ font: calc(60px * var(--fs))/1.1 'Anton'; color: {YELLOW}; text-transform: uppercase; }}
.r1, .r2, .r3 {{ animation: rise .35s ease-out both; }}
.r1 {{ animation-delay: {BEAT_S:.3f}s; }} .r2 {{ animation-delay: {2 * BEAT_S:.3f}s; }} .r3 {{ animation-delay: {3 * BEAT_S:.3f}s; }}"""
        body = (f'<div class="stack center"><p class="cta safe r1">{_esc(story.get("cta"))}</p>'
                f'<div class="follow safe r2">{_esc(meta["follow_line"])}</div>'
                f'<div class="handle safe r3">❤️ Like · 💬 Komen · 🔁 Share</div></div>')
    else:
        raise ValueError(f"unknown scene kind {kind!r}")

    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head>
<body><div class="scene" data-kind="{kind}"><img class="bg" src="{pathlib.Path(img).resolve().as_uri()}" alt=""{img_style}>
<div class="shade"></div><div class="track"><div class="fill"></div></div>{body}</div></body></html>"""
