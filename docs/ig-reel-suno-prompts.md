# IG Reel music: Suno prompts (one per account × mood)

Paste these into Suno's **Advanced** mode (called "Custom" before V6). There is one track per account and mood: 2 accounts × 5 moods = 10 tracks.
The mood names match `story.MOODS` in `scripts/ig_reel/story.py`. The story AI picks one of them for each post.

> **Rights.** Songs made on Suno **Free** are non-commercial, and upgrading later does not change that.
> Use Free only to judge the sound in a `dry_run=true` Reel. Nothing made on Free gets posted unless you
> explicitly accept that limit for these accounts. Make the real library on a plan with commercial rights.
> Check the current terms on Suno's own pricing page; this doc does not guarantee anything about licensing.

## How to fill Suno's fields

Open **Create** (left toolbar, or suno.com/create) and pick **Advanced** at the top. The other choices there are Simple and Sounds.

| Suno field | What to put |
|---|---|
| **Lyrics** | **Leave it empty** on the first try. An empty Lyrics box means instrumental. If you see an Instrumental switch, turn it on as well. If the take has a long intro, try again with the `Structure` block pasted here: section tags only, no words. |
| **Styles** | The `Style` line of the track. Each is under 200 characters. |
| **Advanced Options → Exclude** | The shared exclusion line below. |
| **Variety slider** (V6, if shown) | 0, so Suno keeps the style text as you typed it. |
| **Title** | The suggested file name without `.mp3`, so the downloads are easy to sort. |

**Exclusions** (same for all 10 tracks):

```
vocals, singing, choir, spoken word, rap, humming, long intro, slow fade-in, heavy distortion, dubstep drop, aggressive, trailer braams
```

Rules every prompt follows: instrumental, **100 BPM, 4/4**, hook in the first 1–3 seconds, background-level energy that leaves room for on-screen text, a short clean ending, no artist names and no references to existing songs.

**Length.** Suno usually writes 1–3 minutes no matter what the structure says. That is fine: the pipeline uses the **first 28.6 s** and fades the last 1.5 s. So judge each take on its **first 30 seconds**: does the hook start right away, and does it hold the energy until 0:28?

**Which take to keep.** Suno makes two takes per generation. Keep the one whose opening is strongest and whose tempo sounds steady. A drifting tempo makes the scene cuts miss the beat.

---

## `ai-labs` (@ailabs01.id): futuristic electronic, intelligent, never aggressive

### curious → `scripts/ig_reel/music_library/ai-labs/curious-1.mp3`

Style:
```
minimal electronic, instrumental, 100 BPM, 4/4, dorian minor, plucky synth arpeggio, soft electronic kick, light glitch ticks, digital pulses, clever, clean background
```

Structure:
```
[Instrumental]
[Intro: plucky synth arpeggio hook starts on beat one]
[Main Theme: arpeggio hook, soft kick, light glitch ticks]
[Variation: same hook, added digital pulses, slightly fuller]
[Outro: hook resolves, short clean stop]
[End]
```

### wonder → `scripts/ig_reel/music_library/ai-labs/wonder-1.mp3`

Style:
```
digital ambient, instrumental, 100 BPM, 4/4, lydian major, airy synth pads, shimmering arpeggio, half-time electronic beat, spacious, futuristic wonder, clean background
```

Structure:
```
[Instrumental]
[Intro: shimmering arpeggio hook and airy pad start immediately]
[Main Theme: half-time electronic beat under the arpeggio]
[Variation: pads open up, subtle digital sparkles]
[Outro: arpeggio rings out, short clean ending]
[End]
```

### energetic → `scripts/ig_reel/music_library/ai-labs/energetic-1.mp3`

Style:
```
future bass, instrumental, 100 BPM, 4/4, minor key, bright supersaw chords, punchy electronic drums, fast hi-hats, digital pulses, confident not aggressive, background
```

Structure:
```
[Instrumental]
[Intro: bright supersaw chord hook with drums from the first bar]
[Main Theme: punchy drums, fast hi-hats, chord hook]
[Variation: same hook, rhythmic digital pulses, no drop]
[Outro: final chord hit, clean stop]
[End]
```

### mysterious → `scripts/ig_reel/music_library/ai-labs/mysterious-1.mp3`

Style:
```
dark minimal electronic, instrumental, 100 BPM, 4/4, phrygian minor, deep synth bass, sparse digital pulses, subtle glitch, filtered pads, no hi-hats, intelligent
```

Structure:
```
[Instrumental]
[Intro: deep synth bass motif starts immediately]
[Main Theme: sparse pulses, filtered pad, subtle glitch]
[Variation: pad filter opens slowly, bass motif repeats]
[Outro: bass motif ends on a low note, clean stop]
[End]
```

