#!/usr/bin/env python3
"""IG Reel — Interesting Facts & Knowledge (@kaliajatau.id, → Instagram via Buffer)

Prompt 1 (`prompts/ig-reel-daily.md`) in executable form. Deterministic: RSS fetch
→ Buffer dedup → AI picks 4–5 findings → HTML scenes rendered by headless Chrome
→ reel assembled by build_reel.py (synthesised original music) → Cloudinary
hosting → Buffer createPost (Instagram reel).

Env (see .github/workflows/ig-reel.yml):
  DRY_RUN=true            Everything except the Cloudinary upload + Buffer post
  CF_ACCOUNT, CF_TOKEN    Cloudflare Workers AI (images) — required for real images
  OPENROUTER_API_KEY      text brain (preset @preset/ai-scheduler, reasoning.effort=none)
  GROQ_API_KEY            fallback brain
  BUFFER_ACCESS_TOKEN     optional in dry run, required in real run
  BUFFER_CHANNEL_ID       default 6aed5544e29c69a1717ba62e (playbook)
  BUFFER_ORG_ID           default 6aed53e7ec5c7c6d73f3e437 (playbook)
  CLOUDINARY_CLOUD_NAME   default opqimovw (playbook), CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

Local testing without CF creds: PLACEHOLDER_IMAGES=true renders flat-colour
illustrations with Pillow instead of calling Cloudflare (clearly labelled in the
report). Never ship a placeholder run as a real post.

Usage: python3 scripts/ig_reel_daily.py
"""
import argparse
import base64
import datetime as dt
import hashlib
import hmac
import html
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

DRY_RUN = os.environ.get("DRY_RUN", "true").lower() != "false"
MOCK_IMAGES = os.environ.get("PLACEHOLDER_IMAGES", "false").lower() == "true"
TOPIC_HINT = os.environ.get("TOPIC", "").strip()

# cf_image.py (the playbook tool) hard-requires CF_ACCOUNT / CF_TOKEN names;
# fall back to the repo's canonical CF_ACCOUNT_ID / CF_API_TOKEN.
CF_ACCOUNT = (os.environ.get("CF_ACCOUNT", "") or os.environ.get("CF_ACCOUNT_ID", "")).strip()
CF_TOKEN = (os.environ.get("CF_TOKEN", "") or os.environ.get("CF_API_TOKEN", "")).strip()
os.environ["CF_ACCOUNT"], os.environ["CF_TOKEN"] = CF_ACCOUNT, CF_TOKEN
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME", "opqimovw").strip()
CLOUD_KEY = os.environ.get("CLOUDINARY_API_KEY", "").strip()
CLOUD_SECRET = os.environ.get("CLOUDINARY_API_SECRET", "").strip()
BUFFER_TOKEN = os.environ.get("BUFFER_ACCESS_TOKEN", "").strip()
BUFFER_CHANNEL = (os.environ.get("BUFFER_CHANNEL_ID", "") or "6aed5544e29c69a1717ba62e").strip()
BUFFER_ORG = (os.environ.get("BUFFER_ORG_ID", "") or "6aed53e7ec5c7c6d73f3e437").strip()

WIB = dt.timezone(dt.timedelta(hours=7), "WIB")
NOW = dt.datetime.now(WIB)
TODAY = NOW.date().isoformat()
WEEK_AGO = (NOW - dt.timedelta(days=7)).date().isoformat()

ROOT = pathlib.Path(".").resolve()
# Vendored playbook tools (cf_image.py, render_html.py, build_reel.py), committed in
# scripts/ig-kit/ — byte-identical to the Cloudinary ig-kit as of 2026-11-12. Never
# downloaded at runtime: executing unpinned remote code with secrets in env is unsafe.
KIT = pathlib.Path(__file__).resolve().parent / "ig-kit"
KIT_FILES = ("cf_image.py", "render_html.py", "build_reel.py")
GEN = ROOT / ".ig-reel-out"
GEN.mkdir(exist_ok=True)

# Content limits (prompt below + scene layout): caption <= 400 chars, 4–5 facts,
# fact text <= 280 chars (fits the .fact box above the source line), short title, hook <= 8 words.
CAPTION_MAX = 400
FACTS_MIN, FACTS_MAX = 4, 5
FACT_TEXT_MAX = 280
FACT_TITLE_MAX = 80
HOOK_MAX_WORDS = 8

UA = "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0"

RSS_FEEDS = [
    ("ScienceDaily", "https://www.sciencedaily.com/rss/all.xml"),
    ("Phys.org", "https://phys.org/rss-feed/"),
    ("NASA", "https://www.nasa.gov/news-release/feed/"),
]


def log(*a):
    print(*a, flush=True)

esc = lambda s: html.escape(str(s or ""), quote=True)


