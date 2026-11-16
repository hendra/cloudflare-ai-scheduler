# IG Reel music: per-account sound, per-post mood — design

Date: 2026-11-16 · Status: awaiting owner approval

## Intent

Every Reel today gets the same kind of track. `scripts/ig_reel/music.py` varies only key and
chord progression from a date-and-slot seed; neither the account nor the post reaches it.
The owner wants the music to say which account you are on and to change with what each post
is about: it must fit the account's niche and fit the post.

## Goals

1. **Account identity.** `@ailabs01.id` and `@kaliajatau.id` sound clearly different from each
   other, every time.
2. **Post fit.** Within one account, a post's mood changes the track audibly (a mysterious
   story does not sound like an energetic tip).
3. **Variety.** Two posts with the same account and mood still differ (key, progression,
   melody), and a day's four slots never share a track.
4. **A recognisable opening.** Each account has a short signature motif in the first beats,
   so the Reel has a hook in the first 1–3 seconds and a subtle sonic logo.
5. Stays unattended, free, original by construction, and cut-synced.

## Non-goals

- Suno, Udio or any external music service, and any prompt deliverables for them.
- A Cerpenek account or its sound. It is not in the repo; its style is added when the account
  is, and may then be judged by ear against a pre-made track library.
- Narration ducking. The Reels have no voiceover.
- Changing the tempo, Reel length or scene grid.

## Anti-goals

- A post that fails, or posts late, because of anything about music or mood.
- Music that is louder, harsher or busier than today's to the point of competing with the
  on-screen text.
- Styles that differ on paper but sound the same on a phone speaker.

## Constraints

- **Grid is fixed:** 46 beats at 100 BPM, 27.6 s + 1.0 s tail = 28.6 s (`timeline.py`). Scene
  cuts, the riser and the impacts sit on this grid. Feel may change (half-time, double-time,
  swing, density); the BPM does not.
- **Deterministic:** the same seed, style and mood render byte-identical audio (`selfcheck.py`
  asserts this today).
- **Output contract unchanged:** stereo 44.1 kHz 16-bit WAV, peak ≤ −1 dBFS, 1.5 s fade-out.
- **Dependencies:** numpy and scipy only, as now.
- **Phone speakers:** bass must carry in its harmonics, not only in sub frequencies.
- Runs inside the GitHub Actions job; render time for music should stay in seconds.

## Approaches considered

- **A. Teach the code synth account and mood — chosen by the owner.** Unattended, free,
  cut-synced, no licensing question. Limit: synthesized timbres; electronic styles sound
  right, acoustic and traditional instruments would only be approximations.
- **B. A Suno/Udio track library per account,** picked by mood and trimmed. Real instrument
  sound, but a manual batch per account, tracks repeat across posts, cuts sync only roughly,
  and commercial use depends on the plan. Kept as an option for Cerpenek later.
- **C. A fresh Suno/Udio track per post.** Dropped: eight Reels a day by hand, or an
  unofficial API inside unattended runs.

## Design

### Two inputs: style (account) and mood (post)

**Style** comes from the account file: `"music": {"style": "<id>"}`. Styles are defined in
code in `music.py`; the account file only names one. `accounts.py` validates the id against
the known styles. A missing `music` block means `cinematic`, so an account file written
before this change still loads.

| Style | Account | Character | Voices |
|---|---|---|---|
| `electronic` | `ai-labs` | futuristic, clean, intelligent; modern synth, never aggressive | bright saw/square arpeggio, pulsing (ducked) pad, tight electronic kick and hat, digital blips and short glitch stutters, synth bass with audible harmonics |
| `cinematic` | `kaliajatau` | documentary, spacious, credible; science wonder | warm string-like pad, soft piano-like pluck, low soft drum and sub boom, airy shimmer, sparse percussion |

`cinematic` is the family today's track belongs to, so `@kaliajatau.id` keeps a familiar
sound while gaining mood. (Proposal — the owner's brief did not define this account's sound.)

