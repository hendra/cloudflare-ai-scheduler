# IG Reel Multi-Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Reel workflow and script serve any number of Instagram accounts, and a second account `ai-labs` posts Claude/ChatGPT tips (announcement in the morning slot when one exists, otherwise a theme tip).

**Architecture:** A settings file per account (`scripts/ig_reel/accounts/<id>.json`) is loaded from the `ACCOUNT` env var and replaces every hard-coded @kaliajatau.id value. Secrets come from a GitHub environment `ig-<account>` under today's secret names. A second story mode (`tip`) reuses the six scenes, the renderer and the language check, with its own accuracy rules instead of source grounding.

**Tech Stack:** Python 3.11 stdlib + pillow/numpy/scipy/playwright (already pinned), GitHub Actions, Cloudflare D1 migration. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-15-ig-reel-multi-account-design.md`

## Global Constraints

- `scripts/ig-kit/` stays byte-identical. No file there is edited.
- No automated test runner: every test is an assertion block added to `scripts/ig_reel/selfcheck.py`, run with `python3 scripts/ig_reel/selfcheck.py` (expected last line: `ig_reel selfcheck: all assertions passed`).
- @kaliajatau.id behaviour and its D1 rows `ig-reel-daily*` do not change. Default account is `kaliajatau`.
- All on-screen and caption text stays Bahasa Indonesia; the existing language check applies in both modes.
- Never commit to `main`; one PR with `## Summary`, `## What changed`, `## Verification`.
- Do not add secrets, create GitHub environments, apply migrations remotely, enable D1 rows, or run with `dry_run=false`. Those are owner steps (Task 6 lists them).
- Feeds are parsed with the stdlib XML parser already used by `fetch_candidates()`; a security hook may flag it. Do not add a parser dependency.
- New D1 rows ship `enabled=0`.

## Review Focus

1. `ACCOUNT` set to an unknown or malformed id (`../x`, empty, uppercase): run fails before any network call with a clear message. (Task 1)
2. Real run with empty `handle`: refuses to post; dry run still renders. (Task 2)
3. Secrets of another account in the environment (cloud name differs from the pinned one, or the Buffer token cannot see the pinned channel): real run fails before upload. (Task 2)
4. Morning slot with every feed down, or no story passing grounding: falls through to a tip instead of failing. (Task 3)
5. Atom feed (`releases.atom`) and feed items with short bodies: parsed without error; a too-short item is skipped, not fatal. (Task 3)

---

### Task 1: Account settings

**Files:**
- Create: `scripts/ig_reel/accounts.py`, `scripts/ig_reel/accounts/kaliajatau.json`, `scripts/ig_reel/accounts/ai-labs.json`
- Test: `scripts/ig_reel/selfcheck.py` (new section `# ---------- accounts ----------` before `# ---------- timeline ----------`)

**Interfaces — Produces:**
- `load_account(account_id: str) -> dict` — raises `ValueError` on an id not matching `^[a-z0-9][a-z0-9-]*$`, a missing file, or validation errors. Returned dict has key `id` plus the file's fields.
- `validate_account(cfg: dict) -> list[str]` — human-readable errors, empty when valid.
- `SLOTS = ("morning", "midday", "afternoon", "evening")`; `slot_name(hour_wib: int) -> str` — `<10` morning, `<14` midday, `<18` afternoon, else evening.
- `pick_theme(themes: list[dict], day: datetime.date, slot: str) -> dict` — `themes[(day.toordinal() * 4 + SLOTS.index(slot)) % len(themes)]`.
- `wants_news(cfg: dict, slot: str) -> bool` — `news_slots == "all"` or `slot in news_slots`.

Account file fields (all required): `handle` (str, may be `""`), `follow_line` (str), `persona` (str), `label` (str), `feeds` (list of `[name, url]`, urls `https://`), `news_slots` (`"all"` or list of slot names), `themes` (list of `{"tool": "Claude"|"ChatGPT", "topic": str}`, may be empty), `dedupe_posts` (int 1–200), `buffer_channel_id`, `buffer_org_id`, `cloudinary_cloud_name` (non-empty strings). Validation also requires: `feeds` or `themes` non-empty; `themes` empty or at least 8 entries.