### uplifting → `scripts/ig_reel/music_library/ai-labs/uplifting-1.mp3`

Style:
```
modern synthwave, instrumental, 100 BPM, 4/4, major key, warm analog synth pads, bright arpeggio, steady electronic drums, optimistic, smooth, clean background
```

Structure:
```
[Instrumental]
[Intro: bright arpeggio hook with warm pad from the first beat]
[Main Theme: steady electronic drums, arpeggio hook]
[Variation: lead synth doubles the hook, slightly fuller]
[Outro: hook resolves to the home chord, clean ending]
[End]
```

---

## `kaliajatau` (@kaliajatau.id): cinematic documentary, spacious, credible, science wonder

### curious → `scripts/ig_reel/music_library/kaliajatau/curious-1.mp3`

Style:
```
cinematic documentary, instrumental, 100 BPM, 4/4, dorian minor, pizzicato strings, soft piano motif, light low percussion, curious, inquisitive, spacious score
```

Structure:
```
[Instrumental]
[Intro: pizzicato and piano motif start immediately]
[Main Theme: motif over light low percussion]
[Variation: soft string pad joins, motif repeats]
[Outro: motif ends on a question-like note, clean stop]
[End]
```

### wonder → `scripts/ig_reel/music_library/kaliajatau/wonder-1.mp3`

Style:
```
cinematic documentary, instrumental, 100 BPM, 4/4, lydian major, warm string pads, soft piano, gentle shimmer, half-time soft drums, awe, science wonder, spacious
```

Structure:
```
[Instrumental]
[Intro: soft piano melody and warm strings from the first beat]
[Main Theme: half-time soft drums, piano melody, shimmer]
[Variation: strings swell gently, not epic]
[Outro: melody settles, short clean ending]
[End]
```

### energetic → `scripts/ig_reel/music_library/kaliajatau/energetic-1.mp3`

Style:
```
cinematic documentary, instrumental, 100 BPM, 4/4, minor key, driving staccato strings, soft taiko pulse, piano ostinato, forward momentum, confident, not trailer
```

Structure:
```
[Instrumental]
[Intro: staccato string ostinato with taiko pulse from bar one]
[Main Theme: piano ostinato joins, steady drive]
[Variation: low strings add weight, same tempo]
[Outro: final hit, clean stop]
[End]
```

### mysterious → `scripts/ig_reel/music_library/kaliajatau/mysterious-1.mp3`

Style:
```
dark cinematic documentary, instrumental, 100 BPM, 4/4, phrygian minor, low drones, soft deep booms, sparse piano notes, tense strings, mysterious, deep space
```

Structure:
```
[Instrumental]
[Intro: low drone and sparse piano motif start immediately]
[Main Theme: soft deep booms on the beat, tense strings]
[Variation: motif repeats higher, drone deepens]
[Outro: last boom, drone cuts cleanly]
[End]
```

### uplifting → `scripts/ig_reel/music_library/kaliajatau/uplifting-1.mp3`

Style:
```
cinematic documentary, instrumental, 100 BPM, 4/4, major key, warm strings, hopeful piano melody, soft steady percussion, uplifting, discovery, credible, gentle
```

Structure:
```
[Instrumental]
[Intro: hopeful piano melody with warm strings from the first beat]
[Main Theme: soft steady percussion under the melody]
[Variation: strings carry the melody, a little fuller]
[Outro: resolves to the home chord, clean ending]
[End]
```

---

## On Suno Free: what to try first

Free gives only a few downloads (reported as 7 trial downloads for the life of the account), so generate and listen to as many as the daily credits allow, but download only **two**:

1. `ai-labs/energetic-1` (the mood where the synth sounded weakest), and
2. `kaliajatau/wonder-1` (this account's most typical science-wonder post).

Put them at the paths above. Before committing, cut each one to 30 s so the repo stays small: `ffmpeg -i in.mp3 -af silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05 -t 30 -map_metadata -1 -b:a 192k out.mp3` (cuts Suno's leading silence too). Adding a track needs no code change, because the pipeline picks up any `<mood>-<n>.mp3` in the account folder. Then tell me whether the sound is right. Next step: one `dry_run=true` Reel per account with these tracks, so you can judge them in a real video before we design the library.

**Listening checklist** for each take, first 30 s only:

- [ ] No vocals, humming or choir.
- [ ] The hook starts within 1–3 s.
- [ ] The beat is steady and close to 100 BPM. Tap along: about 5 taps in 3 s.
- [ ] Calm enough to read text over.
- [ ] It fits the account (electronic vs cinematic) and the mood.