**Mood** comes from the post. The story JSON gains one field, `"mood"`, chosen by the same AI
call that writes the story (news and tips both use `STORY_SCHEMA_HINT`):
`curious`, `wonder`, `energetic`, `mysterious`, `uplifting`.

`apply_story_limits` normalises it. A missing or unknown mood is **not** a story error: the
mood is then derived from the seed, so the post still ships and the track is still
reproducible.

| Mood | Scale colour | Rhythm | Brightness | Accents |
|---|---|---|---|---|
| `curious` | minor with a raised 6th (dorian) | light, steady, a little syncopation | medium | soft impacts |
| `wonder` | major with a raised 4th (lydian) | sparse, half-time | open, airy | wide, slow impacts |
| `energetic` | minor | full, driving, double-time hat | bright | strong impacts |
| `mysterious` | minor with a lowered 2nd (phrygian) | minimal, half-time, no hat | dark | deep, long impacts |
| `uplifting` | major | steady, warm | bright | medium impacts |

Each mood has its own list of chord progressions (at least four) written for its scale.

### What varies per post

- Mood (from the story) selects scale, progression list, rhythm pattern and brightness.
- The seed selects the key, one progression from the mood's list, and the notes of the
  arpeggio/melody.
- The key steps with the slot, so a day's four Reels always use four different keys even if
  all four share a mood. This replaces today's 24-combination guarantee in `pick_track`.

### Signature motif

Each style has one fixed short motif (3–4 notes, defined as scale steps), played in that
style's lead voice on the first beats of the hook scene and echoed quietly on the CTA
downbeat. It is transposed to the post's key and scale, so it is recognisable without being
the same recording every time. Today the first bar is pad and sub only; this gives the
opening a hook.

### Structure on the scene grid (unchanged in shape)

hook: motif + pad → context: rhythm enters → riser into the twist → twist: impact, arpeggio
enters → why/payoff: fullest section → CTA: impact, rhythm thins, motif echo, fade.

### Interfaces

- `compose(seed, beats, out_wav, style="cinematic", mood=None, bpm=BPM, sr=44100)` returns
  `{"style", "mood", "key", "progression", "seconds"}`.
- `render_reel` passes the account's style (through `meta_base`) and `story["mood"]`.
- `ig_reel_daily.py` logs style and mood in the `reel: built …` line and adds `music_style`
  and `music_mood` to the `REPORT` JSON.
- A small command renders one track for listening:
  `python3 -m ig_reel.music <style> <mood> <seed> <out.wav>`.

### Files touched

`scripts/ig_reel/music.py`, `accounts.py`, `story.py`, `reel.py`, `selfcheck.py`,
`scripts/ig_reel_daily.py`, `accounts/ai-labs.json`, `accounts/kaliajatau.json`,
`docs/ig-reel-add-account.md`, `AGENTS.md`, `docs/status.md`. `scripts/ig-kit/` is not touched.

## Verification

- `python3 scripts/ig_reel/selfcheck.py`:
  - every style × mood renders at 28.6 s, stereo, peak ≤ −1 dBFS;
  - same seed/style/mood twice is byte-identical;
  - same seed and mood in two styles differ, and same seed and style in two moods differ;
  - four slots of one day give four different keys, for 30 days, per style;
  - an unknown or missing mood falls back without raising; an unknown style id fails account
    validation.
- **By ear (owner):** a sample set — each style in all five moods, 10 WAVs — is rendered for
  the owner to listen to on a phone before the PR merges. This is the real acceptance test
  for goals 1 and 2.
- One `dry_run=true` dispatch per account; the log shows the expected style and a mood.

## Left to the builder

- Exact synthesis of each voice, the progressions, motif notes, and mix levels.
- Whether styles and moods are tables of parameters or small functions.
- How the seed-derived fallback mood is chosen.

## Calls made by Claude (not owner decisions)

- The five mood names and what each changes.
- `cinematic` as `@kaliajatau.id`'s style and as the default.
- Mood never blocks a post; it falls back.
- The key, not the progression, carries the "four different tracks a day" guarantee.
- The listening command and the sample set.
