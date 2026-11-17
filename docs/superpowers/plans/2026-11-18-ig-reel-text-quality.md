# IG Reel text quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catchier on-screen text, plus a tip's full prompt in the caption with an on-video pointer to it.

**Architecture:** The story JSON gains an optional `sample_prompt` field. It is validated in `story.py`, added to the caption by `build_caption`, and flagged on the "why" and "cta" scenes by `scenes.py`. Both writing prompts in `ig_reel_daily.py` share one craft block. The highlight markup changes to one box per word.

**Tech Stack:** Python 3 standard library. Tests are plain asserts in `scripts/ig_reel/selfcheck.py`.

**Spec:** `docs/superpowers/specs/2026-11-18-ig-reel-text-quality-design.md`

## Global Constraints

- No extra AI calls per Reel.
- `SAMPLE_PROMPT_MAX = 400` characters. Required for tips, ignored for news.
- Caption block: `📋 Salin prompt ini:` followed by a newline and the prompt, right after the opener.
- CTA-scene chip text: `📋 PROMPT LENGKAP DI CAPTION`. Why-scene hint: `lengkapnya di caption ↓`. Both appear only when `story["sample_prompt"]` is non-empty.
- New ai-labs `follow_line`: `Follow @ailabs01.id — tiap hari 1 trik AI baru`.
- Scene timing, music and images are unchanged. `scripts/ig-kit/` is untouched.

## Review Focus

- A tip without `sample_prompt` (AI omitted it): a hard error, so the repair round asks for it. The pipeline never posts a tip with a dangling "prompt in the caption" chip.
- A news story that returns a `sample_prompt` anyway: it is dropped by `apply_story_limits` in news mode, so no chip appears and the caption gets no block.
- An English `sample_prompt`: a hard language error.
- A highlight followed by punctuation ("utama."): the "." stays in the last word's box; no orphan line.
- A caption at `CAPTION_MAX` with a long prompt: the hashtags are cut first, never the prompt. Assert that the prompt survives.

---

### Task 1: `sample_prompt` in the story and the caption

**Files:**
- Modify: `scripts/ig_reel/story.py`: `STORY_SCHEMA_HINT`, `check_story`, `apply_story_limits`, `build_caption`, `_story_texts`
- Test: `scripts/ig_reel/selfcheck.py`, tip-mode section

**Interfaces:**
- Produces:
  - `SAMPLE_PROMPT_MAX = 400`.
  - `check_story(data, article, mode="tip")` reports `sample_prompt` errors.
  - `apply_story_limits(data, mode="news")` sets `data["sample_prompt"]`: truncated to the limit for tips, `""` for news.
  - `build_caption(data, source, link)` inserts the prompt block.

- [ ] **Step 1: Failing asserts.** In the tip section:
  - `TIP` gets `"sample_prompt": "Hapus semua objek yang mengganggu di foto ini, lalu ganti latarnya dengan jalan kota malam yang basah oleh hujan, cahaya neon lembut."`
  - `check_story(TIP, "", mode="tip") == ([], [])`.
  - Without the field: a hard error containing `sample_prompt`.
  - An English prompt: a hard error containing `Indonesia`.
  - A prompt containing `Rp 50.000`: a hard error containing `prices`.
  - A 450-character prompt: a soft issue, and after `apply_story_limits(t, mode="tip")` its length is ≤ 400.
  - `build_caption(TIP, "Claude", None)` contains `"📋 Salin prompt ini:\n" + TIP["sample_prompt"]` after the opener and before the body.
  - News: `apply_story_limits(s, mode="news")` on a story carrying a `sample_prompt` leaves `s["sample_prompt"] == ""`.
  - A caption with 2000 characters of body still contains the prompt.
- [ ] **Step 2:** Run `python3 scripts/ig_reel/selfcheck.py` and confirm it fails at the new asserts.
- [ ] **Step 3: Implement.**
  - Schema hint: add a `"sample_prompt"` line ("khusus tips: prompt lengkap siap salin, Bahasa Indonesia, maks 400 karakter; berita: kosongkan").
  - `check_story`, tip mode only: missing → hard; `looks_english` → language error; length > max → soft.
  - `_story_texts` includes `sample_prompt`, so the tip rules and number checks cover it.
  - `apply_story_limits` gains a `mode` parameter.
  - `build_caption`: the prompt block goes after the opener. Truncation to `CAPTION_MAX` trims the hashtags and body tail, not the prompt.
