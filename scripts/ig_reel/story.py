"""Story selection helpers, grounding validator and caption builder for the daily Reel.

Pure functions (no network): the orchestrator (scripts/ig_reel_daily.py) does the I/O.
Grounding rule: every number the AI writes must appear in the fetched article text.
"""
import datetime as _dt
import email.utils as _eu
import html as _html
import re

ROLES = ("context", "twist", "why", "payoff")
HOOK_MAX_WORDS = 7
BEAT_MAX = 120
CTA_MAX = 60
OPENER_MAX = 120
CAPTION_MAX = 2200
HASHTAGS_MIN, HASHTAGS_MAX = 5, 8
ARTICLE_MAX = 6000

STORY_SCHEMA_HINT = """{"hook": "maks 7 kata, membuka rasa penasaran",
 "hook_highlight": ["kata dari hook yang diwarnai kuning"],
 "beats": [
   {"role": "context", "text": "maks 120 karakter", "highlight": ""},
   {"role": "twist", "text": "maks 120 karakter", "highlight": "substring persis dari text (angka/frasa kunci)"},
   {"role": "why", "text": "maks 120 karakter", "highlight": ""},
   {"role": "payoff", "text": "maks 120 karakter, satu kalimat layak disimpan", "highlight": ""}
 ],
 "cta": "ajakan kirim/share khusus cerita ini, maks 60 karakter, boleh 1 emoji",
 "image_prompts": ["4 prompt bahasa Inggris: hook, context, twist, why/payoff — subjek sama, tanpa teks"],
 "caption": {"opener": "hook diparafrase, maks 120 karakter", "body": "2–3 baris pendek",
             "question": "1 pertanyaan untuk komentar", "save_line": "ajakan simpan/kirim"},
 "hashtags": ["5–8 hashtag: umum + niche + bahasa Indonesia"]}"""


_MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]


def format_date_id(raw):
    """RSS/Atom date → '14 Nov 2026' with Indonesian month names; unparseable text is kept."""
    raw = str(raw or "").strip()
    if not raw:
        return "tanggal tidak tercantum"
    d = None
    try:
        d = _eu.parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        try:
            d = _dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return raw[:32]
    return f"{d.day} {_MONTHS_ID[d.month - 1]} {d.year}"


def interleave(groups, cap):
    """Round-robin across per-feed candidate lists, dedupe by title, keep the first `cap`."""
    seen, out = set(), []
    longest = max((len(g) for g in groups), default=0)
    for i in range(longest):
        for g in groups:
            if i < len(g):
                key = str(g[i].get("title", ""))[:80].lower()
                if key and key not in seen:
                    seen.add(key)
                    out.append(g[i])
    return out[:cap]


_DROP = re.compile(r"<(script|style|nav|header|footer|aside|form|noscript|svg)\b[^>]*>.*?</\1\s*>", re.S | re.I)


def extract_article_text(page_html):
    """Readable paragraph text of an article page (nav/scripts dropped), capped."""
    cleaned = _DROP.sub(" ", str(page_html))
    paras = []
    for m in re.finditer(r"<p\b[^>]*>(.*?)</p\s*>", cleaned, re.S | re.I):
        text = re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", m.group(1)))).strip()
        if text:
            paras.append(text)
    return "\n".join(paras)[:ARTICLE_MAX]


# Function words that dominate ordinary Indonesian vs English prose; the AI sometimes
# follows an English source article instead of the instruction to write in Indonesian.
_ID_WORDS = {"yang", "dan", "di", "ini", "itu", "dari", "untuk", "dengan", "ke", "bisa", "ada", "tidak",
             "adalah", "akan", "juga", "atau", "karena", "kita", "kamu", "lebih", "jadi", "punya", "seperti",
             "ternyata", "sekitar", "kali", "baru", "para", "tapi", "pun", "nya", "milik", "alias", "ikut"}