def http(url, *, data=None, headers=None, timeout=60, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {"User-Agent": UA}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def http_json(url, payload, headers=None, timeout=120):
    body = json.dumps(payload).encode()
    # Explicit UA: Groq (Cloudflare-fronted) 403s urllib's default "Python-urllib/x" UA (error 1010).
    hdrs = {"Content-Type": "application/json", "User-Agent": UA, **(headers or {})}
    raw = http(url, data=body, headers=hdrs, timeout=timeout)
    return json.loads(raw)


SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "").strip()
SLACK_NEWS_CHANNEL_ID = os.environ.get("SLACK_NEWS_CHANNEL_ID", "").strip()

def fail(reason, post_id=None):
    log(f"FATAL: {reason}")
    report = {"status": "failed", "reason": str(reason)[:300], "posted": False, "draft": False}
    if post_id:
        report["post_id"] = post_id
        report["note"] = "post created on Buffer but not confirmed sent — do NOT blindly redispatch"
    log("REPORT " + json.dumps(report))
    if not DRY_RUN and SLACK_BOT_TOKEN and SLACK_NEWS_CHANNEL_ID:
        text = (f"⚠️ IG Reel pipeline failed: {str(reason)[:220]}"
                + (f" (Buffer post id {post_id} — reel may still publish)" if post_id else "")
                + f" — https://github.com/{os.environ.get('GITHUB_REPOSITORY','')}/actions/runs/{os.environ.get('GITHUB_RUN_ID','')}")
        try:
            resp = http_json("https://slack.com/api/chat.postMessage",
                             {"channel": SLACK_NEWS_CHANNEL_ID, "text": text},
                             headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}"}, timeout=30)
            # Contract: the marker means Slack really accepted the note (HTTP 200 + ok:false is common).
            if isinstance(resp, dict) and resp.get("ok") is True:
                try:
                    pathlib.Path("failure-posted").write_text("1")
                except Exception:
                    pass
            else:
                err = resp.get("error") if isinstance(resp, dict) else "non-object response"
                print(f"failure note to Slack rejected: {err}", flush=True)
        except Exception as e:
            print(f"failure note to Slack failed: {e}", flush=True)
    sys.exit(1)


def guard_no_placeholder_post(image_providers=()):
    """A placeholder reel must never reach Cloudinary/Buffer."""
    if DRY_RUN:
        return
    if MOCK_IMAGES:
        fail("PLACEHOLDER_IMAGES=true is dev-only and requires DRY_RUN=true; refusing a real post")
    if any(p == "placeholder" for p in image_providers):
        fail("reel contains placeholder illustrations; refusing a real post")


# ---------- 1. Vendored tool scripts (no runtime download) ----------
def check_kit():
    missing = [n for n in KIT_FILES if not (KIT / n).is_file()]
    if missing:
        fail(f"vendored kit missing in {KIT}: {', '.join(missing)}")
    log(f"kit: using vendored scripts from {KIT}")


# ---------- 2. Buffer: recent posts (duplicate topic guard) ----------
def buffer_graphql(query, variables=None):
    raw = http_json("https://api.buffer.com",
                    {"query": query, **({"variables": variables} if variables else {})},
                    headers={"Authorization": f"Bearer {BUFFER_TOKEN}"})
    if raw.get("errors"):
        raise RuntimeError(str(raw["errors"])[:300])
    return raw.get("data", {})


def recent_post_captions():
    if not BUFFER_TOKEN:
        if DRY_RUN:
            log("buffer: BUFFER_ACCESS_TOKEN unset — skipping 7-day duplicate check (dry run)")
            return []
        fail("BUFFER_ACCESS_TOKEN required for a real run")
    try:
        d = buffer_graphql(
            'query { posts(first: 12, input: { organizationId: "%s", '
            'filter: { status: [sent], channelIds: ["%s"] } }) { '
            'edges { node { text createdAt } } } }' % (BUFFER_ORG, BUFFER_CHANNEL))
        texts = [e["node"]["text"] for e in d.get("posts", {}).get("edges", []) if e.get("node", {}).get("text")]
        log(f"buffer: fetched {len(texts)} recent sent posts for 7-day dedup")
        return texts
    except Exception as e:
        log(f"buffer: duplicate check failed ({e}) — continuing, AI will see no blocklist")
        return []