- [ ] **Step 1: Write the failing assertions**

```python
from ig_reel.accounts import load_account, validate_account, slot_name, pick_theme, wants_news, SLOTS
import datetime as _d
k = load_account("kaliajatau")
assert k["handle"] == "@kaliajatau.id" and k["news_slots"] == "all" and k["themes"] == []
assert k["follow_line"] == "Ikuti @kaliajatau.id buat fakta gila berikutnya"
assert k["dedupe_posts"] == 28 and k["cloudinary_cloud_name"] == "opqimovw"
assert k["buffer_channel_id"] == "6aed5544e29c69a1717ba62e" and k["buffer_org_id"] == "6aed53e7ec5c7c6d73f3e437"
assert [n for n, _ in k["feeds"]] == ["ScienceDaily", "MIT News", "NASA"]
a = load_account("ai-labs")
assert a["news_slots"] == ["morning"] and a["dedupe_posts"] == 120 and len(a["themes"]) >= 20
assert {t["tool"] for t in a["themes"]} == {"Claude", "ChatGPT"}
for bad in ("", "../x", "Kaliajatau", "nope"):
    try: load_account(bad); raise AssertionError(bad)
    except ValueError: pass
assert validate_account({**k, "feeds": [], "themes": []})
assert validate_account({**a, "themes": a["themes"][:3]})
assert [slot_name(h) for h in (8, 11, 16, 19)] == list(SLOTS)
day = _d.date(2026, 11, 16)
assert len({pick_theme(a["themes"], day, s)["topic"] for s in SLOTS}) == 4
assert wants_news(k, "evening") and wants_news(a, "morning") and not wants_news(a, "midday")
```

- [ ] **Step 2: Run** `python3 scripts/ig_reel/selfcheck.py` — expected: `ModuleNotFoundError: ig_reel.accounts`.
- [ ] **Step 3: Implement `accounts.py` and both JSON files.** `kaliajatau.json` copies today's values: feeds from `RSS_FEEDS` in `scripts/ig_reel_daily.py:97`, `persona`: `"Reel sains @kaliajatau.id (gaya dokumenter sinematik, Bahasa Indonesia santai tapi kredibel)"`, `label`: `"IG Reel @kaliajatau.id"`. `ai-labs.json`: `handle` `""`, `follow_line` `"Ikuti buat tips AI berikutnya"` (owner rewrites when the handle exists), `persona` `"Reel tips & trik AI (Claude dan ChatGPT) untuk pemula, Bahasa Indonesia santai dan praktis"`, `label` `"IG Reel ai-labs"`, feeds `["OpenAI", "https://openai.com/news/rss.xml"]` and `["Claude Code", "https://github.com/anthropics/claude-code/releases.atom"]`, `buffer_channel_id` / `buffer_org_id` / `cloudinary_cloud_name` `"TODO-owner"` (the guard in Task 2 makes this unpostable), 20+ themes alternating tool, topics in Indonesian covering prompt technique, writing, coding, study, work, research.
- [ ] **Step 4: Run selfcheck** — expected: all assertions passed.
- [ ] **Step 5: Commit** `feat(ig-reel): account settings files and loader`.

### Task 2: Pipeline reads the account (no behaviour change for kaliajatau)

**Files:**
- Modify: `scripts/ig_reel_daily.py` (config block 45–100, `fail` 126, `recent_post_captions` 183, `fetch_candidates` 203, prompts in `pick_shortlist` 300 and `write_story` 361, `main` 635)
- Modify: `scripts/ig_reel/scenes.py` (`FOLLOW_LINE` 15, `scene_html` 114–168)
- Test: `scripts/ig_reel/selfcheck.py`

**Interfaces:**
- Consumes: `load_account`, `slot_name` (Task 1).
- Produces: module global `ACCOUNT: dict` in `ig_reel_daily.py` (from env `ACCOUNT`, default `kaliajatau`); `meta` dict passed to `render_reel` / `scene_html` gains required key `follow_line` and optional keys `source_label` (default `"Sumber"`) and `kickers` (default `KICKERS`); `verify_account_targets() -> None` (calls `fail` on mismatch).