_EN_WORDS = {"the", "and", "of", "is", "are", "with", "to", "this", "that", "it", "its", "could", "be",
             "what", "you", "for", "by", "from", "which", "an", "a", "was", "were", "has", "have"}


def _words_of(text):
    return re.findall(r"[a-zà-ÿ]+", str(text).lower())


def is_indonesian(text):
    words = _words_of(text)
    id_hits = sum(w in _ID_WORDS for w in words)
    en_hits = sum(w in _EN_WORDS for w in words)
    return id_hits >= 3 and id_hits > en_hits


def looks_english(text):
    """For one short field: English function words outnumber Indonesian ones."""
    words = _words_of(text)
    en_hits = sum(w in _EN_WORDS for w in words)
    return en_hits >= 2 and en_hits > sum(w in _ID_WORDS for w in words)


def hook_copied_from_article(hook, article_text):
    """A short hook has too few function words to judge; an English hook is mostly words
    lifted straight from the English article, an Indonesian one mostly is not."""
    words = [w for w in _words_of(hook) if len(w) >= 3]
    if not words:
        return False
    article_words = set(_words_of(article_text))
    return sum(w in article_words for w in words) / len(words) >= 0.6


def _norm_number(raw):
    # A separator followed by exactly 3 digits is a thousands separator (8.700 / 8,700),
    # otherwise it is the decimal mark (1,5 / 1.5).
    parts = re.split(r"[.,]", raw)
    out = parts[0]
    for p in parts[1:]:
        out += p if len(p) == 3 else "." + p
    return out


def numbers_in(text):
    return {_norm_number(m) for m in re.findall(r"\d+(?:[.,]\d+)*", str(text))}


def _story_texts(data):
    texts = [str(data.get("hook") or "")]
    for b in data.get("beats") or []:
        if isinstance(b, dict):
            texts += [str(b.get("text") or ""), str(b.get("highlight") or "")]
    cap = data.get("caption") if isinstance(data.get("caption"), dict) else {}
    texts += [str(cap.get(k) or "") for k in ("opener", "body", "question", "save_line")]
    return texts


