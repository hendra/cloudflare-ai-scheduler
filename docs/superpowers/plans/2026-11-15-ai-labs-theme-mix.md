# AI-labs Theme Mix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `ai-labs` tip themes around photo/video/animation creation, add Gemini as a third tool, and make weighted rotation real so creative tips dominate the schedule.

**Architecture:** `scripts/ig_reel/accounts.py` owns theme validation and rotation. A new optional `weight` field expands the theme list into a round-robin ring; `pick_theme` and a new `theme_plan` (used by the tip retry loop) read that ring. The account file carries all content, so later mix changes stay settings edits.

**Tech Stack:** Python 3.11 (stdlib only), GitHub Actions, the existing assert-based `scripts/ig_reel/selfcheck.py` (no test framework in this repo).

**Spec:** `docs/superpowers/specs/2026-11-15-ai-labs-theme-mix-design.md`

## Global Constraints

- No new dependencies; stdlib only.
- Themes stay Bahasa Indonesia; the tip checks stay as they are (no prices, no percentages, no numbers above 10, no model version names).
- 27 themes: 12 creative at `weight: 2` (4 photo, 4 video, 4 animation), 15 others at `weight: 1` (prompt 2, konten sosmed 2, voice 2, kerja 2, belajar & riset 2, QA 2, coding 3).
- Tools are exactly `Claude`, `ChatGPT`, `Gemini`. `Superpowers` may appear only inside the coding theme text, never as a theme `tool`.
- `kaliajatau` is untouched: `themes: []`, same feeds, handle, IDs.
- `weight` is optional, integer 1-3, default 1, and `true`/`false` must be rejected like `dedupe_posts` does.
- Verification command: `python3 scripts/ig_reel/selfcheck.py` must print `ig_reel selfcheck: all assertions passed` (this machine lacks numpy/playwright, so the music and render sections print a skip notice — that is expected).

## Review Focus

1. An account file with no `weight` (every file written before this change) must rotate exactly as today, not crash or silently double.
2. The four slots of one day must still yield four different themes even though weight-2 themes occupy two ring positions.
3. A rejected tip's retry must never hand the same theme back twice, and must terminate on a ring smaller than the retry count.
4. `weight: 0`, `4`, `"2"`, `true` must fail account loading with a readable `themes: … weight …` message, not post with a wrong mix.
5. An account with `themes: []` (kaliajatau) must not crash the ring helpers (`theme_ring`/`theme_plan` return empty) and keeps failing the tip mode with today's "no themes" message.

---

### Task 1: Weighted ring and weighted tip retry in `accounts.py`

**Files:**
- Modify: `scripts/ig_reel/accounts.py:12` (`TOOLS`), `:32-39` (theme validation), `:75-77` (`pick_theme`)
- Test: `scripts/ig_reel/selfcheck.py:209-245` (accounts section)

**Interfaces:**
- Consumes: `SLOTS`, `MIN_THEMES`, `validate_account` as they exist today.
- Produces:
  - `TOOLS = ("Claude", "ChatGPT", "Gemini")`
  - `theme_ring(themes: list[dict]) -> list[dict]` — round-robin by weight: every theme once in file order, then the `weight > 1` themes again, and so on; `[]` for no themes.
  - `pick_theme(ring: list[dict], day: datetime.date, slot: str) -> dict` — `ring[(day.toordinal() * 4 + SLOTS.index(slot)) % len(ring)]`.
  - `theme_plan(ring: list[dict], day: datetime.date, slot: str, tries: int) -> list[dict]` — up to `tries` themes starting at the `pick_theme` position, stepping one ring position at a time and skipping topics already in the result; returns fewer than `tries` only when the ring has fewer distinct themes.

- [ ] **Step 1: Write the failing checks**

In `scripts/ig_reel/selfcheck.py`, extend the accounts import with `theme_ring`, `theme_plan` and add after the existing `pick_theme` assertion (line 236):

