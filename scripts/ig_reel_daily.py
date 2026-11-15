#!/usr/bin/env python3
"""IG Reel — one Reel for one Instagram account (settings: scripts/ig_reel/accounts/<ACCOUNT>.json) via Buffer

Prompt 1 (`prompts/ig-reel-daily.md`) in executable form. Deterministic: RSS fetch
(feeds interleaved) → Buffer dedup → AI shortlists 6 findings → feed text or fetched article →
AI writes ONE story (hook → context → twist → why → payoff → CTA) only from that text,
every number checked against it → 4 cinematic illustrations → animated HTML scenes
captured frame-by-frame + composed beat-synced music (scripts/ig_reel/) → Cloudinary
hosting → Buffer createPost (Instagram reel, cover = frame 0).

Env (see .github/workflows/ig-reel.yml):
  DRY_RUN=true            Everything except the Cloudinary upload + Buffer post
  CF_ACCOUNT, CF_TOKEN    Cloudflare Workers AI (images) — required for real images
  OPENCODE_API_KEY        text brain (opencode.ai Console, model glm-5.3-flash-free)
  OPENROUTER_API_KEY      fallback brain (preset @preset/ai-scheduler, reasoning excluded)
  GROQ_API_KEY            fallback brain (openai/gpt-oss-20b)
  KILO_API_KEY            optional; Kilo AI Gateway fallback runs keyless (200 req/h/IP) without it
  CF_ACCOUNT, CF_TOKEN    also the last text fallback (Cloudflare Workers AI @cf/openai/gpt-oss-120b)
  BUFFER_ACCESS_TOKEN     optional in dry run, required in real run
  ACCOUNT                 account id (default kaliajatau); pins the Buffer channel/org and Cloudinary cloud name
  MODE                    auto (default) | news | tip — dev override of the story mode
  CLOUDINARY_CLOUD_NAME   must equal the account's cloudinary_cloud_name; CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

Local testing without CF creds: PLACEHOLDER_IMAGES=true renders flat-colour
illustrations with Pillow instead of calling Cloudflare (clearly labelled in the
report). Never ship a placeholder run as a real post.

Usage: python3 scripts/ig_reel_daily.py
"""
import base64
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
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
OPENCODE_API_KEY = os.environ.get("OPENCODE_API_KEY", "").strip()
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b").strip()
KILO_API_KEY = os.environ.get("KILO_API_KEY", "").strip()
OPENCODE_MODEL = (os.environ.get("OPENCODE_MODEL", "") or "glm-5.3-flash-free").strip()
OPENCODE_BASE_URL = (os.environ.get("OPENCODE_BASE_URL", "https://opencode.ai/inference/openai/v1") or "").rstrip("/")
CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME", "").strip()
CLOUD_KEY = os.environ.get("CLOUDINARY_API_KEY", "").strip()
CLOUD_SECRET = os.environ.get("CLOUDINARY_API_SECRET", "").strip()
BUFFER_TOKEN = os.environ.get("BUFFER_ACCESS_TOKEN", "").strip()

WIB = dt.timezone(dt.timedelta(hours=7), "WIB")
NOW = dt.datetime.now(WIB)
TODAY = NOW.date().isoformat()

ROOT = pathlib.Path(".").resolve()
# Vendored playbook tools (cf_image.py, render_html.py, build_reel.py), committed in
# scripts/ig-kit/ — byte-identical to the Cloudinary ig-kit as of 2026-11-12. Never
# downloaded at runtime: executing unpinned remote code with secrets in env is unsafe.
KIT = pathlib.Path(__file__).resolve().parent / "ig-kit"
KIT_FILES = ("cf_image.py",)  # the only kit tool still called (images); the Reel renders via scripts/ig_reel/
GEN = ROOT / ".ig-reel-out"
GEN.mkdir(exist_ok=True)

# Single-story cinematic Reel (spec: docs/superpowers/specs/2026-11-15-ig-reel-cinematic-redesign-design.md).
ARTICLE_MIN = 800       # chars of article text needed to ground a story; else try the next shortlisted item
ARTICLE_PROMPT_MAX = 4000  # chars of article sent to the AI (keeps free-tier token budgets in reach)
STYLE_SUFFIX = ("cinematic film still, dramatic volumetric lighting, teal-and-amber grade, 35mm, "
                "shallow depth of field, film grain, vertical 9:16, no text, no letters, no logos")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from ig_reel.accounts import SLOTS, account_target_errors, load_account, pick_theme, slot_name, wants_news  # noqa: E402
