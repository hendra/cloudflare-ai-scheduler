# IG Reel text quality: stronger hooks, copyable prompts — design (short)

## Intent

The owner wants the on-screen text of the Reels to pull people in: they should stop scrolling, watch to the end and act (save, share, follow). This applies to both accounts, `@kaliajatau.id` (science news) and `@ailabs01.id` (AI tips).

The owner also asked for one feature: a tip's example prompt goes in full in the caption, and the video's last card says it is there so viewers can copy it.

## Problems seen (dry runs of 2026-11-17)

- **Flat hooks.** "Jantung menua tak merata" states a fact and opens no question.
- **Dull openers.** A beat opened with "Menurut studi di Aging Cell, peneliti JAX…": the journal and institute names lead the card.
- **Broken highlight.** The yellow phrase is one unbreakable box. It jumps to its own line, leaving "di" alone above it and the "." alone below it.
- **Thin example prompt.** The tip's "why" card held "Hapus anjing, ganti latar kota malam": too short to be worth copying or saving.
- **Mismatched CTA.** It said "Share cerita ini" ("share this story") on a tip, and the follow line is generic.

## Approaches

- **A. Better writing prompts plus a small layout fix — chosen by the owner.** No extra AI calls, so it is as reliable as today.
- B. A plus a second "editor" AI pass. Rejected for now: one more call per Reel on a free AI chain that already rate-limits and needs a repair round about half the time.
- C. A plus three hook options per Reel, picked by a scoring rule. Rejected: a crude rule may pick worse hooks than the AI's own first choice.

## Design

1. **Writing prompts** (`write_story` and `write_tip` in `scripts/ig_reel_daily.py`) share one craft block:
   - Who the viewer is: an Indonesian scrolling on a phone, deciding in one second.
   - Hook rules, each with a good and a bad example: open a question or a gap, address "kamu" or give a concrete surprise, no plain topic labels.
   - Beats start with the interesting thing, never with a journal, institute or researcher name. The source line already credits them.
   - Plain everyday Indonesian, no jargon.
   - CTA names the kind of friend who would want this Reel. A tip is never called "cerita" (story).
2. **New story field `sample_prompt`** (tips only): the full, ready-to-copy prompt in Indonesian, at most 400 characters.
   - The "why" beat keeps a short version of it.
   - Validation:
     - Required for tips, ignored for news.
     - Must be Indonesian.
     - Tip rules apply: no prices, no versions, no big numbers.
     - Over the limit, it is truncated as a soft issue.
3. **Caption** (`build_caption`): when `sample_prompt` exists, a block "📋 Salin prompt ini:" ("Copy this prompt:") followed by the prompt goes right after the opener.
4. **Last card** (`cta` scene): when the story has a `sample_prompt`, a yellow chip "📋 PROMPT LENGKAP DI CAPTION" ("FULL PROMPT IN THE CAPTION") sits above the follow line. The "why" card of tips also gets a small "lengkapnya di caption ↓" ("full version in the caption ↓") hint under the text.
5. **Highlight fix** (`_beat_text` in `scripts/ig_reel/scenes.py`):
   - Each highlighted word gets its own box, so the phrase wraps with the sentence.
   - Punctuation right after the phrase stays attached to the last word.
6. **Follow lines** in the account files are slightly sharper:
   - ai-labs: "Follow @ailabs01.id — tiap hari 1 trik AI baru" ("one new AI trick every day").
   - kaliajatau: unchanged.

## Non-goals

- No extra AI calls.
- No change to scene timing, the music or the image generation.
- No measurement of engagement. The owner judges the result from posts.

## Verification

- The selfcheck gains asserts for:
  - `sample_prompt` validation and its caption block;
  - the chip appearing only when there is a prompt;
  - the highlight markup having one box per word, with trailing punctuation attached.
- The selfcheck passes, including the render.
- One `dry_run=true` per account. The owner reads the frames and the caption.

## Left to the builder

The exact wording of the hook examples, and the chip's styling within the existing design (yellow, Inter 800).