- [ ] **Step 4:** Run the selfcheck. Expected last line: `ig_reel selfcheck: all assertions passed`.
- [ ] **Step 5:** Commit `feat(ig-reel): tips carry a full sample prompt, shown in the caption`.

### Task 2: Scenes — highlight per word, prompt pointers

**Files:**
- Modify: `scripts/ig_reel/scenes.py`: `_beat_text`, the `why` and `cta` branches of `scene_html`
- Test: `scripts/ig_reel/selfcheck.py`, scenes section

**Interfaces:**
- Consumes: `story["sample_prompt"]` from Task 1.

- [ ] **Step 1: Failing asserts.**
  - `_beat_text("Jaringan parut ada di katup dan pembuluh darah utama.", "katup dan pembuluh darah utama", 1.0)`:
    - The output contains exactly 5 `class="hlbox"`.
    - No `>.</span>` stands outside an `hl` span; the "." sits inside the last word's `hltext`.
  - `scene_html("cta", {**TIP, ...})` contains `PROMPT LENGKAP DI CAPTION`. The same with `sample_prompt=""` does not.
  - `scene_html("why", …)` contains `lengkapnya di caption` only when there is a prompt.
- [ ] **Step 2:** Run the selfcheck and confirm it fails.
- [ ] **Step 3: Implement.**
  - Each highlight word becomes its own `span.hl` (an inline-block with its own box and text). Spaces sit between the spans, so the browser can wrap there.
  - Punctuation directly after the phrase (`[.,!?;:…]+`) joins the last word.
  - Each word keeps the same sweep delay as today.
  - The CTA chip reuses the `.chip` style with `align-self: center` and the `r2` rise animation; the follow line moves to `r3`. The handle row stays.
  - The why hint is a small `.src`-styled line under the beat.
- [ ] **Step 4:** Run the selfcheck; it must pass, including the render, so nothing leaves the safe area.
- [ ] **Step 5:** Commit `fix(ig-reel): highlight wraps per word; tips point to the prompt in the caption`.

### Task 3: Writing prompts and follow line

**Files:**
- Modify: `scripts/ig_reel_daily.py`: a new `CRAFT_RULES` string used by `write_story` and `write_tip`; both call `apply_story_limits(data, mode=…)`.
- Modify: `scripts/ig_reel/accounts/ai-labs.json` (`follow_line`).
- Modify: `docs/status.md`, one line under the IG Reel entry.

- [ ] **Step 1: Write `CRAFT_RULES`** (Indonesian). It must cover:
  - **Viewer:** a phone scroller who decides in one second.
  - **Hook:** opens a question or a gap, or speaks to "kamu"; no plain topic labels. One bad and one good example each for news and tips, e.g. bad "Jantung menua tak merata" → good "Bagian jantungmu ini menua lebih dulu".
  - **Beats:** start with the most interesting thing; never open with a journal, institute or researcher name, because the source line already credits them.
  - **Words:** everyday Indonesian, no jargon.
  - **CTA:** names the kind of friend who would want it; a tip is never called "cerita".
  - **Tips only:** the "why" beat holds a short version of `sample_prompt`.
- [ ] **Step 2:** Insert `CRAFT_RULES` into both prompts, before "Aturan WAJIB". The repair prompts stay unchanged.
- [ ] **Step 3:** Update the follow line and `docs/status.md`.
- [ ] **Step 4: Verify.**
  - The selfcheck passes.
  - `python3 -c "import ast,sys; ast.parse(open('scripts/ig_reel_daily.py').read())"` succeeds.
  - Push the branch, then `gh workflow run ig-reel.yml --ref feat/ig-reel-text-quality -f dry_run=true -f account=<id>` for `kaliajatau` and for `ai-labs`. Both succeed.
  - Download the artifacts. The frames show the new hook and chip, and the ai-labs log caption contains `📋 Salin prompt ini:`.
- [ ] **Step 5:** Commit `feat(ig-reel): writing prompts aim for scroll-stopping hooks and plain words`.
