"""Per-account settings for the IG Reel pipeline (one JSON file per Instagram account).

Add an account: docs/ig-reel-add-account.md. Spec:
docs/superpowers/specs/2026-11-15-ig-reel-multi-account-design.md
"""
import json
import pathlib
import re

ACCOUNTS_DIR = pathlib.Path(__file__).resolve().parent / "accounts"
SLOTS = ("morning", "midday", "afternoon", "evening")
TOOLS = ("Claude", "ChatGPT", "Gemini")
MIN_THEMES = 8
MUSIC_STYLES = ("cinematic", "electronic")  # voices live in music.py STYLES
DEFAULT_MUSIC_STYLE = "cinematic"
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_STR_FIELDS = ("handle", "follow_line", "hook_kicker", "persona", "label", "buffer_channel_id", "buffer_org_id")
_MAY_BE_EMPTY = ("handle",)


def validate_account(cfg):
    """Human-readable problems with an account dict; empty list = valid."""
    errs = []
    for f in _STR_FIELDS:
        v = cfg.get(f)
        if not isinstance(v, str) or (not v.strip() and f not in _MAY_BE_EMPTY):
            errs.append(f"{f}: must be a non-empty string" if f not in _MAY_BE_EMPTY else f"{f}: must be a string")
    feeds = cfg.get("feeds")
    if not isinstance(feeds, list) or any(
            not (isinstance(f, list) and len(f) == 2 and all(isinstance(x, str) and x for x in f)
                 and f[1].startswith("https://")) for f in feeds):
        errs.append("feeds: must be a list of [name, https url]")
        feeds = []
    themes = cfg.get("themes")
    if not isinstance(themes, list) or any(
            not (isinstance(t, dict) and t.get("tool") in TOOLS and isinstance(t.get("topic"), str) and t["topic"].strip())
            for t in themes):
        errs.append(f"themes: must be a list of {{tool: {'|'.join(TOOLS)}, topic}}")
        themes = []
    elif themes and len(themes) < MIN_THEMES:
        errs.append(f"themes: need at least {MIN_THEMES} (or none), got {len(themes)}")
    weights = [t.get("weight", 1) if isinstance(t, dict) else 1 for t in themes]
    if any(not isinstance(w, int) or isinstance(w, bool) or not 1 <= w <= 3 for w in weights):
        errs.append("themes: weight must be an integer 1-3 (or omitted = 1)")
    else:  # a weight mix may not put the same theme in two of a day's four slots (the ring rotates, so it wraps)
        topics = [t["topic"] for t in theme_ring(themes)]
        if any(len({topics[(i + j) % len(topics)] for j in range(4)}) < 4 for i in range(len(topics))):
            errs.append("themes: weight mix would repeat a theme within one day — lower a weight or add themes")
    if not feeds and not themes:
        errs.append("account needs feeds or themes")
    slots = cfg.get("news_slots")
    if slots != "all" and not (isinstance(slots, list) and all(s in SLOTS for s in slots)):
        errs.append(f"news_slots: 'all' or a list of {SLOTS}")
    n = cfg.get("dedupe_posts")
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= 200:
        errs.append("dedupe_posts: integer 1-200")
    cloud = cfg.get("cloudinary_cloud_name")
    if cloud is not None and (not isinstance(cloud, str) or not cloud.strip()):
        errs.append("cloudinary_cloud_name: null (not pinned) or a non-empty string")
    age = cfg.get("news_max_age_days")
    if age is not None and (not isinstance(age, int) or isinstance(age, bool) or age < 1):
        errs.append("news_max_age_days: null (any age) or an integer >= 1")
    music = cfg.get("music")
    if music is not None:
        if not isinstance(music, dict):
            errs.append('music: must be an object like {"style": "' + "|".join(MUSIC_STYLES) + '"}')
        elif set(music) - {"style"}:
            errs.append("music: unknown key(s) " + ", ".join(sorted(set(music) - {"style"})) + '; only "style"')
        elif "style" in music and music["style"] not in MUSIC_STYLES:
            errs.append("music.style: must be one of " + ", ".join(MUSIC_STYLES))
    return errs


def music_style(cfg):
    """The account's synth style, used when its music_library folder has no track; accounts
    without a music block get the default."""
    return (cfg.get("music") or {}).get("style", DEFAULT_MUSIC_STYLE)


def load_account(account_id):
    if not isinstance(account_id, str) or not _ID_RE.match(account_id):
        raise ValueError(f"invalid account id {account_id!r} (lowercase letters, digits, dashes)")
    path = ACCOUNTS_DIR / f"{account_id}.json"
    if not path.is_file():
        known = sorted(p.stem for p in ACCOUNTS_DIR.glob("*.json"))
        raise ValueError(f"unknown account {account_id!r}; known: {', '.join(known)}")
    cfg = json.loads(path.read_text(encoding="utf-8"))
    errs = validate_account(cfg)
    if errs:
        raise ValueError(f"account {account_id}: " + "; ".join(errs))
    return {**cfg, "id": account_id}


def slot_name(hour_wib):
    return SLOTS[0] if hour_wib < 10 else SLOTS[1] if hour_wib < 14 else SLOTS[2] if hour_wib < 18 else SLOTS[3]


def theme_ring(themes):
    """Themes expanded by weight, round-robin: every theme once, then the weight-2 themes again.
    Round-robin (not blocks) keeps a day's four consecutive slots on four different themes."""
    if not themes:
        return []
    return [t for level in range(max(t.get("weight", 1) for t in themes))
            for t in themes if t.get("weight", 1) > level]


def pick_theme(ring, day, slot):
    if not ring:
        raise ValueError("empty theme ring: the account has no themes, so it has no tip mode")
    return ring[(day.toordinal() * 4 + SLOTS.index(slot)) % len(ring)]


def theme_plan(ring, day, slot, tries):
    """Up to `tries` themes from today's ring position, each topic once (the tip retry path).
    A retry steps a whole day of slots ahead, so it never reuses today's other slots."""
    if not ring:
        return []
    start = (day.toordinal() * 4 + SLOTS.index(slot)) % len(ring)
    out, seen = [], set()
    for step in range(len(ring)):
        theme = ring[(start + step * len(SLOTS)) % len(ring)]
        if theme["topic"] in seen:
            continue
        seen.add(theme["topic"])
        out.append(theme)
        if len(out) == tries:
            break
    return out


def wants_news(cfg, slot):
    return cfg["news_slots"] == "all" or slot in cfg["news_slots"]


def account_target_errors(account, cloud_name):
    """Why this run must not post: the account is not set up, or the Cloudinary secrets it
    received belong to another account. Empty list = safe to post.
    Buffer needs no check here: a post always goes to the pinned buffer_channel_id, and Buffer
    itself rejects a token that does not own that channel."""
    errs = []
    if not account["handle"].strip():
        errs.append("handle is empty in the account file")
    if account["cloudinary_cloud_name"] is not None and cloud_name != account["cloudinary_cloud_name"]:
        errs.append("CLOUDINARY_CLOUD_NAME does not match the account's cloudinary_cloud_name")
    return errs
