# IG Reel Cinematic Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the daily @kaliajatau.id Reel into a ~27.6 s single-story cinematic Reel with animated HTML scenes, a composed beat-synced track, a designed cover, story CTA and save/share caption.

**Architecture:** New importable package `scripts/ig_reel/` (pure story/caption logic, music synth, scene HTML, frame capture + assembly). `scripts/ig_reel_daily.py` keeps orchestration (RSS, dedupe, AI calls, images, Cloudinary, Buffer, fail/REPORT) and calls the package. `scripts/ig-kit/*` untouched.

**Tech Stack:** Python 3 (stdlib, numpy, scipy, playwright — already pinned in `ig-reel.yml`), headless Chrome (`/usr/bin/google-chrome`), ffmpeg.

**Spec:** `docs/superpowers/specs/2026-11-15-ig-reel-cinematic-redesign-design.md`

## Global Constraints

- 1080×1920, 30 fps, H.264 (`-crf 18 -pix_fmt yuv420p`) + AAC; 100 BPM ⇒ beat 0.6 s.
- Scene beats: hook 5, context 10, twist 10, why 8, payoff 6, cta 7 = **46 beats = 27.6 s = 828 frames**.
- Text safe area: x 72–930, y 240–1480. Progress bar 6 px `#FFD23F` at y≈150. Colors: highlight `#FFD23F`, text `#FFFFFF`, body `#E6E6E6`.
- Fonts: Anton + Inter `.ttf` (OFL) committed in `scripts/ig_reel/fonts/` with `OFL.txt`; loaded by `@font-face` from local files.
- Hook frame 0 fully composed (cover); Buffer `thumbnailOffset: 0`.
- Image style suffix (exact): `cinematic film still, dramatic volumetric lighting, teal-and-amber grade, 35mm, shallow depth of field, film grain, vertical 9:16, no text, no letters, no logos`. 4 images per run.
- Grounding: every digit group in `hook`, `beats[].text`, `beats[].highlight`, `caption.*` must appear in the article text after normalising (`1,5`≡`1.5`, `8.700`≡`8,700`≡`8700`).
- Dedupe: last 28 sent Buffer posts. RSS interleaved round-robin before the 18 cap.
- Music seed = `f"{date}-{slot HHMM}"`; same seed ⇒ identical audio, different seed ⇒ different key/progression.
- CTA follow line exact: `Ikuti @kaliajatau.id buat fakta gila berikutnya`.
- Never commit `.superpowers/`. Branch `feat/ig-reel-cinematic`, one PR.
- Proof = `python3 scripts/ig_reel/selfcheck.py` (new, asserts) + a local `DRY_RUN=true PLACEHOLDER_IMAGES=true` render + CI dry-run artifact.

## Review Focus

- Article fetch returns a paywall/JS shell (< 800 chars) for all 3 shortlisted refs → `fail()` with reason, no post. Test: Task 1 (`extract_article_text` on a nav-only fixture → < 800).
- AI writes a correct number in a different format (`1,5` vs `1.5`, `8.700` vs `8700`) → accepted, not rejected. Test: Task 1.
- Hook/beat text longer than fits → overflow clipped or pushed out of the safe area. Test: Task 3 (longest-allowed strings render with element bbox inside safe area, checked in Task 4 capture via JS `getBoundingClientRect`).
- Emoji in CTA renders as tofu box in CI → Task 6 installs `fonts-noto-color-emoji`; Task 4 test renders `🚀` and asserts glyph width > 0 is not enough—assert `document.fonts.check('120px "Noto Color Emoji"')` when the font is present, skip locally if absent.
- Render exceeds the 30-min job → Task 4 measures frames/s locally; Task 7 records CI wall time from the dry run.

---

### Task 1: Story + caption logic (`scripts/ig_reel/story.py`)

**Files:** Create `scripts/ig_reel/__init__.py` (empty), `scripts/ig_reel/story.py`, `scripts/ig_reel/selfcheck.py`.

