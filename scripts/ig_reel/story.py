"""Story selection helpers, grounding validator and caption builder for the daily Reel.

Pure functions (no network): the orchestrator (scripts/ig_reel_daily.py) does the I/O.
Grounding rule: every number the AI writes must appear in the fetched article text.
"""
import datetime as _dt
import email.utils as _eu
from decimal import Decimal, InvalidOperation
import html as _html
import re
import unicodedata as _ud
import urllib.parse as _up

ROLES = ("context", "twist", "why", "payoff")
MOODS = ("curious", "wonder", "energetic", "mysterious", "uplifting")  # soundtrack mood, see music.py
HOOK_MAX_WORDS = 7
BEAT_MAX = 120
CTA_MAX = 60
OPENER_MAX = 120
CAPTION_MAX = 2200
SAMPLE_PROMPT_MAX = 400
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
 "mood": "satu dari: curious | wonder | energetic | mysterious | uplifting — suasana cerita ini, untuk musik latar",
 "image_prompts": ["4 prompt bahasa Inggris: hook, context, twist, why/payoff — subjek sama, tanpa teks"],
 "caption": {"opener": "hook diparafrase, maks 120 karakter", "body": "2–3 baris pendek",
             "question": "1 pertanyaan untuk komentar", "save_line": "ajakan simpan/kirim"},
 "hashtags": ["5–8 hashtag: umum + niche + bahasa Indonesia"],
 "sample_prompt": "khusus tips: prompt lengkap siap salin, Bahasa Indonesia, maks 400 karakter; berita: kosongkan"}"""


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


def age_days(raw, now):
    """Age of an RSS (RFC 822) or Atom (ISO 8601) date in days; None when unparseable."""
    raw = (raw or "").strip()
    try:
        when = _eu.parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        try:
            when = _dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=_dt.timezone.utc)
    return (now - when).total_seconds() / 86400


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


_DROP = re.compile(r"<(script|style|nav|header|footer|aside|noscript|svg)\b[^>]*>.*?</\1\s*>", re.S | re.I)


def extract_article_text(page_html):
    """Readable paragraph text of an article page (nav/scripts dropped), capped."""
    cleaned = _DROP.sub(" ", str(page_html))
    paras = []
    for m in re.finditer(r"<p\b[^>]*>(.*?)</p\s*>", cleaned, re.S | re.I):
        text = re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", m.group(1)))).strip()
        if text:
            paras.append(text)
    return "\n".join(paras)[:ARTICLE_MAX]


def feed_body(raw, cap):
    """Paragraph text of a feed item's full-text field (content:encoded), capped.

    Same <p>-only rule as the page: feeds append teasers for other stories outside paragraphs."""
    return extract_article_text(raw or "")[:cap]


def order_by_source(refs, sources):
    """Reorder ranked 1-based refs round-robin by source, so one unreadable site can't fill the top."""
    left, out = list(refs), []
    while left:
        seen = set()
        for r in list(left):
            if sources[r - 1] not in seen:
                seen.add(sources[r - 1])
                out.append(r)
                left.remove(r)
    return out


def grounding_text(body, fetch_page, min_chars):
    """The feed's own article text when it is long enough, else the fetched page."""
    return body if len(body) >= min_chars else fetch_page()


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


def copied_from_article(text, article_text, min_words):
    """A short field has too few function words to judge; English copy is mostly ordinary
    words lifted straight from the English article. Proper nouns (capitalised after the
    first token, e.g. "James Webb") and tokens with digits ("WASP-127b") are ignored, and
    fields with fewer than `min_words` ordinary words are not judged at all."""
    words = []
    for i, tok in enumerate(str(text).split()):
        w = tok.strip(".,;:!?\"'()[]—-…")
        if not w or any(ch.isdigit() for ch in w) or (i > 0 and w[:1].isupper()):
            continue
        w = w.lower()
        if len(w) >= 3 and w.isalpha():
            words.append(w)
    if len(words) < min_words:
        return False
    article_words = set(_words_of(article_text))
    return sum(w in article_words for w in words) / len(words) >= 0.75