- [ ] **Step 1: Update the scene assertions.** In selfcheck replace `assert FOLLOW_LINE == …` with a `META` that carries `"follow_line": "Ikuti @tes buat tips"`, assert that text and `"@tes"` handle appear in the cta/hook HTML, and that no scene HTML contains `kaliajatau`. Add `"follow_line"` to the two render `meta` dicts (lines ~286, ~304).
- [ ] **Step 2: Run selfcheck** — expected: fails on the missing `follow_line` support.
- [ ] **Step 3: scenes.py:** delete `FOLLOW_LINE`; read `meta["follow_line"]`, `meta.get("source_label", "Sumber")`, `meta.get("kickers", KICKERS)`.
- [ ] **Step 4: ig_reel_daily.py:** replace `RSS_FEEDS`, `DEDUPE_POSTS`, `BUFFER_CHANNEL`, `BUFFER_ORG`, the `"@kaliajatau.id"` literals and both prompt openers (`Kamu produser {persona}.` / `Kamu penulis naskah {persona}.`) with `ACCOUNT` values; drop the code defaults for the Buffer IDs and `CLOUD_NAME` (cloud name still comes from env). `recent_post_captions()` pages Buffer until `dedupe_posts` texts or no next page (check the `posts` connection's `pageInfo`/`after` in the existing query's schema). `fail()` Slack text and the workflow failure note start with `ACCOUNT["label"]`. Log line at start: account id, slot, and for each of OpenCode/OpenRouter/Groq/Cloudflare/Pollinations/Cloudinary/Buffer `set` or `unset` (never values).
- [ ] **Step 5: `verify_account_targets()`**, called in `main()` right after the dry-run return: fail if `ACCOUNT["handle"]` is empty; fail if `CLOUD_NAME != ACCOUNT["cloudinary_cloud_name"]`; fail unless a Buffer GraphQL query for the organisation's channels returns `ACCOUNT["buffer_channel_id"]`. In a dry run call a non-failing variant that only logs the three results (Buffer check skipped when the token is unset).
- [ ] **Step 6: Selfcheck for the guard.** Extract the pure part as `account_target_errors(account: dict, cloud_name: str, visible_channel_ids: list[str]) -> list[str]` in `accounts.py` and assert: empty for matching kaliajatau values; one error each for empty handle, wrong cloud name, channel not in list; three errors for `ai-labs` as shipped.
- [ ] **Step 7: Run selfcheck, then** `ACCOUNT=kaliajatau DRY_RUN=true PLACEHOLDER_IMAGES=true python3 scripts/ig_reel_daily.py` — expected: a `REPORT {"status": "dry-run"…}` line and the caption still signed @kaliajatau.id. (Needs an AI key in the shell; if none, note it and rely on the CI dry run in Task 6.)
- [ ] **Step 8: Commit** `refactor(ig-reel): pipeline reads handle, feeds and targets from the account file`.

### Task 3: Tip mode

**Files:**
- Modify: `scripts/ig_reel/story.py` (`check_story` 208, `build_caption` 323), `scripts/ig_reel/scenes.py` (add `TIP_KICKERS`), `scripts/ig_reel_daily.py` (new `write_tip`, `main`)
- Test: `scripts/ig_reel/selfcheck.py`

**Interfaces:**
- Consumes: `pick_theme`, `wants_news`, `slot_name`, `ACCOUNT`, `meta` keys (Tasks 1–2).
- Produces: `check_story(data, article_text, extra_allowed=(), mode="news")` — `mode="tip"` skips number grounding and copied-from-article checks and applies the tip rules; same return shape as today. `build_caption(data, source, link)` omits the source/link line when `link` is `None`. `TIP_KICKERS = {"context": "MASALAHNYA", "twist": "TRIKNYA", "why": "CONTOH PROMPT", "payoff": "HASILNYA"}`. `write_tip(theme: dict, avoid: list[str]) -> dict` — same story dict shape as `write_story` (roles keep their internal names). Env `MODE` = `auto` (default) | `news` | `tip`.

