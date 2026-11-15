# IG Reel: multiple accounts, starting with an AI tips account

Date: 2026-11-15. Status: awaiting owner approval.

## Intent

The owner wants a second Instagram Reel pipeline for another account, with its own
Buffer, Cloudinary and AI keys, and expects more accounts later. Adding an account
must be a small, repeatable setup, not a copy of the pipeline.

The second account (working name `ai-labs`, real handle not chosen yet) posts
**Claude and ChatGPT tips and tricks** in Bahasa Indonesia, with the same look and the
same four daily times as @kaliajatau.id.

## Goals

- One workflow and one script serve any number of accounts.
- An account is one settings file + one GitHub environment + four D1 rows.
- @kaliajatau.id keeps posting exactly as today, with no change to its D1 rows.
- The `ai-labs` account posts a fresh announcement when there is one, otherwise a tip.
- A run can never post to the wrong account.

## Non-goals

- A different visual identity, music system or scene count per account.
- Languages other than Bahasa Indonesia (the language check stays as is).
- Changing `scripts/ig-kit/` (stays byte-identical).

## Anti-goals

- A tips Reel that states wrong prices, limits, version names or menu locations.
- The same tip returning every week.
- A missing secret silently posting through @kaliajatau.id's accounts.

## Approaches

- **A. One Reel, many accounts (chosen by the owner).** Settings file per account,
  `account` workflow input, secrets in a GitHub environment per account under today's
  secret names. Costs one restructuring of the live script.
- **B. Copy workflow and script per account.** No risk to the live Reel, but every
  later fix is made once per account. Rejected: works against easy setup.
- **C. One workflow, prefixed secret names.** Works, but secret names multiply and the
  workflow changes for each account. Rejected: messier than environments.

## Design

### Account settings file

`scripts/ig_reel/accounts/<id>.json`, loaded by the orchestrator from the `ACCOUNT`
env var (default `kaliajatau`). Fields:

| Field | Meaning |
|---|---|
| `handle` | Shown in scenes and prompts. Empty = real runs refuse to post. |
| `follow_line` | Last-scene line (today's constant in `scenes.py`). |
| `persona` | One or two sentences that open both AI prompts (niche and voice). |
| `feeds` | List of `[name, url]`. |
| `news_slots` | Which daily slots try a feed story: `all` or a list such as `["morning"]`. |
| `themes` | List of tip themes. Empty = account has no tip mode. |
| `dedupe_posts` | How many recent Buffer posts are checked for repeats. |
| `buffer_channel_id`, `buffer_org_id`, `cloudinary_cloud_name` | Pinned, non-secret IDs. |
| `label` | Name used in logs, Slack notes and the report. |

`kaliajatau.json` holds today's values (three science feeds, `news_slots: all`, no
themes, 28 posts, the IDs now defaulted in code). The code defaults for those IDs and
the Actions variables `BUFFER_CHANNEL_ID` / `BUFFER_ORG_ID` are removed.

`ai-labs.json`: feeds = OpenAI news (`https://openai.com/news/rss.xml`) and Claude Code
releases (`https://github.com/anthropics/claude-code/releases.atom`), both verified to
answer 200 on 2026-11-15 (Anthropic's site has no feed). `news_slots: ["morning"]`,
about 20 themes mixing tool (Claude / ChatGPT) and use (prompt technique, writing,
coding, study, work, research), `dedupe_posts: 120` (30 days).

### Two story modes

- **News** (today's path, unchanged): shortlist from feeds, ground on feed text or the
  article page, every number must appear in the source.
- **Tip** (new): the theme is picked by date + slot, the same way `pick_track()` picks
  music, so the four daily slots get four different themes. The AI writes one concrete
  tip with an example prompt, seeing recent post texts as a blocklist. The six scenes
  keep their layout; the beats read hook → problem → trick → example prompt → result →
  CTA. The source line on scenes shows the tool name instead of a publisher.
  Checks that replace source grounding, all hard failures:
  - no currency amounts, percentages, or numbers above 10 (step counts stay legal);
  - no model version names (pattern such as `GPT-4`, `Claude 3.5`, `o3`);
  - Bahasa Indonesia check as today; the example prompt is written in Indonesian too
    and is checked like every other field.

Per run: if the slot is in `news_slots` and a feed story passes grounding, post it;
otherwise, if the account has themes, post a tip; otherwise fail as today.

### Workflow

`.github/workflows/ig-reel.yml` gains input `account` (default `kaliajatau`), sets
`environment: ig-<account>`, concurrency group `ig-reel-<account>`, and puts the
account in the artifact name. Secret names do not change. GitHub creates a missing
environment empty on first use, so `ig-kaliajatau` needs no setup and reads the
repo-level secrets as today.

Environment `ig-ai-labs` (owner creates; nothing is added by the builder):
`BUFFER_ACCESS_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`, the AI keys in use (`OPENCODE_API_KEY`, `OPENROUTER_API_KEY`,
`GROQ_API_KEY`), and the image keys (`CF_ACCOUNT_ID`, `CF_API_TOKEN`,
`POLLINATIONS_SECRET_KEY`). Slack secrets stay repo-level; failure notes go to #news
prefixed with the account label.

### Wrong-account guard

Before any upload, a real run fails unless `CLOUDINARY_CLOUD_NAME` equals the pinned
`cloudinary_cloud_name`, and unless the Buffer token can see the pinned channel. A dry
run logs both results and which AI and image providers have keys, without printing
values. Known limit: a missing AI or image key falls back to the repo-level key; that
shares quota but cannot post anywhere wrong.

### Schedule

Migration `0020` inserts four rows `ig-reel-ai-labs`, `-1145`, `-1635`, `-1930` with
the same crons as the existing Reel, `inputs: {"dry_run": false, "account": "ai-labs"}`,
and **`enabled=0`**. Going live is a separate step the owner approves: set
`next_run_at` to the first future slot in UTC at that moment, then `enabled=1`. This
avoids the day-late `next_run_at` of migration 0019. Existing `ig-reel-daily*` rows
are not touched.

### Verification

- `python3 scripts/ig_reel/selfcheck.py`: every account file loads and validates; tip
  checks reject a price, a version name and a number above 10 and accept a clean tip;
  render runs with a non-default handle and follow line.
- `dry_run=true` dispatch for `kaliajatau` (must match today's behaviour) and for
  `ai-labs` in both modes (the `topic` input forces neither; a dev-only `mode` input
  `auto|news|tip` is added for this).
- Docs: `docs/status.md`, `AGENTS.md`, and a short "add an account" checklist.

## Calls made by the designer (owner may overrule)

1. Announcements are tried in the morning slot only; the other three are tips.
2. Image keys are per account, like the AI keys.
3. Repeat look-back for tips is 120 posts.
4. Tip scenes reuse the six-scene layout with relabelled beats.
5. New D1 rows ship disabled; going live is a separate approved step.
6. `ai-labs` cannot post for real until `handle` is filled in.

## Left to the builder

Exact theme wording, prompt text for tip mode, the version-name pattern, how Buffer
paging reaches 120 posts, and the order of refactoring steps.