**Interfaces — Produces:**
- `interleave(groups: list[list[dict]], cap: int) -> list[dict]` — round-robin across per-feed lists, dedupe by `title[:80].lower()`, first `cap`.
- `extract_article_text(html: str) -> str` — drop `script/style/nav/header/footer/aside/form`, take `<p>` text (unescape, collapse whitespace), join with `\n`, cap 6000 chars.
- `numbers_in(text: str) -> set[str]` — digit groups normalised: strip thousands separators, decimal `,`→`.`; e.g. `"8.700 km dan 1,5 kali"` → `{"8700", "1.5"}`. Ambiguity rule: a `.`/`,` followed by exactly 3 digits = thousands separator; otherwise decimal.
- `check_story(data: dict, article_text: str) -> tuple[list[str], list[str]]` — hard: missing hook / not exactly 4 beats in order `context,twist,why,payoff` / beat text missing / highlight not a substring of its beat text (when non-empty) / not exactly 4 image_prompts / missing cta / missing caption fields / any number in story text not in `numbers_in(article_text)` (message lists the offending numbers). Soft (truncatable): hook > 7 words, beat text > 120, cta > 60, caption.opener > 120, hashtags outside 5–8 (trim to 8 / hard if < 3).
- `apply_story_limits(data: dict) -> None` — truncate per soft limits (word boundary), trim hashtags to 8, ensure `#` prefix.
- `build_caption(data: dict, source: str, link: str) -> str` — `opener\n\nbody\n\nquestion\n\nsave_line\n\nSumber: {source} ({link})\n\n{hashtags joined by space}`, capped 2200.
- `STORY_SCHEMA_HINT: str` — the JSON schema text from the spec §1 for prompts.

- [ ] **Step 1: Write `selfcheck.py` story section** (plain `assert`s, prints `ig_reel selfcheck: all assertions passed` at end):
  - `interleave([[{"title":"a1"},{"title":"a2"}],[{"title":"b1"}]], 3)` titles == `["a1","b1","a2"]`.
  - `extract_article_text("<nav><p>menu</p></nav><script>x</script><p>Para one.</p><p>Para &amp; two.</p>")` == `"Para one.\nPara & two."`; nav-only fixture → `len(...) < 800`.
  - `numbers_in("8.700 km/jam, 1,5 kali, 2026")` == `{"8700","1.5","2026"}`.
  - Valid fixture story (4 beats, numbers `8.700` with article containing `8,700`) → `check_story` hard == `[]`.
  - Same story with beat text `"anginnya 9.000 km/jam"` → a hard message containing `9000`.
  - 3 beats → hard non-empty; highlight not in text → hard non-empty.
  - `build_caption(...)` starts with opener, contains `"Sumber: NASA (https://x)"`, ends with hashtags line.
- [ ] **Step 2:** `python3 scripts/ig_reel/selfcheck.py` → FAIL (ImportError).
- [ ] **Step 3:** Implement `story.py`.
- [ ] **Step 4:** selfcheck → passes.
- [ ] **Step 5: Commit** `feat(ig-reel): story grounding + caption builder` (also add `.superpowers/` to `.gitignore` here; commit spec + plan).

### Task 2: Music (`scripts/ig_reel/music.py`)

**Interfaces — Produces:** `compose(seed: str, beats: int, out_wav: Path, bpm: int = 100, sr: int = 44100) -> dict` returning `{"key": str, "progression": list[str], "seconds": float}`; writes 16-bit stereo WAV of `beats*60/bpm + 1.0` s (1 s tail + fade-out). Layers per spec §4 (pad, sub pulse every beat, kick/hat from beat 4, riser over the 4 beats before the twist (beat 15), hit on beat 15 and beat 39 (CTA start)), peak-normalised to −1 dBFS. Key/progression chosen from pools (≥ 4 keys × ≥ 3 progressions) via `random.Random(seed)`.
Scene-start beats are a module constant shared with Task 3: put `SCENE_BEATS = [("hook",5),("context",10),("twist",10),("why",8),("payoff",6),("cta",7)]` in `scripts/ig_reel/timeline.py` with `BPM=100`, `FPS=30`, `scene_starts() -> list[int]` (beats) and `total_frames() -> int`.

