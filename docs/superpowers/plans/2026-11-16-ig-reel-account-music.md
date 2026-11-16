# IG Reel Account Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Reel's synthesized soundtrack depend on the account (style) and the post (mood), with a per-account signature motif.

**Architecture:** The account file names a music style; the story JSON carries a mood chosen by the story-writing AI call. `music.compose()` takes both: the mood selects scale, progression list, rhythm and brightness; the style selects the voices and the motif; the seed selects key, progression and melody notes. Style and mood names live in numpy-free modules (`accounts.py`, `story.py`) so account loading and story checks keep working where numpy is absent.

**Tech Stack:** Python 3, numpy, scipy (already pinned in `.github/workflows/ig-reel.yml`). Tests are plain `assert`s in `scripts/ig_reel/selfcheck.py` — the repo has no pytest.

**Spec:** `docs/superpowers/specs/2026-11-16-ig-reel-account-music-design.md`

## Global Constraints

- Grid is fixed: 46 beats at 100 BPM, 27.6 s + 1.0 s tail = 28.6 s. Do not change `timeline.py`.
- Same seed, style and mood render byte-identical audio. All randomness comes from `np.random.default_rng` seeded from the inputs; no `random` module state, no time.
- Output: stereo 44.1 kHz 16-bit WAV, peak ≤ −1 dBFS (`0.891`), 1.5 s fade-out.
- numpy and scipy only. No new dependencies.
- Mood never fails or delays a post: a missing or unknown mood falls back.
- Styles: `cinematic`, `electronic`. Default: `cinematic`. Moods: `curious`, `wonder`, `energetic`, `mysterious`, `uplifting`.
- `scripts/ig-kit/` is not touched.
- Never commit to `main`. Work on branch `feat/ig-reel-account-music`; lands via a PR (AGENTS.md format).
- Run the tests with `python3 scripts/ig_reel/selfcheck.py` from the repo root; pass = exit code 0. Sections needing numpy or Chrome skip themselves when those are missing — install numpy and scipy locally so the music section runs.

## Review Focus

1. **Messy mood values from the AI** (`"Curious "`, `"WONDER"`, `5`, `None`, `["wonder"]`, `"sedih"`): the post still ships; a valid name is recognised despite case and spaces, anything else falls back. → Task 1.
2. **A malformed `music` block in an account file** (`"music": "electronic"`, `"music": {}`, `"music": {"style": 3}`): validation reports a readable error, never a traceback; `{}` and a missing block mean `cinematic`. → Task 2.
3. **Phone speakers:** the bass must be audible without sub frequencies — each style × mood has real energy between 150 Hz and 4 kHz. → Task 4.
4. **No style or mood is much louder or quieter than another:** RMS of every style × mood sits within 4 dB of the others, and no sample is NaN or clipped. → Task 4.
5. **A seed that is not `YYYY-MM-DD-HHMM`** (manual runs, tests): `compose` still renders deterministically. → Task 3.

---

## File Structure

| File | Responsibility after this change |
|---|---|
| `scripts/ig_reel/story.py` | owns `MOODS`, the `mood` schema line, `normalize_mood` |
| `scripts/ig_reel/accounts.py` | owns `MUSIC_STYLES`, `DEFAULT_MUSIC_STYLE`, validation, `music_style(cfg)` |
| `scripts/ig_reel/music.py` | mood tables, style voices, motif, `pick_track`, `compose`, listening CLI |
| `scripts/ig_reel/reel.py` | passes style and mood into `compose` |
| `scripts/ig_reel_daily.py` | puts the style in `meta`, logs and reports style and mood |
| `scripts/ig_reel/selfcheck.py` | all tests |

---

### Task 1: Mood in the story

**Files:**
- Modify: `scripts/ig_reel/story.py` (`STORY_SCHEMA_HINT` at line 21, `apply_story_limits` at line 342)
- Test: `scripts/ig_reel/selfcheck.py` (story section, after line 165)

**Interfaces:**
- Produces: `story.MOODS: tuple[str, ...] = ("curious", "wonder", "energetic", "mysterious", "uplifting")`; `story.normalize_mood(raw) -> str` (a name from `MOODS`, or `""`); after `apply_story_limits(data)`, `data["mood"]` is always a `str` from `MOODS` or `""`.