# ---------- 3. Research: RSS candidates ----------
def fetch_candidates():
    items = []
    for source, url in RSS_FEEDS:
        try:
            xml = http(url, timeout=25)
            root = ET.fromstring(xml)
        except Exception as e:
            log(f"rss: {source} failed: {e}")
            continue
        for node in root.iter():
            tag = node.tag.split("}")[-1]
            if tag not in ("item", "entry"):
                continue
            title = link = date = desc = ""
            for child in node:
                t = child.tag.split("}")[-1]
                txt = (child.text or "").strip()
                if t == "title" and not title:
                    title = re.sub(r"\s+", " ", txt)
                elif t == "link":
                    if not link:
                        link = txt or (child.get("href") or "")
                elif t in ("pubDate", "updated", "published", "dc:date"):
                    date = txt
                elif t in ("description", "summary", "content") and not desc:
                    desc = re.sub(r"<[^>]+>", " ", txt)
                    desc = re.sub(r"\s+", " ", desc)[:220]
            if title and link:
                items.append({"title": title, "link": link, "date": date, "desc": desc, "source": source})
    seen, out = set(), []
    for it in items:
        key = it["title"][:80].lower()
        if key not in seen:
            seen.add(key)
            out.append(it)
    log(f"rss: {len(out)} candidates from {len(RSS_FEEDS)} feeds")
    return out[:18]


# ---------- 4. AI: pick findings + write Indonesian script ----------
def truncate_word(s, n):
    """Truncate to <= n chars at a word boundary (ellipsis-free)."""
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    if len(s) <= n:
        return s
    cut = s[:n]
    m = re.search(r"^(.*)\s[^\s]*$", cut)
    cand = (m.group(1) if m else cut).rstrip(" ,;:-–—")
    return cand if cand else cut.rstrip()


def check_script(data):
    """Validate AI output. Returns (hard, soft) violation lists.
    Hard = must not ship; soft = safely truncatable (caption/text length).
    Trims fact overflow to limits in place."""
    hard, soft = [], []
    facts = data.get("facts")
    if not isinstance(facts, list):
        hard.append("'facts' missing or not a list")
        facts = []
    else:
        if len(facts) > FACTS_MAX:
            log(f"  validation: trimming {len(facts)} facts to {FACTS_MAX}")
            del facts[FACTS_MAX:]
        if len(facts) < FACTS_MIN:
            hard.append(f"need {FACTS_MIN}-{FACTS_MAX} facts, got {len(facts)}")
    for i, f in enumerate(facts, 1):
        if not isinstance(f, dict):
            hard.append(f"fact {i} is not an object")
            continue
        fact_txt = str(f.get("fact") or "").strip()
        title_txt = str(f.get("title") or "").strip()
        if not fact_txt:
            hard.append(f"fact {i}: missing 'fact' text")
        elif len(fact_txt) > FACT_TEXT_MAX:
            soft.append(f"fact {i} text {len(fact_txt)} chars (> {FACT_TEXT_MAX})")
        if not title_txt:
            hard.append(f"fact {i}: missing 'title'")
        elif len(title_txt) > FACT_TITLE_MAX:
            soft.append(f"fact {i} title {len(title_txt)} chars (> {FACT_TITLE_MAX})")
        if not str(f.get("image_prompt") or "").strip():
            hard.append(f"fact {i}: missing 'image_prompt'")
        try:
            ref = int(str(f.get("ref")).strip())
            if ref < 1:
                raise ValueError
        except Exception:
            hard.append(f"fact {i}: missing/invalid 'ref'")
    hook = str(data.get("hook") or "").strip()
    if hook and len(hook.split()) > HOOK_MAX_WORDS:
        soft.append(f"hook '{hook}' is {len(hook.split())} words (> {HOOK_MAX_WORDS})")
    caption = str(data.get("caption") or "").strip()
    if not caption:
        hard.append("missing 'caption'")
    elif len(caption) > CAPTION_MAX:
        soft.append(f"caption {len(caption)} chars (> {CAPTION_MAX})")
    return hard, soft


def apply_length_limits(data):
    """Safe truncations the scene layout tolerates."""
    data["caption"] = truncate_word(data.get("caption"), CAPTION_MAX)
    if str(data.get("hook") or "").strip():
        data["hook"] = " ".join(str(data["hook"]).split()[:HOOK_MAX_WORDS])
    for f in data.get("facts") or []:
        if not isinstance(f, dict):
            continue
        f["fact"] = truncate_word(f.get("fact"), FACT_TEXT_MAX)
        f["title"] = truncate_word(f.get("title"), FACT_TITLE_MAX)


def repair_prompt(data, violations):
    return (
        "Output JSON baru saja, tanpa prosa. Perbaiki skenario Reel di bawah ini agar lolos validasi.\n"
        "Pelanggaran:\n- " + "\n- ".join(violations) + "\n"
        f"Batas wajib: hook maks {HOOK_MAX_WORDS} kata; {FACTS_MIN}–{FACTS_MAX} fakta; "
        f"teks fakta maks {FACT_TEXT_MAX} karakter; judul fakta maks {FACT_TITLE_MAX} karakter; "
        f"caption maks {CAPTION_MAX} karakter; setiap fakta wajib punya ref (1-based) ke daftar kandidat asli.\n"
        "Jangan tambah/fakta baru, jangan ubah ref. Jawab hanya JSON dengan skema yang sama.\n\n"
        + json.dumps(data, ensure_ascii=False))