def check_story(data, article_text):
    """Returns (hard, soft). Hard = must not ship; soft = safely truncatable."""
    hard, soft = [], []
    hook = str(data.get("hook") or "").strip()
    if not hook:
        hard.append("missing 'hook'")
    elif len(hook.split()) > HOOK_MAX_WORDS:
        soft.append(f"hook is {len(hook.split())} words (> {HOOK_MAX_WORDS})")

    beats = data.get("beats")
    if not isinstance(beats, list) or len(beats) != len(ROLES):
        hard.append(f"need exactly {len(ROLES)} beats ({', '.join(ROLES)})")
        beats = beats if isinstance(beats, list) else []
    for i, b in enumerate(beats):
        if not isinstance(b, dict):
            hard.append(f"beat {i + 1} is not an object")
            continue
        if i < len(ROLES) and b.get("role") != ROLES[i]:
            hard.append(f"beat {i + 1} role must be '{ROLES[i]}', got {b.get('role')!r}")
        text = str(b.get("text") or "").strip()
        if not text:
            hard.append(f"beat {i + 1}: missing 'text'")
        elif len(text) > BEAT_MAX:
            soft.append(f"beat {i + 1} text {len(text)} chars (> {BEAT_MAX})")
        hl = str(b.get("highlight") or "").strip()
        if hl and hl not in text:
            hard.append(f"beat {i + 1}: highlight {hl!r} is not an exact substring of its text")

    prompts = data.get("image_prompts")
    if not isinstance(prompts, list) or len(prompts) != 4 or not all(str(p).strip() for p in prompts):
        hard.append("need exactly 4 non-empty image_prompts")

    cta = str(data.get("cta") or "").strip()
    if not cta:
        hard.append("missing 'cta'")
    elif len(cta) > CTA_MAX:
        soft.append(f"cta {len(cta)} chars (> {CTA_MAX})")

    cap = data.get("caption")
    if not isinstance(cap, dict):
        hard.append("'caption' must be an object")
    else:
        for k in ("opener", "body", "question", "save_line"):
            if not str(cap.get(k) or "").strip():
                hard.append(f"caption.{k} missing")
        if len(str(cap.get("opener") or "")) > OPENER_MAX:
            soft.append(f"caption.opener > {OPENER_MAX} chars")

    tags = data.get("hashtags")
    n_tags = len(tags) if isinstance(tags, list) else 0
    if n_tags < 3:
        hard.append(f"need {HASHTAGS_MIN}-{HASHTAGS_MAX} hashtags, got {n_tags}")
    elif not (HASHTAGS_MIN <= n_tags <= HASHTAGS_MAX):
        soft.append(f"{n_tags} hashtags (want {HASHTAGS_MIN}-{HASHTAGS_MAX})")

    # Language: judged per field — one Indonesian caption must not carry English beats.
    lang_errs = []
    if hook and (looks_english(hook) or hook_copied_from_article(hook, article_text)):
        lang_errs.append("hook")
    for i, b in enumerate(beats):
        if isinstance(b, dict) and looks_english(b.get("text")):
            lang_errs.append(f"beat {i + 1}")
        hl = str(b.get("highlight") or "") if isinstance(b, dict) else ""
        if hl and (looks_english(hl) or hook_copied_from_article(hl, article_text)):
            lang_errs.append(f"beat {i + 1} highlight")
    if cta and looks_english(cta):
        lang_errs.append("cta")
    cap_d = data.get("caption") if isinstance(data.get("caption"), dict) else {}
    for k in ("opener", "body", "question", "save_line"):
        if looks_english(cap_d.get(k)):
            lang_errs.append(f"caption.{k}")
    beats_text = " ".join(str(b.get("text") or "") for b in beats if isinstance(b, dict))
    if beats_text.strip() and not is_indonesian(beats_text):
        lang_errs.append("beats (overall)")
    if lang_errs:
        hard.append("must be written in Bahasa Indonesia, not English: " + ", ".join(dict.fromkeys(lang_errs)))

    allowed = numbers_in(article_text)
    invented = sorted({n for t in _story_texts(data) for n in numbers_in(t)} - allowed)
    if invented:
        hard.append("numbers not found in the article text (do not invent numbers): " + ", ".join(invented))
    return hard, soft


def _truncate(s, n):
    s = str(s or "").strip()
    if len(s) <= n:
        return s
    cut = s[: n - 1].rsplit(" ", 1)[0].rstrip(",;:—-")
    return cut + "…"


def apply_story_limits(data):
    data["hook"] = " ".join(str(data.get("hook") or "").split()[:HOOK_MAX_WORDS])
    for b in data.get("beats") or []:
        if isinstance(b, dict):
            text = _truncate(b.get("text"), BEAT_MAX)
            if b.get("highlight") and b["highlight"] not in text:
                b["highlight"] = ""
            b["text"] = text
    data["cta"] = _truncate(data.get("cta"), CTA_MAX)
    if isinstance(data.get("caption"), dict):
        data["caption"]["opener"] = _truncate(data["caption"].get("opener"), OPENER_MAX)
    tags = []
    for t in data.get("hashtags") or []:
        t = re.sub(r"\s+", "", str(t))
        if t:
            tags.append(t if t.startswith("#") else "#" + t)
    data["hashtags"] = tags[:HASHTAGS_MAX]


def build_caption(data, source, link):
    cap = data.get("caption") or {}
    parts = [str(cap.get(k) or "").strip() for k in ("opener", "body", "question", "save_line")]
    parts.append(f"Sumber: {source} ({link})")
    parts.append(" ".join(data.get("hashtags") or []))
    return "\n\n".join(p for p in parts if p)[:CAPTION_MAX]