- [ ] **Step 1: selfcheck music section:** `total_frames() == 828`; `scene_starts() == [0,5,15,25,33,39]`; `compose("2026-11-16-0730", 46, tmp)` → seconds == 28.6 ± 0.01, WAV readable, peak ≤ 0.9; same seed twice → identical bytes; seeds `"…-0730"` vs `"…-1130"` → `(key, progression)` differ for at least one of 4 seed pairs tested (pools make collisions possible; assert across 4 pairs not all equal).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement `timeline.py`, `music.py`. **Step 4:** run → pass; listen locally once (`ffplay` or open the WAV) and note in ledger.
- [ ] **Step 5: Commit** `feat(ig-reel): composed beat-grid soundtrack`.

### Task 3: Scene HTML + fonts (`scripts/ig_reel/scenes.py`)

**Files:** `scripts/ig_reel/scenes.py`, `scripts/ig_reel/fonts/{Anton-Regular.ttf,Inter.ttf,OFL-Anton.txt,OFL-Inter.txt}` (from `github.com/google/fonts` `ofl/anton/`, `ofl/inter/`).

**Interfaces — Produces:** `scene_html(kind: str, story: dict, images: dict[str, Path], meta: dict) -> str` for `kind in {"hook","context","twist","why","payoff","cta"}`; `meta = {"source","date","handle":"@kaliajatau.id","scene_index","progress_from","progress_to"}` (progress fractions of the whole Reel). Each document: 1080×1920, `@font-face` with absolute `file://` font URLs, full-bleed `<img>` (images: hook→img1, context→img2, twist→img3, why→img4, payoff→img4 darkened, cta→img1 blurred), bottom black gradient, all text elements carry class `safe` and stay within the safe area, every animation via CSS `animation` with explicit duration = scene seconds (so Task 4 can seek), `animation-fill-mode: both`, paused-by-default not required (capture pauses). Hook: no entrance animation on text (cover at t=0), only image push-in 1.00→1.08. Twist highlight: element `.hl` box sweeps (`clip-path`/`scaleX`) starting at beat 2 of the scene. Word reveal: each word a `<span>` with staggered `animation-delay` (⅛ beat = 0.075 s). Payoff: `SIMPAN` chip pops on its beat 2. CTA: `cta` line + exact follow line, staggered on beats. Source line `Sumber: {source} · {date}` on context/twist/why/payoff. All user strings HTML-escaped.

- [ ] **Step 1: selfcheck scenes section:** for each kind, `scene_html(...)` contains `@font-face`, `Anton`, `class="safe`; hook HTML contains the hook words and no `animation` on `.hook-text`; twist HTML contains the highlight substring inside `class="hl"`; cta HTML contains `Ikuti @kaliajatau.id buat fakta gila berikutnya`; a story string `<script>` appears escaped.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** pass.
- [ ] **Step 5: Commit** `feat(ig-reel): cinematic scene templates + fonts`.

### Task 4: Frame capture + assembly (`capture.py`, `assemble.py`)