Tip rules (hard failures, checked over hook, beats, highlights, cta, caption):
- any currency amount (`Rp`, `$`, `USD`, `ribu rupiah` …) or percentage;
- any number above 10;
- any model version name: regex `\b(GPT|Claude|Gemini|o)[- ]?\d` (case-insensitive) plus `\b(Opus|Sonnet|Haiku|Turbo)\b`.

- [ ] **Step 1: Write the failing assertions**: a clean Indonesian tip story passes `check_story(tip, "", mode="tip")`; variants with `"Rp 300.000"`, `"50%"`, `"GPT-4"`, `"Claude 3.5"`, `"Sonnet"`, `"25 langkah"` each fail with a message naming the rule; `"3 langkah"` passes; an English beat still fails the language check in tip mode; `build_caption(tip, "Claude", None)` contains no `http`; `scene_html("context", tip, imgs, {**META, "kickers": TIP_KICKERS, "source_label": "Tips"})` contains `MASALAHNYA` and `Tips: Claude`.
- [ ] **Step 2: Run selfcheck** — expected: `TypeError` on `mode`.
- [ ] **Step 3: Implement** the `mode` branch, `TIP_KICKERS`, the caption change.
- [ ] **Step 4: `write_tip`:** prompt opens `Kamu penulis naskah {persona}.`, gives `theme["tool"]` and `theme["topic"]`, the `avoid` texts as "jangan ulangi", `STORY_SCHEMA_HINT`, and the tip rules in Indonesian (beats: masalah → trik → contoh prompt siap salin → hasil; no harga, batas, nama versi, lokasi menu). Validate with `check_story(..., mode="tip")`, same retry count as `write_story`.
- [ ] **Step 5: `main()` flow.** `slot = slot_name(NOW.hour)`. Try news when `MODE == "news"` or (`MODE == "auto"` and `wants_news(ACCOUNT, slot)` and `ACCOUNT["feeds"]`): today's loop, but with fewer than 6 candidates or no valid story it only calls `fail` when the account has no themes or `MODE == "news"`; otherwise log the reasons and fall through. Tip path: `theme = pick_theme(ACCOUNT["themes"], NOW.date(), slot)`, `story = write_tip(theme, recent)`, meta `{"source": theme["tool"], "date": format_date_id of today, "source_label": "Tips", "kickers": TIP_KICKERS, …}`, caption with `link=None`, report `sources: ["tip: <tool> — <topic>"]` and a new report key `"mode"` in both modes. `MODE == "tip"` on an account without themes fails.
- [ ] **Step 6: Feed robustness assertions (Review Focus 4–5).** Factor the per-feed XML parsing of `fetch_candidates()` into `parse_feed(source: str, raw: bytes) -> list[dict]` if it is not already separable, and assert on two inline samples: a minimal Atom document (`<feed><entry><title/><link href=…/><updated/><content/></entry></feed>`) yields one item with title, link and date; malformed XML returns `[]` or raises an exception that `fetch_candidates` already catches per feed.
- [ ] **Step 7: Run selfcheck**, then `ACCOUNT=ai-labs MODE=tip DRY_RUN=true PLACEHOLDER_IMAGES=true python3 scripts/ig_reel_daily.py` — expected: `REPORT` with `"mode": "tip"`; open `.ig-reel-out/frames_sample/*.jpg` and confirm the tip kickers render.
- [ ] **Step 8: Commit** `feat(ig-reel): tip story mode for theme-driven accounts`.

### Task 4: Workflow

**Files:** Modify `.github/workflows/ig-reel.yml`.