from ig_reel.reel import render_reel  # noqa: E402
from ig_reel.scenes import TIP_KICKERS  # noqa: E402
from ig_reel.story import (  # noqa: E402
    STORY_SCHEMA_HINT, TIP_MAX_NUMBER, age_days, apply_story_limits, build_caption, check_story, extract_article_text, feed_body,
    format_date_id, grounding_text, interleave, order_by_source,
)

UA = "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0"

try:
    ACCOUNT = load_account(os.environ.get("ACCOUNT", "").strip() or "kaliajatau")
except ValueError as _e:
    print(f"FATAL: {_e}", flush=True)
    sys.exit(1)
RSS_FEEDS = [tuple(f) for f in ACCOUNT["feeds"]]
DEDUPE_POSTS = ACCOUNT["dedupe_posts"]  # kaliajatau: 28 = 7 days at 4 Reels/day
BUFFER_CHANNEL = ACCOUNT["buffer_channel_id"]
BUFFER_ORG = ACCOUNT["buffer_org_id"]
SLOT = slot_name(NOW.hour)
MODE = (os.environ.get("MODE", "").strip().lower() or "auto")
TIP_TRIES = 3  # themes tried before a tip run gives up


def log(*a):
    print(*a, flush=True)



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
        text = (f"⚠️ {ACCOUNT['label']} pipeline failed: {str(reason)[:220]}"
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


def _posts_query(first, after=None, paged=False):
    cursor = f', after: "{after}"' if after else ""
    page = " pageInfo { hasNextPage endCursor }" if paged else ""
    return ('query { posts(first: %d%s, input: { organizationId: "%s", '
            'filter: { status: [sent], channelIds: ["%s"] } }) { '
            'edges { node { text createdAt } }%s } }' % (first, cursor, BUFFER_ORG, BUFFER_CHANNEL, page))


def _edge_texts(d):
    return [e["node"]["text"] for e in d.get("posts", {}).get("edges", []) if e.get("node", {}).get("text")]


def recent_post_captions():
    """Texts of the account's last DEDUPE_POSTS sent posts (the AI's do-not-repeat list)."""
    if not BUFFER_TOKEN:
        if DRY_RUN:
            log("buffer: BUFFER_ACCESS_TOKEN unset — skipping duplicate check (dry run)")
            return []
        fail("BUFFER_ACCESS_TOKEN required for a real run")
    try:
        d = buffer_graphql(_posts_query(min(DEDUPE_POSTS, 28)))  # the query shape proven in production
        texts = _edge_texts(d)
    except Exception as e:
        log(f"buffer: duplicate check failed ({e}) — continuing, AI will see no blocklist")
        return []
    if DEDUPE_POSTS > 28:  # longer look-back: page through; any error keeps what the first query returned
        try:
            paged, after = [], None
            while len(paged) < DEDUPE_POSTS:
                posts = buffer_graphql(_posts_query(50, after, paged=True)).get("posts", {})
                paged += _edge_texts({"posts": posts})
                info = posts.get("pageInfo") or {}
                after = info.get("endCursor")
                if not info.get("hasNextPage") or not after:
                    break
            texts = paged[:DEDUPE_POSTS]
        except Exception as e:
            log(f"buffer: paged duplicate check failed ({e}) — using the first {len(texts)} posts only")
    log(f"buffer: fetched {len(texts)} recent sent posts for dedup (look-back {DEDUPE_POSTS})")
    return texts


def verify_account_targets():
    """Wrong-account guard (see account_target_errors). A real run stops; a dry run only logs."""
    errs = account_target_errors(ACCOUNT, CLOUD_NAME)
    if not errs:
        pin = "matches" if ACCOUNT["cloudinary_cloud_name"] else "not pinned"
        log(f"guard: account {ACCOUNT['id']} may post — handle set, Cloudinary cloud {pin}, "
            f"Buffer channel {BUFFER_CHANNEL}")
    elif DRY_RUN:
        log(f"guard: account {ACCOUNT['id']} could NOT post for real: " + "; ".join(errs))
    else:
        fail(f"account {ACCOUNT['id']} refuses to post: " + "; ".join(errs))


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
            title = link = date = desc = body = ""
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
                elif t == "encoded" and not body:  # content:encoded = the feed's own full article text
                    body = feed_body(txt, ARTICLE_PROMPT_MAX)
            if title and link:
                items.append({"title": title, "link": link, "date": date, "desc": desc, "body": body, "source": source})
    max_age = ACCOUNT.get("news_max_age_days")
    if max_age:  # accounts that can fall back to a tip only take fresh announcements
        fresh = [it for it in items if (age_days(it["date"], NOW) or 1e9) <= max_age]
        log(f"rss: {len(fresh)} of {len(items)} items are at most {max_age} days old")
        items = fresh
    groups = [[it for it in items if it["source"] == source] for source, _ in RSS_FEEDS]
    out = interleave(groups, 18)  # round-robin so one busy feed can't crowd out the others
    log(f"rss: {len(out)} candidates from {len(RSS_FEEDS)} feeds (of {len(items)} items)")
    return out


# ---------- 4. AI: pick findings + write Indonesian script ----------
def ai_json(prompt, max_tokens=2600):
    """OpenCode Console → OpenRouter → Groq → Kilo (keyless) → Cloudflare Workers AI. Returns parsed JSON.
    Mirrors the chain in scripts/ai-providers.mjs; the single-story prompt (article text included) is
    large enough that Groq's free tier alone rate-limits, so the later fallbacks matter."""
    attempts = []
    if OPENCODE_API_KEY:
        attempts.append((
            f"{OPENCODE_BASE_URL}/chat/completions",
            {"model": OPENCODE_MODEL,
             "messages": [{"role": "user", "content": prompt}],
             "max_tokens": max_tokens, "temperature": 0.4},
            {"Authorization": f"Bearer {OPENCODE_API_KEY}",
             "x-opencode-session": "ses_ig_reel_daily"}))
    if OPENROUTER_API_KEY:
        attempts.append((
            "https://openrouter.ai/api/v1/chat/completions",
            {"model": "@preset/ai-scheduler",
             "messages": [{"role": "user", "content": prompt}],
             "max_tokens": max_tokens, "temperature": 0.4,
             # reasoning.effort="none" is rejected by the preset (HTTP 400);
             # exclude:true is accepted and leaves the budget for the script.
             "reasoning": {"exclude": True}},
            {"Authorization": f"Bearer {OPENROUTER_API_KEY}"}))
    if GROQ_API_KEY:
        attempts.append((
            "https://api.groq.com/openai/v1/chat/completions",
            {"model": GROQ_MODEL,
             "messages": [{"role": "user", "content": prompt}],
             "max_tokens": max_tokens, "temperature": 0.4},
            {"Authorization": f"Bearer {GROQ_API_KEY}"}))
    # Kilo AI Gateway: anonymous free tier (200 req/h/IP); a key only raises the limit.
    attempts.append((
        "https://ai-gateway.kilo.ai/api/v1/chat/completions",
        {"model": "kilo-auto/free",
         "messages": [{"role": "user", "content": prompt}],
         "max_tokens": max_tokens, "temperature": 0.4},
        {"Authorization": f"Bearer {KILO_API_KEY}"} if KILO_API_KEY else {}))
    if CF_ACCOUNT and CF_TOKEN:
        attempts.append((
            f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/ai/v1/chat/completions",
            {"model": "@cf/openai/gpt-oss-120b",
             "messages": [{"role": "user", "content": prompt}],
             "max_tokens": max_tokens, "temperature": 0.4},
            {"Authorization": f"Bearer {CF_TOKEN}"}))
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


def pick_shortlist(candidates, avoid):
    """AI ranks candidates for one 25-second story; returns up to 6 valid 1-based refs, sources alternating."""
    avoid_block = ("\n".join(f"- {t[:120]}" for t in avoid)) or "(none)"
    hint = f"\nTopik prioritas bila relevan: {TOPIC_HINT}\n" if TOPIC_HINT else ""
    lines = "\n".join(f"{i+1}. [{c['source']}] {c['title']} | {c['desc']}" for i, c in enumerate(candidates))
    prompt = f"""Kamu produser {ACCOUNT['persona']}. Pilih 6 temuan yang paling cocok jadi SATU cerita Reel 25 detik:
paling bikin "hah, serius?!", bisa dijelaskan tanpa jargon, dan mudah divisualkan. Prioritaskan yang terbaru.
{hint}
Sudah diposting baru-baru ini (JANGAN pilih topik yang sama):
{avoid_block}

Kandidat:
{lines}

Jawab HANYA JSON: {{"refs": [nomor terbaik, kedua, ketiga, keempat, kelima, keenam]}}"""
    data = ai_json(prompt, max_tokens=1500)  # reasoning models spend tokens before answering
    refs = []
    for r in (data.get("refs") or []) if isinstance(data, dict) else []:
        try:
            r = int(str(r).strip())
        except ValueError:
            continue
        if 1 <= r <= len(candidates) and r not in refs:
            refs.append(r)
    if not refs:
        fail("AI shortlist returned no valid candidate refs")
    refs = order_by_source(refs[:6], [c["source"] for c in candidates])
    log(f"shortlist: {refs}")
    return refs


ARTICLE_MAX_BYTES = 2_000_000


def _fetch_article_page(cand):
    """Article page text. Only http(s), only HTML, at most 2 MB read (RSS links are data)."""
    link = str(cand.get("link") or "")
    if urllib.parse.urlsplit(link).scheme not in ("http", "https"):
        raise RuntimeError(f"refusing non-http(s) article link: {link[:80]}")
    req = urllib.request.Request(link, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"})
    with urllib.request.urlopen(req, timeout=25) as r:
        ctype = r.headers.get("Content-Type", "")
        if "html" not in ctype.lower():
            raise RuntimeError(f"article is not HTML ({ctype or 'no content-type'})")
        raw = r.read(ARTICLE_MAX_BYTES)
        charset = r.headers.get_content_charset() or "utf-8"
    page = raw.decode(charset, "replace")
    return extract_article_text(page)[:ARTICLE_PROMPT_MAX]


def fetch_article(cand):
    """Text that grounds the story: the feed's own full text when long enough, else the article page."""
    body = cand.get("body") or ""
    text = grounding_text(body, lambda: _fetch_article_page(cand), ARTICLE_MIN)
    origin = "feed body (" + cand["link"] + ")" if text is body and body else cand["link"]
    if cand.get("desc") and cand["desc"] not in text:
        text = cand["desc"] + "\n" + text
    log(f"article: {len(text)} chars from {origin}")
    return text


def write_story(cand, article):
    """One AI call writes the story only from `article`; validated, one repair retry, then truncated."""
    prompt = f"""Kamu penulis naskah {ACCOUNT['persona']}.
Tulis SATU cerita dari artikel di bawah, dengan alur: hook (rasa penasaran) → context (apa yang ditemukan) →
twist (detail paling mengejutkan, sorot satu angka/frasa kunci) → why (kenapa penting buat kita) → payoff (satu kalimat
yang layak disimpan). CTA = ajakan kirim/share yang spesifik untuk cerita ini (sebut tipe teman yang cocok).

Aturan WAJIB:
- SEMUA teks (hook, beats, cta, caption) dalam Bahasa Indonesia, walaupun artikelnya berbahasa Inggris.
- highlight juga Bahasa Indonesia (mis. "1.000 km", bukan "1,000 kilometers"); tulis angka gaya Indonesia (titik ribuan, koma desimal).
- HANYA pakai informasi dari artikel. JANGAN mengarang angka, nama, tanggal, atau klaim. Setiap angka harus ada di artikel.
- Temuan yang belum final: pakai "menurut studi" / "mungkin".
- image_prompts dalam bahasa Inggris, subjek visual yang sama di keempat prompt, tanpa teks/huruf.

Jawab HANYA JSON dengan skema:
{STORY_SCHEMA_HINT}

Sumber: {cand['source']} — {cand['title']}
Artikel:
{article}"""
    data = ai_json(prompt)
    if not isinstance(data, dict):
        raise RuntimeError("AI story is not a JSON object")
    years = set(re.findall(r"\b(?:19|20)\d{2}\b", str(cand.get("date") or "")))
    hard, soft = check_story(data, article, extra_allowed=years)
    if soft:
        log("story: truncating: " + "; ".join(soft))
    if hard:  # soft-only issues are truncated below; a repair call could only make them worse
        log("story: validation issues: " + "; ".join(hard))
        fix = ("Perbaiki JSON cerita di bawah agar lolos validasi. Pelanggaran:\n- " + "\n- ".join(hard + soft)
               + "\nTetap HANYA pakai informasi dari artikel; hapus angka yang tidak ada di artikel. "
               + "Jawab hanya JSON dengan skema yang sama.\n\nJSON:\n" + json.dumps(data, ensure_ascii=False)
               + "\n\nArtikel:\n" + article)
        data = ai_json(fix)
        if not isinstance(data, dict):
            raise RuntimeError("AI story repair is not a JSON object")
        hard, soft = check_story(data, article, extra_allowed=years)
        if hard:
            raise RuntimeError("; ".join(hard))
    apply_story_limits(data)
    return data



def write_tip(theme, avoid):
    """One AI call writes a theme tip (no source article); validated with the tip rules, one repair retry."""
    avoid_block = ("\n".join(f"- {t[:120]}" for t in avoid[:60])) or "(belum ada)"
    topic = TOPIC_HINT or theme['topic']
    prompt = f"""Kamu penulis naskah {ACCOUNT['persona']}.
Tulis SATU tips praktis untuk {theme['tool']} dengan tema: {topic}.
Alur beats: context = masalah yang sering dialami orang → twist = triknya (sorot frasa kuncinya) →
why = contoh prompt siap salin (pendek, dalam Bahasa Indonesia) → payoff = hasil yang didapat, satu kalimat layak disimpan.
CTA = ajakan kirim/share yang spesifik untuk tips ini (sebut tipe teman yang cocok).

Aturan WAJIB:
- SEMUA teks (hook, beats, cta, caption) dalam Bahasa Indonesia, TERMASUK contoh prompt di beat "why"
  (mis. "Sebelum menjawab, tanyakan dulu 3 hal yang perlu kamu tahu dari saya."). Jangan menulis prompt berbahasa Inggris.
- Tips harus benar untuk {theme['tool']} secara umum dan bisa langsung dicoba siapa pun.
- JANGAN sebut harga, paket berbayar, persentase, batas pemakaian, tanggal, nama versi model, atau lokasi menu/tombol.
- JANGAN pakai angka di atas {TIP_MAX_NUMBER}. Sebut alatnya hanya "{theme['tool']}".
- image_prompts dalam bahasa Inggris, subjek visual yang sama di keempat prompt, tanpa teks/huruf/logo.

Sudah diposting baru-baru ini (JANGAN ulangi tips yang sama):
{avoid_block}

Jawab HANYA JSON dengan skema:
{STORY_SCHEMA_HINT}"""
    data = ai_json(prompt)
    if not isinstance(data, dict):
        raise RuntimeError("AI tip is not a JSON object")
    hard, soft = check_story(data, "", mode="tip")
    if soft:
        log("tip: truncating: " + "; ".join(soft))
    if hard:
        log("tip: validation issues: " + "; ".join(hard))
        log("tip: rejected beats: " + " | ".join(str(b.get("text"))[:130] for b in data.get("beats") or [] if isinstance(b, dict)))
        data = ai_json("Perbaiki JSON tips di bawah agar lolos validasi. Pelanggaran:\n- " + "\n- ".join(hard + soft)
                       + "\nJawab hanya JSON dengan skema yang sama.\n\nJSON:\n" + json.dumps(data, ensure_ascii=False))
        if not isinstance(data, dict):
            raise RuntimeError("AI tip repair is not a JSON object")
        hard, soft = check_story(data, "", mode="tip")
        if hard:
            raise RuntimeError("; ".join(hard))
    apply_story_limits(data)
    return data


def find_news_story(recent):
    """(story, candidate) written only from a feed article, or (None, reason)."""
    candidates = fetch_candidates()
    need = 1 if ACCOUNT.get("news_max_age_days") else 6
    if len(candidates) < need:
        return None, f"only {len(candidates)} RSS candidates found; refusing to fabricate"
    reasons = []
    for ref in pick_shortlist(candidates, recent):
        c = candidates[ref - 1]
        try:
            article = fetch_article(c)
        except Exception as e:
            reasons.append(f"#{ref} fetch failed: {str(e)[:80]}")
            continue
        if len(article) < ARTICLE_MIN:
            reasons.append(f"#{ref} article text only {len(article)} chars")
            continue
        try:
            return write_story(c, article), c
        except RuntimeError as e:
            reasons.append(f"#{ref} story invalid: {str(e)[:120]}")
    return None, "no shortlisted article yielded enough text and a valid story: " + "; ".join(reasons)

# ---------- 5. Illustrations + scenes ----------
def make_placeholder(path, seed):
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
            "assets": [{"video": {"url": video_url, "metadata": {"thumbnailOffset": 0}}}],
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
    log(f"account={ACCOUNT['id']}  slot={SLOT}  mode={MODE}  DRY_RUN={DRY_RUN}  PLACEHOLDER_IMAGES={MOCK_IMAGES}  "
        f"topic_hint={TOPIC_HINT or '-'}")
    log("keys: " + "  ".join(f"{n}={'set' if v else 'unset'}" for n, v in (
        ("opencode", OPENCODE_API_KEY), ("openrouter", OPENROUTER_API_KEY), ("groq", GROQ_API_KEY),
        ("cloudflare", CF_ACCOUNT and CF_TOKEN), ("pollinations", os.environ.get("POLLINATIONS_SECRET_KEY", "").strip()),
        ("cloudinary", CLOUD_KEY and CLOUD_SECRET), ("buffer", BUFFER_TOKEN))))
    verify_account_targets()
    check_kit()
    guard_no_placeholder_post()
    recent = recent_post_captions()
    if MODE not in ("auto", "news", "tip"):
        fail(f"MODE must be auto, news or tip, got {MODE!r}")
    themes = ACCOUNT["themes"]
    if MODE == "tip" and not themes:
        fail(f"account {ACCOUNT['id']} has no themes, so it has no tip mode")
    meta = {"handle": ACCOUNT["handle"], "follow_line": ACCOUNT["follow_line"], "hook_kicker": ACCOUNT["hook_kicker"]}

    # news: one story written only from a feed article; tip: a theme tip when the slot or the feeds have no news
    story = cand = None
    if MODE == "news" or (MODE == "auto" and RSS_FEEDS and wants_news(ACCOUNT, SLOT)):
        story, cand = find_news_story(recent)
        if not story:
            if MODE == "news" or not themes:
                fail(cand)
            log(f"news: nothing usable ({cand}) — writing a tip instead")
    if story:
        mode, source, link = "news", cand["source"], cand["link"]
        date = format_date_id(cand["date"])
        sources = [f"{source} — {cand['title'][:80]} ({date}) [{link}]"]
        log(f"story: {story['hook']!r} from [{source}] {cand['title'][:80]}")
    else:
        theme = pick_theme(themes, NOW.date(), SLOT)
        reasons = []
        for offset in range(TIP_TRIES):  # like the news shortlist: a rejected tip moves on to the next theme
            if offset:
                theme = themes[(themes.index(theme) + len(SLOTS)) % len(themes)]  # skip today's other slots
            try:
                story = write_tip(theme, recent)
                break
            except RuntimeError as e:
                reasons.append(f"{theme['tool']} — {theme['topic']}: {str(e)[:140]}")
        if not story:
            fail("no valid tip after " + str(TIP_TRIES) + " themes: " + "; ".join(reasons))
        mode, source, link = "tip", theme["tool"], None
        date = format_date_id(NOW.isoformat())
        sources = [f"tip: {source} — {TOPIC_HINT or theme['topic']}"]
        meta.update(source_label="Tips", kickers=TIP_KICKERS)
        log(f"tip: {story['hook']!r} for [{source}] {theme['topic']}")
    meta.update(source=source, date=date)

    images, image_providers = {}, []
    for k, prompt in enumerate(story["image_prompts"], start=1):
        img = GEN / f"img_{k}.jpg"
        if MOCK_IMAGES:
            log("  PLACEHOLDER_IMAGES=true — placeholder illustration (dev only)")
            make_placeholder(img, k)
            provider = "placeholder"
        else:
            provider = gen_image(f"{prompt}, {STYLE_SUFFIX}", img)
        images[k] = img
        image_providers.append(provider)

    reel = GEN / "ig_reel.mp4"
    res = render_reel(story, images, meta,
                      f"{TODAY}-{NOW:%H%M}", reel)
    log(f"reel: built {reel} ({reel.stat().st_size / 1e6:.1f} MB, {res['seconds']}s, "
        f"music {res['music']['key']} {'-'.join(res['music']['progression'])})")
    full_caption = build_caption(story, source, link)
    log(f"images via: {image_providers}")

    if DRY_RUN:
        log("=== DRY RUN — would upload to Cloudinary and post to Buffer ===")
        log(f"caption:\n{full_caption}")
        log("REPORT " + json.dumps({"status": "dry-run", "account": ACCOUNT["id"], "mode": mode, "topic": story["hook"], "path": str(reel),
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
    log("REPORT " + json.dumps({"status": "sent", "account": ACCOUNT["id"], "mode": mode, "topic": story["hook"], "post_id": post_id,
                                "reel": link, "posted": True, "images": image_providers,
                                "sources": sources}))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        fail(f"step failed (exit {e.returncode}): {e.cmd}")
    except Exception as e:
        fail(str(e))