def hook_phrases(data):
    """hook_highlight as a list (models sometimes return a single string)."""
    hl = data.get("hook_highlight")
    if isinstance(hl, str):
        hl = [hl]
    return [str(p).strip() for p in (hl if isinstance(hl, list) else []) if str(p).strip()]


def _norm_number(raw):
    # A separator followed by exactly 3 digits is a thousands separator (8.700 / 8,700),
    # otherwise it is the decimal mark (1,5 / 1.5).
    parts = re.split(r"[.,]", raw)
    out = parts[0]
    for p in parts[1:]:
        out += p if len(p) == 3 else "." + p
    return out


_SCALES = {"ribu": 10 ** 3, "thousand": 10 ** 3, "juta": 10 ** 6, "million": 10 ** 6,
           "miliar": 10 ** 9, "milyar": 10 ** 9, "billion": 10 ** 9, "triliun": 10 ** 12, "trillion": 10 ** 12}
_NUM_RE = re.compile(r"(\d+(?:[.,]\d+)*)(?:\s*(" + "|".join(_SCALES) + r")\b)?", re.I)


def numbers_in(text, keep_raw=True):
    """Normalised numbers in `text`. "33 ribu" / "33 thousand" also yield 33000. With
    keep_raw=False (story side) a scaled number yields ONLY its scaled value, so
    "1,5 miliar" can't be licensed by an article's "1.5 million"."""
    out = set()
    for raw, scale in _NUM_RE.findall(str(text)):
        value = _norm_number(raw)
        if scale:
            try:
                scaled = Decimal(value) * _SCALES[scale.lower()]
                out.add(format(scaled.quantize(Decimal(1)) if scaled == scaled.to_integral() else scaled.normalize(), "f"))
            except InvalidOperation:
                pass
            if keep_raw:
                out.add(value)
        else:
            out.add(value)
    return out


def _story_texts(data, include_sample=False):
    texts = [str(data.get("hook") or "")]
    for b in data.get("beats") or []:
        if isinstance(b, dict):
            texts += [str(b.get("text") or ""), str(b.get("highlight") or "")]
    cap = data.get("caption") if isinstance(data.get("caption"), dict) else {}
    texts += [str(cap.get(k) or "") for k in ("opener", "body", "question", "save_line")]
    texts += [str(data.get("cta") or "")] + ([str(data.get("sample_prompt") or "")] if include_sample else []) + hook_phrases(data)
    return texts


_TIP_MONEY = re.compile(r"(\bRp\.?\s*\d|\$\s*\d|\bUSD\b|\brupiah\b|\bdolar\b|\bdollars?\b)", re.I)
_TIP_PERCENT = re.compile(r"(\d\s*%|\bpersen\b)", re.I)
_TIP_VERSION = re.compile(r"(\b(?:GPT|Claude|Gemini)[- ]?\d|\bo\d\b|\b(?:Opus|Sonnet|Haiku|Turbo)\b)", re.I)
TIP_MAX_NUMBER = 10


def tip_rule_errors(texts):
    """A tip has no source article, so it may not state what an AI gets wrong about itself:
    prices, percentages, big numbers (limits, dates) and model version names."""
    errs = []
    joined = " \n ".join(str(t) for t in texts)
    if _TIP_MONEY.search(joined):
        errs.append("tip must not mention prices or currency amounts")
    if _TIP_PERCENT.search(joined):
        errs.append("tip must not mention percentages")
    if _TIP_VERSION.search(joined):
        errs.append("tip must not name model versions (say only Claude or ChatGPT)")
    big = sorted({n for n in re.findall(r"\d+", joined) if int(n) > TIP_MAX_NUMBER}, key=int)
    if big:
        errs.append(f"tip must not contain numbers above {TIP_MAX_NUMBER}: " + ", ".join(big))
    return errs