```python
W = [{"tool": "Claude", "topic": "t1", "weight": 2}, {"tool": "Gemini", "topic": "t2", "weight": 2},
     {"tool": "ChatGPT", "topic": "t3"}, {"tool": "Claude", "topic": "t4"}]
assert len(theme_ring(W)) == 6 and [t["topic"] for t in theme_ring(W)] == ["t1", "t2", "t3", "t4", "t1", "t2"]
assert theme_ring([]) == [] and theme_plan([], _d.date(2026, 11, 16), "morning", 3) == []
_day = _d.date(2026, 11, 16)
_WR = theme_ring(W)
assert pick_theme(_WR, _day, "morning") == _WR[(_day.toordinal() * 4) % len(_WR)]
_p = theme_plan(_WR, _day, "morning", 3)
assert _p[0] == pick_theme(_WR, _day, "morning") and len({t["topic"] for t in _p}) == 3
assert len({t["topic"] for t in theme_plan(_WR, _day, "morning", 99)}) == 4   # terminates, no repeats
for bad_w in (0, 4, "2", True):
    BAD8 = [{**W[2], "weight": bad_w}] * 8
    assert any("weight" in e for e in validate_account({**LABS, "themes": BAD8})), bad_w
assert validate_account({**LABS, "themes": [{**W[2], "weight": 2}] * 8}) == []
```

- [ ] **Step 2: Run selfcheck to verify it fails**

Run: `python3 scripts/ig_reel/selfcheck.py`
Expected: `ImportError: cannot import name 'theme_ring'`.

- [ ] **Step 3: Implement the three helpers and the weight validation**

In `scripts/ig_reel/accounts.py`: add `Gemini` to `TOOLS`; inside the themes branch of `validate_account`, after the `MIN_THEMES` check, reject a present-but-invalid weight:

```python
    weights = [t.get("weight", 1) for t in themes]
    if any(not isinstance(w, int) or isinstance(w, bool) or not 1 <= w <= 3 for w in weights):
        errs.append("themes: weight must be an integer 1-3 (or omitted = 1)")
```

Replace `pick_theme` with the ring version and add the two helpers beside it; `theme_plan` starts at `pick_theme`'s index and walks the ring once, collecting themes whose `topic` is new.

- [ ] **Step 4: Run selfcheck to verify it passes**

Run: `python3 scripts/ig_reel/selfcheck.py`
Expected: `ig_reel selfcheck: all assertions passed` (two skip notices for numpy/playwright).

- [ ] **Step 5: Commit**

```bash
git add scripts/ig_reel/accounts.py scripts/ig_reel/selfcheck.py
git commit -m "feat(ig-reel): weighted theme rotation and Gemini tool"
```

---

### Task 2: The new ai-labs theme list

**Files:**
- Modify: `scripts/ig_reel/accounts/ai-labs.json` (whole `themes` list, `persona`, `follow_line`)
- Modify: `docs/ig-reel-add-account.md:22` (field table)
- Test: `scripts/ig_reel/selfcheck.py:222-224`

**Interfaces:**
- Consumes: the schema and rotation from Task 1.
- Produces: `load_account("ai-labs")["themes"]` — 27 entries; `persona` and `follow_line` strings used by the prompt and the CTA scene; `handle`, IDs and feeds unchanged.

- [ ] **Step 1: Write the failing checks**

Replace the `ai-labs` assertions in `scripts/ig_reel/selfcheck.py` (lines 222-224) with:

```python
LABS = load_account("ai-labs")
assert LABS["news_slots"] == ["morning"] and LABS["dedupe_posts"] == 120
assert len(LABS["themes"]) == 27
assert {t["tool"] for t in LABS["themes"]} == {"Claude", "ChatGPT", "Gemini"}
assert sum(1 for t in LABS["themes"] if t.get("weight") == 2) == 12
assert len(theme_ring(LABS["themes"])) == 39
assert len({pick_theme(theme_ring(LABS["themes"]), _d.date(2026, 11, 16), s)["topic"] for s in SLOTS}) == 4
```

- [ ] **Step 2: Run selfcheck to verify it fails**

Run: `python3 scripts/ig_reel/selfcheck.py`
Expected: assertion failure on `len(LABS["themes"]) == 27` (today: 24).

- [ ] **Step 3: Rewrite the account file**

In `scripts/ig_reel/accounts/ai-labs.json`: write the 27 themes from the spec's list section — 12 creative `weight: 2`, 15 others `weight: 1` — spreading tools so Gemini owns photo/video generation, ChatGPT photo/scripts/voice, Claude scripts, code animations, critique and coding. Set `persona` to the spec's wording (tips & trik AI Claude/ChatGPT/Gemini untuk bikin dan edit foto, video, animasi) and `follow_line` to `Ikuti buat tips AI kreatif berikutnya`. Add one row to the field table in `docs/ig-reel-add-account.md`:

```markdown
| `weight` | Optional 1-3 (default 1). How many rotation slots the theme takes: 2 = twice as often. |
```

- [ ] **Step 4: Run selfcheck to verify it passes**