- [ ] **Step 1: Create the branch and commit the spec and this plan**

```bash
git checkout -b feat/ig-reel-account-music
git add docs/superpowers/specs/2026-11-16-ig-reel-account-music-design.md docs/superpowers/plans/2026-11-16-ig-reel-account-music.md
git commit -m "docs: IG Reel per-account, per-post music design and plan"
```

- [ ] **Step 2: Write the failing test** (add `MOODS, normalize_mood` to the `ig_reel.story` import at line 14)

```python
# mood: recognised despite case/spaces; anything else is "" and never an error
assert MOODS == ("curious", "wonder", "energetic", "mysterious", "uplifting")
assert normalize_mood("Curious ") == "curious" and normalize_mood("WONDER") == "wonder"
for bad in (None, 5, ["wonder"], "", "sedih", {"mood": "wonder"}):
    assert normalize_mood(bad) == "", bad
for raw, want in (("  Mysterious", "mysterious"), (None, ""), (7, "")):
    d = {"hook": "a b", "beats": [], "mood": raw}
    apply_story_limits(d)
    assert d["mood"] == want, (raw, d["mood"])
d = {"hook": "a b", "beats": []}
apply_story_limits(d)
assert d["mood"] == ""
assert '"mood"' in STORY_SCHEMA_HINT and all(m in STORY_SCHEMA_HINT for m in MOODS)
```

(`STORY_SCHEMA_HINT` also joins the import.)

- [ ] **Step 3: Run it** — `python3 scripts/ig_reel/selfcheck.py` → fails with `ImportError: cannot import name 'MOODS'`.

- [ ] **Step 4: Implement**
  - `MOODS` constant and `normalize_mood(raw) -> str` in `story.py`.
  - `apply_story_limits` sets `data["mood"] = normalize_mood(data.get("mood"))`.
  - Add this line to `STORY_SCHEMA_HINT`, after the `"cta"` line, exactly:
    `"mood": "satu dari: curious | wonder | energetic | mysterious | uplifting — suasana cerita ini, untuk musik latar",`
  - `check_story` is not changed: mood produces neither hard nor soft errors.

- [ ] **Step 5: Run it** — selfcheck exits 0.

- [ ] **Step 6: Commit** — `git commit -am "feat(ig-reel): story carries a mood for the soundtrack"`

---

### Task 2: Music style in the account file

**Files:**
- Modify: `scripts/ig_reel/accounts.py` (`validate_account`), `scripts/ig_reel/accounts/ai-labs.json`, `scripts/ig_reel/accounts/kaliajatau.json`
- Test: `scripts/ig_reel/selfcheck.py` (accounts section, after line 284)