def check_story(data, article_text, extra_allowed=(), mode="news"):
    """Returns (hard, soft). Hard = must not ship; soft = safely truncatable.
    mode="tip": no source article — tip_rule_errors() replaces the number grounding.
    extra_allowed: numbers known from outside the article text (e.g. the RSS date's year)."""
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
        hl = str(b.get("highlight") if b.get("highlight") is not None else "").strip()
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
    if hook and (looks_english(hook) or copied_from_article(hook, article_text, 3)):
        lang_errs.append("hook")
    for i, b in enumerate(beats):
        if isinstance(b, dict) and looks_english(b.get("text")):
            lang_errs.append(f"beat {i + 1}")
        hl = str(b.get("highlight") if b.get("highlight") is not None else "") if isinstance(b, dict) else ""
        if hl and (looks_english(hl) or copied_from_article(hl, article_text, 2)):
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

    if mode == "tip":
        sp = str(data.get("sample_prompt") or "").strip()
        if not sp:
            hard.append("missing 'sample_prompt' (the full ready-to-copy prompt for the caption)")
        else:
            if looks_english(sp):
                hard.append("must be written in Bahasa Indonesia, not English: sample_prompt")
            if len(sp) > SAMPLE_PROMPT_MAX:
                soft.append(f"sample_prompt {len(sp)} chars (> {SAMPLE_PROMPT_MAX})")
        return hard + tip_rule_errors(_story_texts(data, include_sample=True)), soft
    allowed = numbers_in(article_text) | {str(n) for n in extra_allowed}
    invented = sorted({n for t in _story_texts(data) for n in numbers_in(t, keep_raw=False)} - allowed)
    if invented:
        hard.append("numbers not found in the article text (do not invent numbers): " + ", ".join(invented))
    return hard, soft


def _truncate(s, n):
    s = str(s or "").strip()
    if len(s) <= n:
        return s
    cut = s[: n - 1].rsplit(" ", 1)[0].rstrip(",;:—-")
    return cut + "…"


def normalize_mood(raw):
    """A name from MOODS, or "" (the soundtrack then picks one from the seed). Never an error."""
    mood = raw.strip().lower() if isinstance(raw, str) else ""
    return mood if mood in MOODS else ""


def apply_story_limits(data, mode="news"):
    """Truncate soft issues in place. mode="news" drops any sample_prompt (only tips carry one)."""
    data["hook"] = " ".join(str(data.get("hook") or "").split()[:HOOK_MAX_WORDS])
    hook_l = data["hook"].lower()
    data["hook_highlight"] = [p for p in hook_phrases(data)
                              if re.search(r"(?<!\w)" + re.escape(p.lower()) + r"(?!\w)", hook_l)]
    for b in data.get("beats") or []:
        if isinstance(b, dict):
            text = _truncate(b.get("text"), BEAT_MAX)
            hl = str(b.get("highlight") if b.get("highlight") is not None else "").strip()
            b["highlight"] = hl if hl and hl in text else ""
            b["text"] = text
    data["cta"] = _truncate(data.get("cta"), CTA_MAX)
    data["sample_prompt"] = _truncate(data.get("sample_prompt"), SAMPLE_PROMPT_MAX) if mode == "tip" else ""
    data["mood"] = normalize_mood(data.get("mood"))
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
    head = [str(cap.get("opener") or "").strip()]
    sp = str(data.get("sample_prompt") or "").strip()
    if sp:  # right after the opener, so it survives the CAPTION_MAX cut
        head.append("📋 Salin prompt ini:\n" + sp)
    parts = head + [str(cap.get(k) or "").strip() for k in ("body", "question", "save_line")]
    if link:  # a tip has no source article
        parts.append(f"Sumber: {source} ({link})")
    parts.append(" ".join(data.get("hashtags") or []))
    return "\n\n".join(p for p in parts if p)[:CAPTION_MAX]


_TRACKING_PARAMS = {"ref", "source", "fbclid", "gclid", "igshid", "mc_cid", "mc_eid"}
_DEDUPE_STOPWORDS = {"the", "and", "dan", "yang"}


