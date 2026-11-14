# IG Reel cinematic redesign — design

**Date:** 2026-11-15 · **Size:** project · **Owner decisions marked (owner); everything else is the designer's call and can be overridden.**

## Intent
The daily @kaliajatau.id Reel (`scripts/ig_reel_daily.py`, workflow `ig-reel.yml`, 4 slots/day) works but looks standard: still slides on navy, a 38%-opacity illustration, fixed CTA, no designed cover. Goal (owner): **more views from non-followers, more saves and shares, more follows.** Everything — story, type, cover, imagery, motion, music, caption, CTA — is redesigned toward that: stop the scroll in the first second, hold to the end, give a reason to save/send/follow.

## Goals
- One story per Reel (owner) built on a curiosity gap, ~25–30 s.
- Cinematic documentary look (owner): full-bleed illustration with slow Ken Burns motion, Anton headlines, yellow key-word highlights, top progress bar.
- Real motion via animated HTML captured frame-by-frame (owner).
- Music only, upgraded (owner): composed original track, cuts and reveals on the beat. No voiceover.
- A designed cover that is also the first frame.
- Story-specific CTA and a caption built for saves/shares/comments.

## Non-goals
- Voiceover/TTS, trending/licensed audio, multi-story or countdown formats.
- Changing the schedule, Buffer/Cloudinary publishing, the image-provider chain, or the 4 D1 rows.
- Editing `scripts/ig-kit/*` (kept byte-identical to the playbook's published kit).

## Anti-goals (fail even if it "works")
- Any claim, number, date or source not present in the fetched article text (fabrication).
- Text unreadable on a phone (contrast, size, or covered by IG's own UI).
- Every Reel looking/sounding identical day after day.
- A blank, mid-fade or text-less cover/first frame.

## Constraints (existing, keep)
- Playbook rules in `prompts/ig-reel-daily.md`: hook → content → CTA; **source + date on every content scene**; AI images contain no text (all text in HTML); ≤ ~6 AI images per run; original royalty-free music; never post half-finished work; Buffer post as reel with `shareNow`, `shouldShareToFeed: true`, `isAiGenerated: true`; confirm `sent`.
- Fonts must be local (renderer has no Google Fonts access). CI: `ubuntu-latest`, Python, ffmpeg, headless Chrome via Playwright (`ig-reel.yml`).
- Indonesian copy; dedupe against the last 7 days of Buffer captions (`recent_post_captions`).
- 1080×1920, 30 fps, H.264 + AAC.

## Approaches
**Format** (owner picked A): A one story per Reel (watch-through, shares) · B countdown 5→1 (saves, but the "standard" list look) · C myth vs fact (needs a real myth daily → fabrication risk).
**Look** (owner picked A): A cinematic documentary · B editorial magazine · C bold pop. Mockups: `.superpowers/brainstorm/…/content/visual-direction.html`.
**Sound** (owner): music only, upgraded — voiceover rejected (unofficial TTS dependency, timing driven by voice).
**Motion** (owner picked A): **A animated HTML captured per frame by seeking animations in headless Chrome** · B static PNG layers animated with ffmpeg filters (can't do kinetic type/highlight sweeps cleanly) · Remotion/video libs rejected (new Node/React stack).

## Design

### 1. Story selection and grounding
1. `fetch_candidates()` (ScienceDaily, Phys.org, NASA RSS), interleaved round-robin across feeds before the 18-item cap (today ScienceDaily crowds the list), minus topics seen recently. Dedupe window: `recent_post_captions()` fetches the last **28** sent posts (= 7 days at 4/day; was 12).
2. **Pick:** one AI call ranks candidates for "wow + explainable in 25 s + visual" and returns an ordered shortlist of 3 refs.
3. **Fetch the article page** for the top ref; extract readable body text (strip tags/scripts/nav; keep paragraphs; cap ~6,000 chars). If fetch/extraction yields < 800 chars, try the next ref; if all 3 fail → `fail()` (no fabrication).
4. **Write:** one AI call produces the story JSON (schema below) **only from the article text**; validator + one repair retry, as today (`check_script` / `repair_prompt` pattern). Source name/date/link always come from the candidate, never from the AI.

Story JSON:
```json
{"hook": "≤ 7 words, curiosity gap, Indonesian",
 "hook_highlight": ["words of hook to color yellow"],
 "beats": [
   {"role": "context|twist|why|payoff", "text": "≤ 120 chars", "highlight": "exact substring to box (number/key phrase) or empty"}
 ],
 "cta": "story-specific share line ≤ 60 chars, e.g. 'Kirim ke teman yang suka luar angkasa 🚀'",
 "image_prompts": ["4 prompts: hook, context, twist, why/payoff — same subject, no text"],
 "caption": {"opener": "rephrased hook ≤ 120 chars", "body": "2–3 short lines", "question": "1 comment question", "save_line": "Simpan biar nggak lupa / kirim ke …"},
 "hashtags": ["5–8: broad + niche + Indonesian"]}
```
Rules in the prompt: exactly 4 beats in order context → twist → why → payoff; every number/name must appear in the article text (validator, designer's call: each digit-group in `hook`, `beats[].text`, `highlight` and `caption.*` must occur in the article text — normalising Indonesian decimal commas `1,5`↔`1.5` and thousands separators — else hard error → repair); "menurut studi"/"mungkin" for non-final findings.

### 2. Visual system (cinematic)
- **Fonts:** Anton (headlines) and Inter (body/labels), OFL `.ttf` committed under `scripts/ig-reel/fonts/` with their licenses, loaded via `@font-face` from local files. Highlight color `#FFD23F`, text `#FFFFFF`, body grey `#E6E6E6`, shadow/gradient black.
- **Imagery:** 4 AI illustrations per run (≤ 6 cap) via the existing `gen_image()` chain, each prompt suffixed with one shared style string, e.g. `cinematic film still, dramatic volumetric lighting, teal-and-amber grade, 35mm, shallow depth of field, film grain, vertical 9:16, no text, no letters, no logos` so the set looks like one film. Shown at full opacity under a bottom-heavy black gradient (text zone), never the 38% wash.
- **Safe area (designer's call, stricter of playbook §3.B and IG UI):** all text inside x 72–930, y 240–1480 (≥150 px clear on the right for IG's buttons; top bar and caption area clear).
- **Progress bar:** 6 px yellow bar at top (y≈150), fills across the whole Reel.
- **Source line** on every content scene: `Sumber: <source> · <date>` small Inter, above the bottom safe edge.
- **Handle** `@kaliajatau.id` small on hook and CTA.

### 3. Scenes, timing and motion (100 BPM ⇒ beat 0.6 s; all boundaries on beats)
| Scene | Beats | ≈s | Content | Motion |
|---|---|---|---|---|
| Hook / cover | 5 | 3.0 | img 1, kicker `FAKTA SAINS`, hook in Anton ~120 px, highlight words yellow | **Fully visible at frame 0** (cover); slow push-in 1.00→1.08 |
| Context | 10 | 6.0 | img 2, beat text | Ken Burns pan; words reveal one per ~⅛ beat; source line |
| Twist | 10 | 6.0 | img 3, beat text + yellow highlight box on `highlight` | push-in; box sweeps in on a downbeat |
| Why | 8 | 4.8 | img 4, beat text | pan opposite direction |
| Payoff | 6 | 3.6 | img 4 darker, payoff text large | slow push; "SIMPAN" chip pops on beat |
| CTA | 7 | 4.2 | blurred img 1, `cta` line, `Ikuti @kaliajatau.id buat fakta gila berikutnya` | elements stagger in on beats |
Total 46 beats ≈ 27.6 s. Cuts between scenes: 6-frame crossfade or a quick zoom-through, on the bar line.

**Cover:** Buffer `thumbnailOffset: 0` (was 500) so the cover = the fully composed first frame; update `prompts/ig-reel-daily.md` + `docs/status.md` which pin 500. Verify on the first live post that Buffer honours 0.

### 4. Renderer (new, `scripts/ig-reel/`)
- `scenes.py` — builds one self-contained HTML document per scene (fonts + images as local file/data URIs) whose animations use CSS/Web Animations with explicit durations.
- `capture.py` — Playwright + the existing `/usr/bin/google-chrome`: loads each scene, pauses all animations (`document.getAnimations()`), and for frame *n* sets every animation's `currentTime = n·1000/30` then screenshots 1080×1920 PNG (or JPEG q≈92 to cut I/O). Deterministic; no real-time recording.
- `music.py` — numpy/scipy synth, 100 BPM, 46 beats + ~1 s tail: cinematic pad (detuned saws, low-pass), sub pulse on beats, soft kick/hat from bar 2, riser into the twist, hit on the twist highlight and on the CTA; key and chord progression picked from a small pool seeded by **date + slot time** (4 Reels/day must not share a track); −14 LUFS-ish normalization, short fade-out. Writes `music.wav`.
- `assemble.py` — ffmpeg: frames → H.264 (`-crf 18 -pix_fmt yuv420p -r 30`) + `music.wav` → AAC → `ig_reel.mp4`.
- `ig_reel_daily.py` keeps orchestration (RSS, dedupe, AI, images, Cloudinary, Buffer, `fail`, DRY_RUN, REPORT) and calls the new modules instead of `make_scene_html`/`hook_scene`/`cta_scene`/`build_reel.py`. `check_kit()` stays (ig-kit `cf_image.py` + `render_html.py` are still used for images/PNG previews).
- CI: install an emoji font (`fonts-noto-color-emoji`) for CTA emoji; add a pinned `actions/upload-artifact` step that uploads `ig_reel.mp4` + per-scene sample frames on dry runs.
- Render budget: ~830 frames; target < 4 min on `ubuntu-latest`; workflow timeout raised only if measured necessary.

### 5. Caption and CTA
Caption assembled from `caption` fields: `opener` + blank line + `body` + blank line + `question` + blank line + `save_line` + blank line + `Sumber: <source> (<link>)` + blank line + hashtags. ≤ 2,200 chars (IG limit); target 400–700. In-video CTA = `cta` (story-specific share line) + fixed follow line.

## Verification
- `DRY_RUN=true` workflow dispatch: Reel built, duration 26–30 s, 30 fps, 1080×1920, audio present; artifact uploaded for review.
- Frame checks: frame 0 shows complete hook text (cover); one frame per scene saved and inspected; text inside safe area.
- Grounding check: a story whose numbers aren't in the article text is rejected by the validator (unit check with a fixture).
- Two consecutive dry runs on different dates produce different music (key/progression) and different stories.
- First live post: Buffer status `sent`, cover = hook frame in the IG grid.

## Designer's calls folded in after builder check
Stricter safe area; music seeded per slot; 28-post dedupe window; CTA follow line not promising "daily"; grounding check covers hook + caption with number normalisation; RSS interleave; emoji font; dry-run artifact; thumbnailOffset docs.

## Left to the builder
Exact CSS/keyframes, word-reveal implementation, crossfade vs zoom-through cut, synth patch details, article text extraction heuristics per source, JPEG vs PNG frames, file layout inside `scripts/ig-reel/` (within the module split above).