Run: `python3 scripts/ig_reel/selfcheck.py`
Expected: `ig_reel selfcheck: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/ig_reel/accounts/ai-labs.json docs/ig-reel-add-account.md scripts/ig_reel/selfcheck.py
git commit -m "feat(ig-reel): ai-labs creative tip themes with Gemini"
```

---

### Task 3: Tip retry uses the weighted plan

**Files:**
- Modify: `scripts/ig_reel_daily.py:86` (import), `:760-792` (tip selection)
- Test: covered by Task 1's `theme_plan` checks; this task is verified by the dry run in Task 5.

**Interfaces:**
- Consumes: `theme_ring`, `theme_plan` from Task 1; `ACCOUNT["themes"]`, `NOW`, `SLOT`, `TIP_TRIES`, `write_tip`.
- Produces: same log lines and meta (`source` = the chosen theme's `tool`), same failure message `no valid tip after 3 themes: …`.

- [ ] **Step 1: Replace the offset loop**

In `main()`, build `ring = theme_ring(themes)` next to the `themes = ACCOUNT["themes"]` line, and replace the offset `for` with:

```python
    for theme in theme_plan(ring, NOW.date(), SLOT, TIP_TRIES):
        try:
            story = write_tip(theme, recent)
            break
        except RuntimeError as e:
            reasons.append(f"{theme['tool']} — {theme['topic']}: {str(e)[:140]}")
```

Keep the existing `if not story: fail(...)` below it, and delete the old `theme = pick_theme(...)` / `themes.index(...)` stepping.

- [ ] **Step 2: Run selfcheck and a syntax check**

Run: `python3 -m py_compile scripts/ig_reel_daily.py && python3 scripts/ig_reel/selfcheck.py`
Expected: no output from `py_compile`; `ig_reel selfcheck: all assertions passed`.

- [ ] **Step 3: Commit**

```bash
git add scripts/ig_reel_daily.py
git commit -m "feat(ig-reel): tip retry follows the weighted theme ring"
```

---

### Task 4: Docs match the new niche

**Files:**
- Modify: `AGENTS.md:26`, `docs/status.md:96` (gotcha 29), `.github/workflows/ig-reel.yml:9-10` (header comment)

**Interfaces:**
- Consumes: nothing at runtime.
- Produces: the one-line descriptions of `ai-labs` that later readers trust.

- [ ] **Step 1: Update the three descriptions**

`AGENTS.md`: `ai-labs` = "Claude/ChatGPT/Gemini tips: photo, video and animation creation and editing first, plus prompt, content, voice, work, learning and coding tips". `docs/status.md` gotcha 29: same niche sentence, note that `weight` 1-3 makes creative themes run twice as often, and that the list is 27 themes. Workflow header: `ai-labs — Claude/ChatGPT/Gemini creative tips (photo, video, animation), announcement in the morning slot, else a theme tip.`

- [ ] **Step 2: Check nothing else claims the old niche**

Run: `git grep -n "Claude & ChatGPT\|Claude/ChatGPT tips" -- .`
Expected: no hit in `AGENTS.md`, `docs/status.md`, `.github/workflows/ig-reel.yml`; the older spec `docs/superpowers/specs/2026-11-15-ig-reel-multi-account-design.md` may still match (historical, leave it).

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md docs/status.md .github/workflows/ig-reel.yml
git commit -m "docs(ig-reel): ai-labs niche is creative AI tips"
```

---

### Task 5: Whole-branch verification

**Files:** none.

- [ ] **Step 1: Full local check**

Run: `python3 scripts/ig_reel/selfcheck.py && git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .`
Expected: `ig_reel selfcheck: all assertions passed`; the `git grep` prints nothing (no conflict markers).

- [ ] **Step 2: Dry runs (needs `gh` login)**

```bash
gh workflow run ig-reel.yml -f dry_run=true -f account=ai-labs -f mode=tip
gh workflow run ig-reel.yml -f dry_run=true -f account=ai-labs -f mode=news
gh workflow run ig-reel.yml -f dry_run=true -f account=kaliajatau
```

Expected: in each log, `story:` / `tip:` names a theme; `tip:` runs show a `Claude`/`ChatGPT`/`Gemini` source label; the `kaliajatau` run is unchanged (news story, science source). A dry run still refuses nothing (guard logs only).

- [ ] **Step 3: Report**

State which dry runs passed and the artifact names (`ig-reel-dry-run-ai-labs`, `ig-reel-dry-run-kaliajatau`).