def canonical_url(raw_url: str) -> str:
    if not isinstance(raw_url, str):
        return ""
    trimmed = raw_url.strip()
    if not trimmed:
        return ""
    try:
        u = _up.urlsplit(trimmed)
        port = u.port
    except ValueError:
        return ""
    scheme = u.scheme.lower()
    if scheme not in ("http", "https"):
        return ""
    hostname = (u.hostname or "").lower()
    if not hostname:
        return ""
    host = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        netloc = f"{host}:{port}"
    else:
        netloc = host
    path = u.path.rstrip("/") or "/"
    kept = [
        (k, v) for k, v in _up.parse_qsl(u.query, keep_blank_values=True)
        if not k.lower().startswith("utm_") and k.lower() not in _TRACKING_PARAMS
    ]
    kept.sort(key=lambda kv: (kv[0], kv[1]))
    query = _up.urlencode(kept) if kept else ""
    return _up.urlunsplit((scheme, netloc, path, query, ""))


def normalize_title(text: str) -> str:
    s = _ud.normalize("NFKD", _html.unescape(str(text or "")))
    s = "".join(ch for ch in s if _ud.category(ch) != "Mn").lower()
    return " ".join(re.sub(r"(?:[^\w]|_)+", " ", s).split())


def _stem(word: str) -> str:
    w = word
    if len(w) > 4 and w.endswith("ies"):
        w = w[:-3] + "y"
    elif len(w) > 3 and w.endswith("s") and not re.search(r"(ss|us|is)$", w):
        w = w[:-1]
    if len(w) > 5 and w.endswith("ing"):
        w = w[:-3]
    elif len(w) > 4 and w.endswith("ed"):
        w = w[:-2]
    if len(w) > 6 and w.endswith("ation"):
        w = w[:-5] + "at"
    elif len(w) > 5 and w.endswith("ion"):
        w = w[:-3]
    if len(w) > 3 and w.endswith("e"):
        w = w[:-1]
    return w


def _stemmed_tokens(normalized: str) -> set[str]:
    return {_stem(w) for w in normalized.split() if len(w) >= 3 and w not in _DEDUPE_STOPWORDS}


def is_similar_title(a: str, b: str) -> bool:
    na = normalize_title(a)
    nb = normalize_title(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    ta = _stemmed_tokens(na)
    tb = _stemmed_tokens(nb)
    if not ta or not tb:
        return False
    shared = len(ta & tb)
    # shortcut: lexical only, so paraphrase with no shared words slips through.
    # Upgrade to an AI judge over the 5 nearest titles if that still bites.
    return shared >= 2 and shared / min(len(ta), len(tb)) >= 0.7


def extract_buffer_seen(captions: list[str]) -> tuple[set[str], list[str]]:
    seen_urls: set[str] = set()
    seen_hooks: list[str] = []
    for cap in captions or []:
        text = str(cap or "").strip()
        if not text:
            continue
        first_line = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
        if first_line:
            seen_hooks.append(first_line)
        for m in re.finditer(r"Sumber:\s*[^\n]*\((https?://[^)\s]+)\)", text, re.I):
            u = canonical_url(m.group(1))
            if u:
                seen_urls.add(u)
    return seen_urls, seen_hooks


def extract_buffer_prompts(captions: list[str]) -> list[str]:
    prompts: list[str] = []
    marker = "📋 Salin prompt ini:\n"
    for cap in captions or []:
        text = str(cap or "")
        idx = text.find(marker)
        if idx != -1:
            para = text[idx + len(marker):].split("\n\n", 1)[0].strip()
            if para:
                prompts.append(para)
    return prompts


def filter_unseen_news(candidates: list[dict], seen_urls: set[str], seen_titles: list[str]) -> list[dict]:
    out = []
    for c in candidates or []:
        cu = canonical_url(str(c.get("link") or ""))
        if cu and cu in seen_urls:
            continue
        title = str(c.get("title") or "")
        if title and any(is_similar_title(title, t) for t in seen_titles):
            continue
        out.append(c)
    return out


def tip_duplicate_error(data: dict, seen_hooks: list[str], seen_prompts: list[str]) -> str | None:
    hook = str(data.get("hook") or "").strip()
    if hook and any(is_similar_title(hook, h) for h in seen_hooks):
        return f"duplicate tip hook (matches recent post): {hook[:80]}"
    sp = str(data.get("sample_prompt") or "").strip()
    if sp and any(is_similar_title(sp, p) for p in seen_prompts):
        return f"duplicate sample_prompt (matches recent post): {sp[:80]}"
    return None