- [ ] **Step 1:** Add inputs `account` (string, default `kaliajatau`) and `mode` (choice `auto|news|tip`, default `auto`, description "Dev only"). Job: `environment: ig-${{ inputs.account || 'kaliajatau' }}`; `concurrency.group: ig-reel-${{ inputs.account || 'kaliajatau' }}`; env `ACCOUNT` and `MODE`; remove `BUFFER_CHANNEL_ID` / `BUFFER_ORG_ID` env lines; add `KILO_API_KEY: ${{ secrets.KILO_API_KEY }}` only if it is already listed (it is not today; leave out). Artifact name `ig-reel-dry-run-${{ inputs.account || 'kaliajatau' }}`. Failure-note text starts with the account id. Update the header comment (accounts, modes, spec path).
- [ ] **Step 2: Validate** with `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ig-reel.yml'))"` (or `actionlint` if installed) — expected: no error.
- [ ] **Step 3: Commit** `feat(ig-reel): workflow takes an account and runs in its environment`.

### Task 5: Schedule rows and docs

**Files:**
- Create: `migrations/0020_ig_reel_ai_labs.sql`, `docs/ig-reel-add-account.md`
- Modify: `docs/status.md`, `AGENTS.md`, `prompts/ig-reel-daily.md` (one line: accounts now come from `scripts/ig_reel/accounts/`)

- [ ] **Step 1: Migration.** `INSERT OR IGNORE` four rows `ig-reel-ai-labs`, `ig-reel-ai-labs-1145`, `ig-reel-ai-labs-1635`, `ig-reel-ai-labs-1930`; crons `15 1 * * *`, `45 4 * * *`, `35 9 * * *`, `30 12 * * *`; `enabled=0`; `job_type='github_actions_trigger'`; `timezone='Asia/Jakarta'`; `priority=5`; `input_json='{"owner":"hendra","repo":"cloudflare-ai-scheduler","workflow":"ig-reel.yml","ref":"main","inputs":{"dry_run":false,"account":"ai-labs"}}'`; `next_run_at='2099-01-01T00:00:00.000Z'` with a comment that go-live sets the real value. Copy the column list from `migrations/0017_scheduler_multi_daily.sql`.
- [ ] **Step 2: Apply locally** `npm run db:migrate:local` then `npx wrangler d1 execute scheduler-db --local --command "SELECT id, enabled, cron_expression FROM schedulers WHERE id LIKE 'ig-reel-ai-labs%'"` — expected: four rows, `enabled` 0. (Database name: confirm in `wrangler.template.jsonc`.)
- [ ] **Step 3: `docs/ig-reel-add-account.md`** — checklist: copy an account file and fill it; create environment `ig-<id>` with `BUFFER_ACCESS_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `POLLINATIONS_SECRET_KEY`; dry-run dispatch and read the `set/unset` + guard log lines; add four D1 rows disabled; go live (set `next_run_at` to the first future slot in UTC, then `enabled=1`). State the known limit: a missing AI or image key falls back to the repo-level key.
- [ ] **Step 4: Update `docs/status.md`** (row table with the four disabled rows, secrets inventory, a new gotcha 29 summarising accounts + tip mode + guard) and `AGENTS.md` (IG Reel line, D1 rows line).
- [ ] **Step 5: Commit** `feat(ig-reel): ai-labs schedule rows (disabled) and add-account guide`.

### Task 6: Verify and open the PR

- [ ] **Step 1:** `python3 scripts/ig_reel/selfcheck.py` and `npm run typecheck` — both pass. `git diff main -- scripts/ig-kit` — empty. `git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .` — empty.
- [ ] **Step 2:** Push the branch and dispatch three dry runs on it: `gh workflow run ig-reel.yml --ref <branch> -f dry_run=true` (kaliajatau, expect `"mode": "news"` and today's look), `… -f account=ai-labs -f mode=tip`, `… -f account=ai-labs -f mode=news`. Run them in the background, read each `REPORT` line, download one artifact per account and look at the frames. `ai-labs` uses repo-level keys until its environment exists; the log must show the guard reporting three mismatches without failing the dry run.
- [ ] **Step 3:** Open the PR with real outcomes in `## Verification`, and `## Owner steps after merge`: create environment `ig-ai-labs` and its secrets; fill `handle`, `follow_line`, Buffer IDs and cloud name in `ai-labs.json` (small follow-up PR); `npm run db:migrate:remote`; dry run; go live per `docs/ig-reel-add-account.md`.
- [ ] **Step 4:** Bind the PR with the ccd_pr tools and report CI.