**Interfaces — Produces:**
- `capture_scene(html_path: Path, n_frames: int, out_dir: Path, start_index: int) -> dict` — Playwright Chromium at `/usr/bin/google-chrome` (fallback: Playwright's bundled browser when that path is absent, for local dev), viewport 1080×1920, waits `document.fonts.ready`, pauses all `document.getAnimations()`, for frame i sets each `anim.currentTime = i*1000/30`, screenshots JPEG q=92 to `out_dir/f{start_index+i:05d}.jpg`. Returns `{"frames": n, "overflow": [selectors]}` where overflow = `.safe` elements whose bbox leaves the safe area at the last frame.
- `assemble(frames_dir: Path, wav: Path, out_mp4: Path) -> None` — `ffmpeg -framerate 30 -i f%05d.jpg -i music.wav -c:v libx264 -crf 18 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k -shortest`.
- `render_reel(story, images, meta_base, seed, out_mp4) -> dict` (in `scripts/ig_reel/__init__.py` or `reel.py`) — loops `SCENE_BEATS`, writes scene HTML, captures, composes music, assembles; returns `{"seconds", "overflow", "music": {...}}`; raises `RuntimeError` if any overflow.

- [ ] **Step 1: selfcheck render section** (skipped with a printed notice if no Chrome/ffmpeg): `render_reel` with the fixture story + 4 generated solid-colour JPEGs → mp4 exists; `ffprobe` → width 1080, height 1920, `r_frame_rate` 30/1, duration 27.6 ± 0.1, one audio stream; `overflow == []` for the longest-allowed fixture strings; frame 0 of the hook has the hook text (assert in capture via JS that `.hook-text` computed opacity == 1 at t=0). Log frames/s.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** pass; open 6 sample frames (one per scene) and look at them (Read tool on JPEGs).
- [ ] **Step 5: Commit** `feat(ig-reel): seekable frame capture + assembly`.

### Task 5: Wire into `scripts/ig_reel_daily.py`

**Interfaces — Consumes:** Tasks 1–4.
- `recent_post_captions`: `first: 28`.
- `fetch_candidates`: per-feed lists → `interleave(groups, 18)`.
- New `pick_shortlist(candidates, avoid) -> list[int]` (AI JSON `{"refs":[i,j,k]}`), `fetch_article(cand) -> str` (via `http()` + `extract_article_text`), `write_story(cand, article_text) -> dict` (AI with `STORY_SCHEMA_HINT`, `check_story` + one repair retry + `apply_story_limits`). Loop shortlist until article ≥ 800 chars and story valid; else `fail("no shortlisted article yielded enough text/valid story")`.
- Images: 4 × `gen_image(f"{prompt}, {STYLE_SUFFIX}", img_k)`; placeholder path unchanged under `PLACEHOLDER_IMAGES`.
- Render: `render_reel(...)` with seed `f"{TODAY}-{NOW:%H%M}"` rounded to the slot (`%H%M` of run start is fine).
- Caption: `build_caption(story, cand["source"], cand["link"])`.
- Buffer: `thumbnailOffset: 0`.
- Delete superseded code: `make_scene_html`, `hook_scene`, `cta_scene`, `draft_script`, `check_script`, `apply_length_limits`, `repair_prompt`, `FACTS_*`/`FACT_*`/`CAPTION_MAX`/`HOOK_MAX_WORDS`, the `build_reel.py` call. Keep `check_kit()` (still uses `cf_image.py`).
- REPORT keeps `status/topic/path|reel/posted/images/sources` keys (sources = the one article).

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify** `python3 -m py_compile scripts/ig_reel_daily.py scripts/ig_reel/*.py && python3 scripts/ig_reel/selfcheck.py`; then a local dry run with keys from `.dev.vars`: `set -a; . ./.dev.vars; set +a; DRY_RUN=true PLACEHOLDER_IMAGES=true python3 scripts/ig_reel_daily.py` → `REPORT {"status": "dry-run", …}`, mp4 ~27.6 s; inspect 6 frames + caption text in the log.
- [ ] **Step 3: Commit** `feat(ig-reel): single-story cinematic pipeline`.

### Task 6: CI + docs

- `.github/workflows/ig-reel.yml`: apt add `fonts-noto-color-emoji`; after the pipeline step, `actions/upload-artifact` pinned to a full commit SHA (look up with `gh api repos/actions/upload-artifact/git/ref/tags/v4.6.2 --jq .object.sha`), `if: always() && inputs.dry_run`, paths `.ig-reel-out/ig_reel.mp4`, `.ig-reel-out/frames_sample/*.jpg` (Task 4/5 copies one frame per scene there), retention 7 days.
- `prompts/ig-reel-daily.md`: format → one story (hook → context → twist → why → payoff → CTA), `thumbnailOffset: 0`, ~28 s.
- `docs/status.md`, `AGENTS.md`: new module layout, check command `python3 scripts/ig_reel/selfcheck.py`, thumbnail 0, dedupe 28.
- [ ] **Step 1:** edit. **Step 2: Verify** YAML parses (`python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ig-reel.yml'))"`), `git grep -n "thumbnailOffset: 500\|thumbnailOffset\": 500"` → only historical spec/plan docs. **Step 3: Commit** `chore(ig-reel): CI fonts, dry-run artifact, docs`.

### Task 7: Ship

- [ ] Conflict-marker grep clean; push; PR (Summary / What changed / Verification / Out of scope).
- [ ] After merge: `gh workflow run ig-reel.yml --ref main -f dry_run=true`, watch, download artifact, inspect video + frames, record CI wall time. Live slots then post the new format; first live post: check cover in IG grid = hook frame.
