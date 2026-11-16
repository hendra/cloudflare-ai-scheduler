# Add an Instagram account to the IG Reel pipeline

One workflow (`.github/workflows/ig-reel.yml`) and one script (`scripts/ig_reel_daily.py`) serve
every account. An account is **one settings file + one GitHub environment + four D1 rows**.
Design: `docs/superpowers/specs/2026-11-15-ig-reel-multi-account-design.md`.

## 1. Settings file

Copy `scripts/ig_reel/accounts/ai-labs.json` to `scripts/ig_reel/accounts/<id>.json`
(`<id>`: lowercase letters, digits, dashes) and fill it in:

| Field | Meaning |
|---|---|
| `label` | Name in logs and Slack failure notes. |
| `handle` | Shown on the hook scene. **Empty = the account cannot post for real.** |
| `follow_line` | Line on the last scene. |
| `hook_kicker` | Small label above the hook, e.g. `FAKTA SAINS`, `TIPS AI`. |
| `persona` | Completes "Kamu produser …" / "Kamu penulis naskah …" in the AI prompts: niche and voice. |
| `feeds` | `[name, https url]` pairs (RSS or Atom). Check each answers 200 to `curl`. |
| `news_slots` | `"all"`, or the slots that try a feed story: `morning` (<10:00 WIB), `midday` (<14:00), `afternoon` (<18:00), `evening`. |
| `news_max_age_days` | `null` = any feed item; a number = only items that fresh (use with themes). |
| `themes` | `{"tool": "Claude"\|"ChatGPT"\|"Gemini", "topic": "…", "weight": 2}`. Empty = no tip mode. Otherwise at least 8; the four daily slots take four consecutive rotation slots. |
| `weight` | Optional 1-3 (default 1): how many rotation slots the theme takes. 2 = twice as often. The account fails to load if the mix would put one theme in two of a day's four slots. |
| `dedupe_posts` | How many recent Buffer posts the AI is told not to repeat (28 = one week at 4/day). |
| `buffer_channel_id`, `buffer_org_id` | The account's own Buffer IDs (not secret). A post always goes to this channel; Buffer rejects a token that does not own it. |
| `cloudinary_cloud_name` | The account's Cloudinary cloud name. A real run refuses to upload when the `CLOUDINARY_CLOUD_NAME` secret differs. `null` = not pinned (only `kaliajatau`, which uses the repo-level secrets). |
| `music` | Optional. `{"style": "cinematic"}` (warm pad, soft pluck, low drum — the default when omitted) or `{"style": "electronic"}` (pumping synth pad, bright echoing pluck, blips and glitch stutters). The style gives the account its voices and its opening motif; each post's mood then shapes the notes. A new style is added in code: `MUSIC_STYLES` in `scripts/ig_reel/accounts.py`, `STYLES` and `MOTIFS` in `scripts/ig_reel/music.py`. Listen first: `cd scripts && python3 -m ig_reel.music <style> <mood> <seed> <out.wav>`. |

`python3 scripts/ig_reel/selfcheck.py` validates every account file.

## 2. GitHub environment `ig-<id>`

Repo → Settings → Environments → New environment `ig-<id>`, with these **environment secrets**
(same names as the repo-level ones; the environment's value wins):

- Posting: `BUFFER_ACCESS_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- Text AI: `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`
- Images: `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `POLLINATIONS_SECRET_KEY`

Known limits:

- A secret missing from the environment silently falls back to the repo-level one
  (@kaliajatau.id's). For Cloudinary the script's guard then refuses the real run (cloud
  name does not match the settings file); for Buffer the post is rejected by Buffer itself
  (the token does not own the pinned channel). For AI and image keys it
  only means shared quota.
- Environments on a **private** repo need a paid GitHub plan. This repo is public.
- `kaliajatau` has no secrets in its environment `ig-kaliajatau`; it uses the repo-level ones.

## 3. Dry run

```bash
gh workflow run ig-reel.yml -f dry_run=true -f account=<id>
```

In the log check the `keys:` line (which providers have a key; values are never printed) and
the `guard:` line, which must say the account may post (handle set, Cloudinary cloud matches).
Download the `ig-reel-dry-run-<id>` artifact and watch the Reel. `-f mode=tip` / `-f mode=news`
force one story mode.

## 4. Schedule rows (disabled) and go-live

Add a migration with four `github_actions_trigger` rows like `migrations/0020_ig_reel_ai_labs.sql`
(`inputs.account` = `<id>`, `enabled=0`), then `npm run db:migrate:remote`.

Go live, only after a good dry run. Take the first slot still in the future, **in UTC**
(slots: 01:15, 04:45, 09:35, 12:30 UTC), per row:

```bash
npx wrangler d1 execute scheduler-db --remote --command "UPDATE schedulers SET next_run_at='YYYY-MM-DDTHH:MM:00.000Z', enabled=1 WHERE id='ig-reel-<id>'"
```

Each row gets its own next occurrence (the `-1145` row the next 04:45 UTC, and so on).