def ai_json(prompt, max_tokens=2600):
    """OpenRouter preset (reasoning disabled) → Groq fallback. Returns parsed JSON."""
    attempts = []
    if OPENROUTER_API_KEY:
        attempts.append((
            "https://openrouter.ai/api/v1/chat/completions",
            {"model": "@preset/ai-scheduler",
             "messages": [{"role": "user", "content": prompt}],
             "max_tokens": max_tokens, "temperature": 0.4,
             "reasoning": {"effort": "none"}},
            {"Authorization": f"Bearer {OPENROUTER_API_KEY}"}))
    if GROQ_API_KEY:
        attempts.append((
            "https://api.groq.com/openai/v1/chat/completions",
            {"model": "openai/gpt-oss-20b",
             "messages": [{"role": "user", "content": prompt}],
             "max_tokens": max_tokens, "temperature": 0.4},
            {"Authorization": f"Bearer {GROQ_API_KEY}"}))
    if not attempts:
        raise RuntimeError("no AI provider credentials (OPENROUTER_API_KEY / GROQ_API_KEY)")
    errors = []
    for url, body, headers in attempts:
        try:
            j = http_json(url, body, headers=headers, timeout=240)
            content = (j.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            m = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", content)
            if not m:
                errors.append("empty content")
                continue
            return json.loads(m.group(1))
        except Exception as e:
            errors.append(str(e)[:160])
    raise RuntimeError("all AI providers failed: " + " | ".join(errors))


def draft_script(candidates, avoid):
    avoid_block = ("\n".join(f"- {t[:120]}" for t in avoid)) or "(none)"
    hint = f"\nJendela topik prioritas (aksi ini PRIORITAS bila relevan): {TOPIC_HINT}\n" if TOPIC_HINT else ""
    lines = "\n".join(
        f"{i+1}. [{c['source']}] {c['title']}{(' | ' + c['date']) if c['date'] else ''} | {c['link']}\n   {c['desc']}"
        for i, c in enumerate(candidates))
    prompt = f"""Kamu editor majalah sains untuk @kaliajatau.id. Dari daftar temuan di bawah, pilih 4–5 temuan paling menarik & bisa diverifikasi (prioritas: baru rilis minggu ini), lalu susun skenario Reel 30–40 detik untuk niche "Interesting Facts & Knowledge".
{hint}
Sudah dipostrujukan minggu ini (hindari duplikat):
{avoid_block}

Aturan konten:
- Bahasa Indonesia santai-profesional; JANGAN mengarang angka/fakta/sumber/tanggal.
- Setiap fakta WAJIB menunjuk ke satu item dari daftar kandidat lewat "ref" (nomor 1-based).
- Fakta harus bisa disimpulkan dari kandidat yang dipilih — tidak menambah info di luar deskripsi kandidat.
- Fakta awal: gunakan "mungkin"/"menurut studi" untuk temuan yang belum final.
- Teks per scene: 1 judul pendek + fakta 2–3 kalimat (maks ±280 karakter per scene).
- Hook maks 8 kata; CTA: ajakan simpan/share + ikuti @kaliajatau.id.

Jawab HANYA JSON dengan skema ini (tanpa prosa):
{{"hook": "hook <= 8 kata",
  "hook_sub": "baris kecil di bawah hook",
  "facts": [{{"ref": 3, "title": "...", "fact": "...",
             "image_prompt": "vivid 9:16 illustration, no text no letters"}}],
  "caption": "caption IG <= 400 karakter, santai, 1 pertanyaan di akhir",
  "hashtags": ["#Sains"]}}

Daftar temuan:
{lines}"""
    data = ai_json(prompt)
    hard, soft = check_script(data)
    if hard or soft:
        log("draft: validation issues: " + "; ".join(hard + soft))
        data = ai_json(repair_prompt(data, hard + soft))
        hard, soft = check_script(data)
        if hard:
            raise RuntimeError("AI output still invalid after one repair retry: " + "; ".join(hard))
        if soft:
            log("draft: after repair, truncating: " + "; ".join(soft))
    apply_length_limits(data)
    facts = data.get("facts") or []
    if not (FACTS_MIN <= len(facts) <= FACTS_MAX):
        raise RuntimeError(f"AI returned {len(facts)} facts (need {FACTS_MIN}–{FACTS_MAX})")
    return data, candidates


# ---------- 5. Illustrations + scenes ----------
def make_placeholder(path, label, seed):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (768, 1360), (15, 22, 44))
    draw = ImageDraw.Draw(img, "RGBA")
    colors = [(255, 210, 63), (255, 154, 75), (95, 200, 255), (160, 255, 170), (255, 110, 120)]
    for i in range(18):
        x = (seed * 137 + i * 211) % 768
        y = (seed * 389 + i * 293) % 1360
        r = 18 + (seed * 31 + i * 47) % 60
        draw.ellipse([x - r, y - r, x + r, y + r], fill=colors[i % len(colors)] + (60,))
    draw.ellipse([330, 560, 438, 668], fill=(255, 255, 255, 30))
    img.save(path, quality=90)
    log(f"  placeholder image written to {path}")