**Interfaces:**
- Produces: `accounts.MUSIC_STYLES = ("cinematic", "electronic")`; `accounts.DEFAULT_MUSIC_STYLE = "cinematic"`; `accounts.music_style(cfg: dict) -> str` (the account's style, default when the block or key is absent).

- [ ] **Step 1: Write the failing test** (add `MUSIC_STYLES, music_style` to the `ig_reel.accounts` import at line 213; `KALI` and `LABS` are the loaded account dicts already in that section)

```python
assert MUSIC_STYLES == ("cinematic", "electronic")
assert music_style(LABS) == "electronic" and music_style(KALI) == "cinematic"
_NO_MUSIC = {k: v for k, v in KALI.items() if k != "music"}
assert validate_account(_NO_MUSIC) == [] and music_style(_NO_MUSIC) == "cinematic"
assert validate_account({**KALI, "music": {}}) == [] and music_style({**KALI, "music": {}}) == "cinematic"
for bad in ("electronic", {"style": 3}, {"style": "jazz"}, [], {"style": ""}):
    errs = validate_account({**KALI, "music": bad})
    assert any(e.startswith("music") for e in errs), (bad, errs)
```

- [ ] **Step 2: Run it** — fails with `ImportError: cannot import name 'MUSIC_STYLES'`.

- [ ] **Step 3: Implement**
  - Constants and `music_style(cfg)` in `accounts.py`.
  - `validate_account`: `music` may be absent; if present it must be a dict; `style`, if present, must be one of `MUSIC_STYLES`. Error text: `music: must be an object like {"style": "cinematic|electronic"}` and `music.style: must be one of cinematic, electronic`.
  - `ai-labs.json`: add `"music": {"style": "electronic"}`. `kaliajatau.json`: add `"music": {"style": "cinematic"}`.

- [ ] **Step 4: Run it** — selfcheck exits 0.

- [ ] **Step 5: Commit** — `git commit -am "feat(ig-reel): account files name a music style"`

---

### Task 3: Mood drives scale, progression, rhythm and key

Keeps today's voices (they become the `cinematic` style in Task 4); this task makes the *notes and rhythm* follow the mood.

**Files:**
- Modify: `scripts/ig_reel/music.py`
- Test: `scripts/ig_reel/selfcheck.py` (music section, lines 304–319 — replace the `pick_track` assertions)

**Interfaces:**
- Consumes: `story.MOODS` (Task 1).
- Produces:
  - `music.pick_track(seed: str, mood: str | None = None) -> tuple[str, str, tuple[int, ...]]` — `(mood, key, progression)`; `key` is one of `"A", "C", "D", "E", "F#", "G"`; `progression` is four 0-based scale degrees.
  - `music.compose(seed, beats, out_wav, style="cinematic", mood=None, bpm=BPM, sr=44100) -> dict` with keys `style`, `mood`, `key` (e.g. `"D dorian"`), `progression` (list of four roman-free degree strings, e.g. `["1", "4", "1", "7"]`), `seconds`. `style` is accepted and returned here; it changes the sound in Task 4.

Pinned values:

```python
KEY_ROOTS = {"A": 57, "C": 48, "D": 50, "E": 52, "F#": 54, "G": 55}   # midi, unchanged from today
MOOD_SPECS = {  # scale name, scale semitones, progressions (0-based degrees), pad low-pass Hz
    "curious":    ("dorian",   (0, 2, 3, 5, 7, 9, 10), [(0, 3, 0, 6), (0, 6, 3, 3), (0, 2, 3, 0), (0, 3, 6, 0)], 1600),
    "wonder":     ("lydian",   (0, 2, 4, 6, 7, 9, 11), [(0, 1, 0, 4), (0, 4, 1, 0), (0, 1, 5, 4), (0, 5, 1, 0)], 2400),
    "energetic":  ("minor",    (0, 2, 3, 5, 7, 8, 10), [(0, 5, 2, 6), (0, 3, 5, 4), (5, 6, 0, 0), (0, 6, 5, 6)], 2800),
    "mysterious": ("phrygian", (0, 1, 3, 5, 7, 8, 10), [(0, 1, 0, 6), (0, 1, 2, 1), (0, 6, 1, 0), (0, 0, 1, 6)], 900),
    "uplifting":  ("major",    (0, 2, 4, 5, 7, 9, 11), [(0, 4, 5, 3), (0, 5, 3, 4), (3, 4, 0, 0), (0, 3, 0, 4)], 2600),
}
```

A chord on degree `d` is the scale's degrees `d, d+2, d+4` (wrapping an octave up). Rhythm per mood, on the existing kick/hat/sub layers:

| Mood | Kick | Hat | Arpeggio |
|---|---|---|---|
| `curious` | every beat from bar 2 | offbeat eighths | eighths, twist → CTA |
| `wonder` | beats 1 and 3 (half-time) | none | quarter notes |
| `energetic` | every beat from bar 2 | every sixteenth offbeat (double-time) | eighths, louder |
| `mysterious` | beat 1 of each bar only | none | sparse: every third eighth |
| `uplifting` | every beat from bar 2 | offbeat eighths | eighths |

All moods keep today's CTA behaviour (rhythm thins from the CTA downbeat), the riser before the twist, and impacts on the twist and CTA downbeats.

Selection rules:
- Mood: `mood` if it is in `MOODS`, else `MOODS[sha256(seed) % 5]`.
- Key: for a `YYYY-MM-DD-HHMM` seed, `sorted(KEY_ROOTS)[(sha256(date) + slot) % 6]`, slot from the hour as today (`<10`, `<14`, `<18`, else). Otherwise from `sha256(seed)`.
- Progression: `sha256(seed + "|" + mood)` indexes the mood's list.

- [ ] **Step 1: Write the failing test** (replace lines 304–319; keep the surrounding `HAVE_NUMPY` guard)

```python
from ig_reel.music import MOOD_SPECS, compose, pick_track
from ig_reel.story import MOODS

tmp = pathlib.Path(tempfile.mkdtemp())
assert set(MOOD_SPECS) == set(MOODS)
assert all(len(spec[2]) >= 4 for spec in MOOD_SPECS.values())
SEED = "2026-11-16-0730"
info = compose(SEED, 46, tmp / "a.wav", mood="curious")
assert info["style"] == "cinematic" and info["mood"] == "curious" and info["key"].endswith(" dorian"), info
assert abs(info["seconds"] - 28.6) < 0.01, info
sr, data = wavfile.read(tmp / "a.wav")
assert data.ndim == 2 and data.shape[1] == 2 and abs(len(data) / sr - 28.6) < 0.01
assert abs(data).max() / 32767 <= 0.9, abs(data).max()
compose(SEED, 46, tmp / "b.wav", mood="curious")
assert (tmp / "a.wav").read_bytes() == (tmp / "b.wav").read_bytes(), "same inputs must give identical audio"
# every mood renders and differs from every other mood on the same seed
mood_bytes = {}
for m in MOODS:
    compose(SEED, 46, tmp / f"{m}.wav", mood=m)
    mood_bytes[m] = (tmp / f"{m}.wav").read_bytes()
assert len(set(mood_bytes.values())) == len(MOODS)
# unknown / missing mood falls back deterministically, never raises
for bad in (None, "", "sedih"):
    fb = compose(SEED, 46, tmp / "fb.wav", mood=bad)
    assert fb["mood"] in MOODS and fb["mood"] == pick_track(SEED)[0]
# a seed that is not a date still renders deterministically
x = compose("manual-run", 46, tmp / "x1.wav"); compose("manual-run", 46, tmp / "x2.wav")
assert x["mood"] in MOODS and (tmp / "x1.wav").read_bytes() == (tmp / "x2.wav").read_bytes()
# four slots of one day: four different keys, even when all four share a mood
for day in range(1, 31):
    keys = [pick_track(f"2026-11-{day:02d}-{hm}", "wonder")[1] for hm in ("0815", "1145", "1635", "1930")]
    assert len(set(keys)) == 4, (day, keys)
assert pick_track("2026-11-16-0815", "wonder") == pick_track("2026-11-16-0815", "wonder")
```

- [ ] **Step 2: Run it** — fails with `ImportError: cannot import name 'MOOD_SPECS'`.

- [ ] **Step 3: Implement** in `music.py`: the tables above replace `KEYS`, `CHORDS`, `PROGRESSIONS`, `COMBOS`; `pick_track` and `compose` take the new signatures; the kick/hat/arpeggio loops read the mood's rhythm row; the pad low-pass uses the mood's cutoff. Update the module docstring to describe mood. Import `MOODS` from `.story`.

- [ ] **Step 4: Run it** — selfcheck exits 0. `reel.py` still calls `compose(seed, TOTAL_BEATS, wav)` and keeps working (defaults).

- [ ] **Step 5: Commit** — `git commit -am "feat(ig-reel): soundtrack scale, progression and rhythm follow the post's mood"`

---

### Task 4: Styles and the signature motif

**Files:**
- Modify: `scripts/ig_reel/music.py`
- Test: `scripts/ig_reel/selfcheck.py` (music section, after Task 3's assertions)

**Interfaces:**
- Consumes: `accounts.MUSIC_STYLES`, `accounts.DEFAULT_MUSIC_STYLE` (Task 2); `compose` / `MOOD_SPECS` (Task 3).
- Produces: `music.STYLES: dict[str, ...]` with exactly the keys in `MUSIC_STYLES`; `music.MOTIFS = {"cinematic": (0, 4, 2), "electronic": (0, 2, 4, 7)}` (0-based scale degrees; 7 = the octave); `compose(..., style=...)` raises `ValueError` for an unknown style; a listening CLI `python3 -m ig_reel.music <style> <mood> <seed> <out.wav>` (run from `scripts/`).

Voices (spec table). The implementer writes the synthesis; these are the decisions:

| Layer | `cinematic` | `electronic` |
|---|---|---|
| Pad | today's detuned-saw pad, slow swell | same notes, square/saw blend, volume ducked on every beat (pumping) |
| Bass | sine sub **plus its octave** at about a third of the level | saw bass through a low-pass with harmonics up to ~800 Hz |
| Kick | today's soft kick | shorter, punchier, higher click |
| Hat | today's noise hat | shorter, brighter; plus a quiet digital blip on some offbeats (seeded) |
| Arpeggio | soft sine pluck with a second harmonic (piano-like), slow decay | bright square/saw pluck, fast decay, short delay echo |
| Texture | airy high shimmer on the twist and payoff | 2–3 seeded glitch stutters (a repeated 1/16 slice) in the why/payoff scenes |
| Motif voice | the cinematic pluck, one octave up | the electronic pluck |

Motif placement, both styles: notes on consecutive half-beats starting at beat 0 of the hook scene, in the track's key and scale, clearly audible; the same notes once more, at about half the level, starting on the CTA downbeat.

- [ ] **Step 1: Write the failing test**

```python
import numpy as np
from ig_reel.accounts import MUSIC_STYLES
from ig_reel.music import MOTIFS, STYLES

assert set(STYLES) == set(MUSIC_STYLES) == set(MOTIFS)
def _load(path):
    _sr, d = wavfile.read(path)
    return d.astype(np.float64) / 32767
rms_db, clips = {}, {}
for st in MUSIC_STYLES:
    for m in MOODS:
        p = tmp / f"{st}-{m}.wav"
        info = compose(SEED, 46, p, style=st, mood=m)
        assert info["style"] == st and abs(info["seconds"] - 28.6) < 0.01, info
        x = _load(p)
        assert np.isfinite(x).all() and np.abs(x).max() <= 0.9, (st, m)
        clips[(st, m)] = p.read_bytes()
        rms_db[(st, m)] = 20 * np.log10(np.sqrt((x ** 2).mean()))
        # phone speakers: at least 60% of the energy sits between 150 Hz and 4 kHz
        spec = np.abs(np.fft.rfft(x.mean(axis=1))) ** 2
        freqs = np.fft.rfftfreq(len(x), 1 / 44100)
        assert spec[(freqs >= 150) & (freqs <= 4000)].sum() / spec.sum() >= 0.6, (st, m)
        # the opening is not near-silent: the motif is in the first 1.2 s (two beats)
        head = x[: int(1.2 * 44100)]
        assert np.sqrt((head ** 2).mean()) >= 0.25 * np.sqrt((x ** 2).mean()), (st, m)
assert len(set(clips.values())) == len(MUSIC_STYLES) * len(MOODS), "every style × mood must differ"
assert max(rms_db.values()) - min(rms_db.values()) <= 4.0, rms_db
try:
    compose(SEED, 46, tmp / "bad.wav", style="jazz")
    raise AssertionError("unknown style must raise")
except ValueError:
    pass
```

- [ ] **Step 2: Run it** — fails with `ImportError: cannot import name 'MOTIFS'`.

- [ ] **Step 3: Implement** `STYLES`, `MOTIFS`, the two voice sets, the motif, and the `if __name__ == "__main__":` CLI in `music.py`. If a threshold in Step 1 fails, change the mix, not the threshold.

- [ ] **Step 4: Run it** — selfcheck exits 0.

- [ ] **Step 5: Commit** — `git commit -am "feat(ig-reel): cinematic and electronic music styles with a signature motif"`

---

### Task 5: Wire account and story into the render, samples, docs, PR

**Files:**
- Modify: `scripts/ig_reel/reel.py:77-78`, `scripts/ig_reel_daily.py` (lines 765, 810–813, the two `REPORT` lines at 820 and 837), `docs/ig-reel-add-account.md`, `AGENTS.md` (IG Reel bullets), `docs/status.md`
- Test: `scripts/ig_reel/selfcheck.py` (render section, line 372 onward)

**Interfaces:**
- Consumes: `accounts.music_style(cfg)`, `story["mood"]`, `compose(..., style=, mood=)`.
- Produces: `meta_base["music_style"]` (optional; absent = `cinematic`); `render_reel(...)["music"]` now carries `style` and `mood`; `REPORT` JSON gains `music_style` and `music_mood`.

- [ ] **Step 1: Write the failing test** — in the render section, where `render_reel` is already called with a sample story and meta, pass `"music_style": "electronic"` in the meta and `"mood": "mysterious"` in the story, then:

```python
assert res["music"]["style"] == "electronic" and res["music"]["mood"] == "mysterious", res["music"]
```

If that section is skipped locally (no Chrome), also add this numpy-only check in the music section so the wiring is tested everywhere:

```python
import inspect
from ig_reel import reel as _reel
src = inspect.getsource(_reel.render_reel)
assert 'meta_base.get("music_style"' in src and 'story.get("mood")' in src
```

- [ ] **Step 2: Run it** — fails on the new assertion.

- [ ] **Step 3: Implement**
  - `reel.py`: `compose(seed, TOTAL_BEATS, wav, style=meta_base.get("music_style", DEFAULT_MUSIC_STYLE), mood=story.get("mood"))`; mention `music_style` in the `render_reel` docstring.
  - `ig_reel_daily.py`: add `"music_style": music_style(ACCOUNT)` to `meta` at line 765; the `reel: built …` log reads `music {style}/{mood} {key} {progression}`; both `REPORT` dicts gain `music_style` and `music_mood` from `res["music"]`.
  - `docs/ig-reel-add-account.md`: document the `music.style` field and the two styles; adding a new style means adding it to `MUSIC_STYLES`, `STYLES` and `MOTIFS`.
  - `AGENTS.md`: one sentence in the "IG Reel" architecture bullet — music = account style × story mood, listening CLI. `docs/status.md`: note the change under the IG Reel section.

- [ ] **Step 4: Run it** — selfcheck exits 0; `npm run typecheck` exits 0 (unchanged, confirms nothing else broke).

- [ ] **Step 5: Render the sample set for the owner** (acceptance for spec goals 1 and 2 — do not open the PR as ready before the owner has listened)

```bash
mkdir -p .ig-reel-out/music-samples && cd scripts && for st in cinematic electronic; do for m in curious wonder energetic mysterious uplifting; do python3 -m ig_reel.music $st $m 2026-11-16-0815 ../.ig-reel-out/music-samples/$st-$m.wav; done; done
```

Expected: 10 WAV files of 28.6 s in `.ig-reel-out/music-samples/` (gitignored). Tell the owner where they are and ask them to listen on a phone.

- [ ] **Step 6: Commit, push, open the PR**

```bash
git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .   # must print nothing
git commit -am "feat(ig-reel): render uses the account's music style and the story's mood"
git push -u origin feat/ig-reel-account-music
```

PR body per AGENTS.md: `## Summary` (link the spec and this plan), `## What changed`, `## Verification` (selfcheck result, typecheck, the sample set, and the dry runs below — only those actually run), `## Out of scope` (Suno/Udio, Cerpenek, narration).

- [ ] **Step 7: Dry-run each account from the branch**

```bash
gh workflow run ig-reel.yml --ref feat/ig-reel-account-music -f dry_run=true -f account=kaliajatau
gh workflow run ig-reel.yml --ref feat/ig-reel-account-music -f dry_run=true -f account=ai-labs
```

(Check the workflow's real input names in `.github/workflows/ig-reel.yml` first.) Expected in each log: `music cinematic/<mood>` for `kaliajatau`, `music electronic/<mood>` for `ai-labs`, and a `REPORT` line with `"status": "dry-run"`, `music_style` and `music_mood`. Record both run URLs in the PR's Verification section.