def make_scene_html(kind, num, title, body, source, idx_total, bg_tag):
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html,body {{ margin:0; width:1080px; height:1920px; overflow:hidden; background:#0B1020;
               font-family:'Inter','DejaVu Sans',sans-serif; color:#F2F1EC }}
  .scene {{ position:relative; width:1080px; height:1920px }}
  .bg {{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:.38 }}
  .shade {{ position:absolute; inset:0;
            background:linear-gradient(180deg, rgba(11,16,32,.10) 0%, rgba(11,16,32,.55) 45%, rgba(11,16,32,.92) 82%) }}
  .num {{ position:absolute; top:262px; left:84px; font-size:220px; line-height:1; font-weight:800;
          color:#FFD23F; opacity:.92; letter-spacing:-6px }}
  .kicker {{ position:absolute; top:190px; left:88px; font-size:30px; letter-spacing:8px;
             color:#FFD23F; font-weight:700; text-transform:uppercase }}
  h1 {{ position:absolute; top:560px; left:88px; right:210px; margin:0;
        font-size:64px; line-height:1.22; font-weight:800 }}
  .fact {{ position:absolute; top:1120px; left:88px; right:210px; margin:0;
           font-size:40px; line-height:1.36; color:#E9E7DE }}
  .src {{ position:absolute; top:1600px; left:88px; right:88px; font-size:25px;
          line-height:1.4; color:#C9C7BB }}
  .handle {{ position:absolute; top:1756px; left:88px; font-size:29px; color:#FFD23F;
             font-weight:700; letter-spacing:3px }}
  .trust {{ position:absolute; top:1760px; right:88px; font-size:24px; color:#B7B5A9 }}
</style></head><body>
<div class="scene">
  {bg_tag}
  <div class="shade"></div>
  <div class="kicker">Fakta Sains · {esc(idx_total)}</div>
  <div class="num">{esc(num)}</div>
  <h1>{esc(title)}</h1>
  <p class="fact">{esc(body)}</p>
  <div class="src">{esc(source)}</div>
  <div class="handle">@kaliajatau.id</div>
  <div class="trust">Sains untuk semua</div>
</div>
</body></html>"""
    return html


def hook_scene(title, sub, idx_total):
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html,body {{ margin:0; width:1080px; height:1920px; overflow:hidden; background:#0B1020;
               font-family:'Inter','DejaVu Sans',sans-serif; color:#F2F1EC; text-align:center }}
  .week {{ position:absolute; top:300px; left:0; right:0; font-size:34px; color:#FFD23F;
           letter-spacing:10px; font-weight:700; text-transform:uppercase }}
  .mega {{ position:absolute; top:620px; left:90px; right:90px; margin:0; font-size:96px;
           line-height:1.08; font-weight:800; color:#F2F1EC; letter-spacing:-3px }}
  .mega em {{ color:#FFD23F; font-style:normal }}
  .sub {{ position:absolute; top:1360px; left:0; right:0; font-size:38px; color:#D9D6CC }}
  .handle {{ position:absolute; top:1690px; left:0; right:0; font-size:31px; color:#FFD23F;
             letter-spacing:4px; font-weight:700 }}
</style></head><body>
  <div class="week">Fakta Sains · {TODAY}</div>
  <h1 class="mega">{esc(title)}</h1>
  <div class="sub">{esc(sub)}</div>
  <div class="handle">@kaliajatau.id</div>
</body></html>"""
    return html

def cta_scene(n):
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html,body {{ margin:0; width:1080px; height:1920px; overflow:hidden; background:#0B1020;
               font-family:'Inter','DejaVu Sans',sans-serif; color:#F2F1EC; text-align:center }}
  .q {{ position:absolute; top:480px; left:80px; right:80px; font-size:88px; line-height:1.15;
        font-weight:800; margin:0 }}
  .q em {{ color:#FFD23F; font-style:normal }}
  .save {{ position:absolute; top:1090px; left:0; right:0; font-size:38px; color:#D9D6CC }}
  .follow {{ position:absolute; top:1330px; left:0; right:0; font-size:52px; color:#FFD23F;
             letter-spacing:6px; font-weight:800 }}
</style></head><body>
  <h1 class="q">Fakta mana yang <em>paling bikin kaget</em>?</h1>
  <div class="save">Simpan dulu &amp; tag temanmu.</div>
  <div class="follow">FOLLOW @kaliajatau.id</div>
</body></html>"""
    return html


def data_uri_image(path):
    return f'<img class="bg" src="data:image/jpeg;base64,{base64.b64encode(path.read_bytes()).decode()}" alt="">'


def render(png_name, html):
    src = GEN / (png_name + ".html")
    src.write_text(html)
    subprocess.run([sys.executable, str(KIT / "render_html.py"), str(src), str(GEN / png_name),
                    "1080x1920", "--png"], check=True)
    return GEN / (png_name + ".png")


# ---------- 5. Illustration providers (chain; Cloudflare primary, then best free) ----------
def gen_image_cf(prompt, out_path):
    account = (os.environ.get("CF_ACCOUNT", "") or os.environ.get("CF_ACCOUNT_ID", "")).strip()
    token = (os.environ.get("CF_TOKEN", "") or os.environ.get("CF_API_TOKEN", "")).strip()
    if not account or not token:
        raise RuntimeError("no CF credentials")
    proc = subprocess.run([sys.executable, str(KIT / "cf_image.py"),
                           prompt, str(out_path), "--size", "768x1360", "--fit", "1080x1920"],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        fail_lines = [l for l in (proc.stderr or proc.stdout or "").splitlines() if l.strip()]
        fail_reason = fail_lines[-1][:200] if fail_lines else f"cf_image exit {proc.returncode}"
        raise RuntimeError(fail_reason or f"cf_image exit {proc.returncode}")
    if not out_path.exists() or out_path.stat().st_size < 1000:
        raise RuntimeError("cf_image produced no image")


def _find_b64_image(node):
    if isinstance(node, dict):
        data = node.get("data")
        mime = str(node.get("mime_type") or node.get("mimeType") or "")
        if isinstance(data, str) and data and ("image" in mime or node.get("type") == "image"):
            return data
        for v in node.values():
            found = _find_b64_image(v)
            if found:
                return found
    elif isinstance(node, list):
        for v in node:
            found = _find_b64_image(v)
            if found:
                return found
    return None


def gen_image_google(prompt, out_path):
    """Google AI Studio — Nano Banana (Gemini image generation), free tier with key."""
    key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not key:
        raise RuntimeError("no GOOGLE_API_KEY")
    model = os.environ.get("GOOGLE_IMAGE_MODEL", "gemini-nano-banana-2.1")
    body = {
        "model": model,
        "input": prompt,
        "response_format": {"type": "image", "mime_type": "image/jpeg",
                            "aspect_ratio": "9:16", "image_size": "1K"},
    }
    j = http_json("https://generativelanguage.googleapis.com/v1beta/interactions",
                  body, headers={"x-goog-api-key": key, "Api-Revision": "2026-05-20"}, timeout=180)
    data = _find_b64_image(j)
    if not data:
        raise RuntimeError("no image in response: " + json.dumps(j)[:200])
    out_path.write_bytes(base64.b64decode(data))


def gen_image_hf(prompt, out_path):
    """Hugging Face serverless Inference — FLUX.1-schnell by default (open weights)."""
    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        raise RuntimeError("no HF_TOKEN")
    model = os.environ.get("HF_IMAGE_MODEL", "black-forest-labs/FLUX.1-schnell")
    req = urllib.request.Request(
        f"https://router.huggingface.co/hf-inference/models/{model}",
        data=json.dumps({"inputs": prompt}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "image/png"},
        method="POST")
    with urllib.request.urlopen(req, timeout=240) as r:
        blob = r.read()
    if len(blob) < 1000 or blob[:8] in (b'{"error":',):
        raise RuntimeError("unexpected HF response: " + blob[:200].decode("utf-8", "replace"))
    out_path.write_bytes(blob)


_POLLINATION_LAST = [0.0]

def gen_image_pollinations(prompt, out_path):
    """Pollinations.ai.

    With POLLINATIONS_SECRET_KEY (sk_…): modern endpoint gen.pollinations.ai/image,
    Bearer auth, no per-IP pacing, no watermark.
    Without: classic endpoint image.pollinations.ai/prompt — free tier = 1 image / 45 s per IP.
    """
    import urllib.error
    import urllib.parse
    secret = os.environ.get("POLLINATIONS_SECRET_KEY", "").strip()
    q = urllib.parse.quote(prompt)

    if secret:
        authed = True
        url = f"https://gen.pollinations.ai/image/{q}?width=768&height=1360&nologo=true"
        headers = {"Authorization": f"Bearer {secret}", "User-Agent": UA}
    else:
        authed = False
        wait = _POLLINATION_LAST[0] + 46 - time.time()
        if wait > 0:
            log(f"  pollinations: waiting {wait:.0f}s (free tier 1 image / 45s)")
            time.sleep(wait)
        url = f"https://image.pollinations.ai/prompt/{q}?width=768&height=1360&nologo=true&model=flux"
        headers = None

    for attempt in range(1, 4):
        _POLLINATION_LAST[0] = time.time()
        try:
            blob = http(url, headers=headers, timeout=240)
        except urllib.error.HTTPError as e:
            try:
                raw = e.read().decode("utf-8", "replace")
            except Exception:
                raw = str(e)
            msg = raw[:200]
            if e.code in (402, 429, 500, 503):
                m = re.search(r"Retry after (\d+)s", raw)
                delay = int(m.group(1)) + 2 if m else 45 * attempt
                log(f"  pollinations: HTTP {e.code} — {msg[:120]} — retrying in {delay}s")
                time.sleep(delay)
                continue
            raise RuntimeError(f"HTTP {e.code} {msg}")
        if blob[:2] == b"\xff\xd8" or blob[:8] == b"\x89PNG\r\n\x1a\n":
            out_path.write_bytes(blob)
            return
        raise RuntimeError("non-image response: " + blob[:150].decode("utf-8", "replace"))
    raise RuntimeError("pollinations rate-limited after 3 attempts")


IMAGE_PROVIDERS = [
    ("cloudflare", gen_image_cf),
    ("google", gen_image_google),
    ("huggingface", gen_image_hf),
    ("pollinations", gen_image_pollinations),
]
_PROVIDER_ORDER = os.environ.get("IMAGE_ORDER", ",".join(name for name, _ in IMAGE_PROVIDERS)).split(",")


def gen_image(prompt, out_path):
    errors = []
    by_name = dict(IMAGE_PROVIDERS)
    for name in _PROVIDER_ORDER:
        name = name.strip()
        fn = by_name.get(name)
        if not fn:
            log(f"  image provider {name}: unknown — skipped")
            continue
        try:
            fn(prompt, out_path)
            log(f"  image via {name} ✓")
            return name
        except Exception as e:
            log(f"  image provider {name} failed: {str(e)[:200]}")
            errors.append(f"{name}: {str(e)[:120]}")
    raise RuntimeError("all image providers failed: " + " | ".join(errors))


# ---------- 6. Cloudinary + Buffer ----------
def cloudinary_upload(path, public_id):
    ts = int(time.time())
    to_sign = f"public_id={public_id}&timestamp={ts}"
    signature = hashlib.sha1((to_sign + CLOUD_SECRET).encode()).hexdigest()
    boundary = "----igReelBoundary" + str(ts)
    parts = []
    def field(name, value):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    field("timestamp", str(ts))
    field("api_key", CLOUD_KEY)
    field("public_id", public_id)
    field("signature", signature)
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
                 f'Content-Type: video/mp4\r\n\r\n'.encode() + path.read_bytes() + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        f"https://api.cloudinary.com/v1_1/{CLOUD_NAME}/video/upload",
        data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())


def buffer_create_and_confirm(video_url, caption):
    d = buffer_graphql(
        'mutation CreateReel($input: CreatePostInput!) {\n'
        '  createPost(input: $input) {\n'
        '    ... on PostActionSuccess { post { id status externalLink text } }\n'
        '    ... on MutationError { message }\n'
        '  }\n'
        '}',
        {"input": {
            "text": caption,
            "channelId": BUFFER_CHANNEL,
            "schedulingType": "automatic",
            "mode": "shareNow",
            "assets": [{"video": {"url": video_url, "metadata": {"thumbnailOffset": 500}}}],
            "metadata": {"instagram": {"type": "reel", "shouldShareToFeed": True, "isAiGenerated": True}},
        }})
    payload = d.get("createPost", {})
    if "message" in payload:
        fail(f"buffer createPost error: {payload['message']}")
    post = payload.get("post") or {}
    post_id = post.get("id")
    log(f"buffer: post created id={post_id} status={post.get('status')}")
    log(f"buffer: externalLink={post.get('externalLink')}")
    for attempt in range(1, 25):
        time.sleep(15)
        d = buffer_graphql(
            'query Post($input: PostInput!) { post(input: $input) { id status externalLink } }',
            {"input": {"id": post_id}})
        status = (d.get("post") or {}).get("status")
        link = (d.get("post") or {}).get("externalLink")
        log(f"buffer: poll {attempt}: status={status}")
        if status == "sent":
            return post_id, link
        if status == "error":
            fail("buffer reported the post is in error state", post_id=post_id)
    fail(f"buffer post never reached status=sent after 6 minutes (post_id={post_id})", post_id=post_id)


# ---------- main ----------
def main():
    parser = argparse.ArgumentParser()
    parser.parse_args()
    log(f"DRY_RUN={DRY_RUN}  PLACEHOLDER_IMAGES={MOCK_IMAGES}  topic_hint={TOPIC_HINT or '-'}")
    check_kit()
    guard_no_placeholder_post()
    recent = recent_post_captions()
    candidates = fetch_candidates()
    if len(candidates) < 6:
        fail(f"only {len(candidates)} RSS candidates found; refusing to fabricate")
    script, candidate_list = draft_script(candidates, recent)
    facts = script["facts"]

    # ground every fact in its referenced candidate: source/link/date can never be invented
    for f in facts:
        idx = f.pop("ref", None)
        try:
            ref = int(str(idx).strip()) if idx is not None else -1
            cand = candidate_list[ref - 1]
        except Exception:
            fail(f"AI fact {f.get('title')!r} has no valid 'ref' into the candidate list")
        f["source"] = cand["source"]
        f["date"] = (cand["date"] or "")[:32] or "tanggal tidak tercantum"
        f["link"] = cand.get("link", "")
    hook = script.get("hook", "5 Fakta Sains").strip()
    hook_sub = script.get("hook_sub", "Yang rilis minggu ini").strip()
    caption = (script.get("caption") or "Fakta sains minggu ini").strip()
    hashtags = " ".join(script.get("hashtags") or ["#Sains"])
    full_caption = f"{caption}\n\n{hashtags}"

    scenes_meta = [{"kind": "hook", "png": GEN / "scene_00.png", "dur": 3.0}]
    image_providers = []

    # hook scene (HTML-only)
    render("scene_00", hook_scene(hook, hook_sub, NOW.strftime("%Y-%m-%d")))

    total = len(facts)
    for i, f in enumerate(facts, start=1):
        log(f"fact {i}/{total}: {f.get('title')}")
        img = GEN / f"img_{i}.jpg"
        if MOCK_IMAGES:
            log("  PLACEHOLDER_IMAGES=true — placeholder illustration (dev only)")
            make_placeholder(img, str(i), i)
            provider = "placeholder"
        else:
            provider = gen_image(
                f"{f.get('image_prompt', '')}, no text, no letters, no logos, vertical 9:16",
                img)
        image_providers.append(provider)
        bg = data_uri_image(img)
        html = make_scene_html(
            "fact", f"{i:02d}", f.get("title", ""), f.get("fact", ""),
            f"Sumber: {f.get('source', '?')} · {f.get('date', '?')}",
            f"{i}/{total}", bg,
        )
        scene_png = render(f"scene_{i:02d}", html)
        scenes_meta.append({"kind": "fact", "png": scene_png, "dur": 5.5})

    render(f"scene_{total+1:02d}", cta_scene(total))
    scenes_meta.append({"kind": "cta", "png": GEN / f"scene_{total+1:02d}.png", "dur": 3.5})

    scenes_json = GEN / "scenes.json"
    scenes_json.write_text(json.dumps(
        [{"png": str(s["png"].resolve()), "dur": s["dur"]} for s in scenes_meta], indent=1))
    reel = GEN / "ig_reel.mp4"
    subprocess.run([sys.executable, str(KIT / "build_reel.py"), str(scenes_json), str(reel)], check=True)
    log(f"reel: built {reel} ({reel.stat().st_size / 1e6:.1f} MB)")

    sources = [f"{f.get('source', '?')} — {f.get('title', '')[:60]} ({f.get('date', '')}) [{f.get('link', '')}]" for f in facts]
    log(f"images via: {image_providers}")

    if DRY_RUN:
        log("=== DRY RUN — would upload to Cloudinary and post to Buffer ===")
        log(f"caption:\n{full_caption}")
        log(f"scenes: {len(scenes_meta)} | duration ≈ {sum(s['dur'] for s in scenes_meta):.1f}s")
        log("REPORT " + json.dumps({"status": "dry-run", "topic": hook, "path": str(reel),
                                    "posted": False, "images": image_providers,
                                    "sources": sources}))
        return

    guard_no_placeholder_post(image_providers)
    missing = [k for k, v in (("CLOUDINARY_API_KEY", CLOUD_KEY), ("CLOUDINARY_API_SECRET", CLOUD_SECRET),
                              ("BUFFER_ACCESS_TOKEN", BUFFER_TOKEN)) if not v]
    if missing:
        fail(f"missing credentials for real run: {', '.join(missing)}")
    public_id = f"ig/{TODAY}/ig-reel-{NOW.strftime('%H%M%S')}"
    up = cloudinary_upload(reel, public_id)
    url = up.get("secure_url") or up.get("url")
    if int(up.get("bytes", -1)) != reel.stat().st_size:
        fail(f"cloudinary size mismatch: local {reel.stat().st_size} vs {up.get('bytes')}")
    log(f"cloudinary: uploaded {url}")
    post_id, link = buffer_create_and_confirm(url, full_caption)
    log("REPORT " + json.dumps({"status": "sent", "topic": hook, "post_id": post_id,
                                "reel": link, "posted": True, "images": image_providers,
                                "sources": sources}))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        fail(f"step failed (exit {e.returncode}): {e.cmd}")
    except Exception as e:
        fail(str(e))
