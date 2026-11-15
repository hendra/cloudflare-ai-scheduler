# AI-labs theme mix: creative tips first, weighted rotation

Date: 2026-11-15. Status: approved.

## Intent

`ai-labs` today posts Claude/ChatGPT prompt tips from a flat 24-theme list, rotated evenly
(4 themes/day). The owner wants it to become a tips account for **creating and editing
photo, video and animation**, with Gemini added as a third tool, and with the creative
categories seen more often than the rest. Demanded-but-missing topics are added; weakly
demanded ones are dropped.

## Goals

- Photo / video / animation tips lead the rotation (about three in five tip posts).
- Tools are Claude, ChatGPT and Gemini.
- Adding or reweighting a theme stays a settings-file edit; no code change per theme.
- @kaliajatau.id and the pipeline's behaviour are untouched.

## Non-goals

- Game-making tips (owner skipped them).
- Dropping the coding and learning tips: explaining code, finding bugs, and using popular
  coding tools (Superpowers) stay in the list.
- Naming tools outside the three assistants (Canva, CapCut, Sora, Kling…) as the tip's
  `tool`. Tips stay inside the three apps, except the coding-tool theme below, which names
  Superpowers inside a Claude/ChatGPT/Gemini tips Reel.
- Changing news mode, scene layout, music, or `scripts/ig-kit/`.

## Anti-goals

- A "creative" theme that needs a tool the account does not have (e.g. tips about a paid
  editor's menu).
- A theme appearing more often by accident of list order instead of its weight.
- Weights that make one theme repeat back-to-back in the retry path.

## Approaches

- **A. Weight per theme (chosen by the owner).** Optional `weight` field (1-3, default 1);
  the rotation ring is built from the weights. ~20 lines in `accounts.py` + selfcheck.
- **B. Order only.** Creative themes first, equal frequency. Rejected: "priority" would be
  cosmetic under `pick_theme`'s even rotation.
- **C. Creative categories pinned to slots.** Rejected: rigid when the four daily slots or
  the news/tip split change.

## Design

### Schema

`{"tool": "Claude"|"ChatGPT"|"Gemini", "topic": "…", "weight": 1|2|3}`. `weight` optional,
default 1. Validated as an integer 1-3, at least 8 themes as today, and the mix must keep
one day's four rotation slots on four different themes (checked on the ring).

### Rotation

`theme_ring(themes)` expands each theme to its weight; `pick_theme` positions on that ring
by day + slot as today. Retry after a rejected tip advances one ring step and skips any
theme equal to one already tried this run, so a weight-2 theme cannot be retried against
itself.

### The list (27 themes, all in Bahasa Indonesia)

Weight 2 — **foto**: Gemini hapus objek/ganti latar lewat prompt; Gemini foto produk dari
satu foto HP; ChatGPT perbaiki foto gelap/buram; ChatGPT gambar baru dari deskripsi untuk
konten jualan.
Weight 2 — **video**: Gemini video pendek dari satu foto dengan gerakan kamera; Gemini
kalimat jadi klip Reels; Claude storyboard + durasi tiap shot; ChatGPT naskah dan hook video
pendek.
Weight 2 — **animasi**: Claude animasi teks dengan kode yang jalan di browser; Gemini foto
jadi animasi bergerak pendek; ChatGPT animasi logo/loading dari deskripsi; Claude animasi
teks untuk intro video.
Weight 1 — **prompt**: Gemini prompt foto dengan detail kamera/cahaya/sudut; Claude peran
dan batasan jelas di awal prompt.
Weight 1 — **konten sosmed**: ChatGPT ide konten dari satu topik; Claude caption dan hashtag
dari satu foto.
Weight 1 — **voice & narasi**: Gemini narasi suara untuk video pendek; ChatGPT voice over
santai dari naskah sendiri.
Weight 1 — **kerja**: Claude proposal/penawaran singkat untuk klien; ChatGPT email kerja
sopan dan singkat.
Weight 1 — **belajar & riset**: Gemini riset topik dengan sumber yang bisa dicek; ChatGPT
rencana belajar skill baru.
Weight 1 — **QA karya**: Claude kritik jujur sebelum posting; Gemini periksa foto hasil AI
(tangan, teks) sebelum dipakai.
Weight 1 — **coding**: Claude menjelaskan kode yang tidak kamu pahami baris demi baris;
ChatGPT mencari bug dengan menempelkan pesan error lengkap; Claude memakai skills/tool
populer seperti Superpowers di alur kerja coding.

The ring for this list = 4 creative × 3 categories × weight 2 = 24 plus 15 × 1 = 39 slots,
so creative tips are 24/39 ≈ 62% of tip posts. The list grows to 27 rather than trimming
another group: the owner just asked to keep coding and learning.

Dropped from the old list (weak demand for this niche): latihan wawancara kerja, rumus
spreadsheet, terjemahan dengan nada, soal latihan pelajaran, catatan rapat jadi daftar
tugas, kerangka presentasi, tabel plus-minus, "jelaskan seperti ke anak SD".

### Account file and copy

- `tool` validation gains `Gemini`; the Reel's tip source label follows the theme's tool.
- `persona`: tips & trik AI (Claude, ChatGPT, Gemini) untuk bikin dan edit foto, video,
  animasi, plus cara kerja yang lebih cepat.
- `follow_line`: "Ikuti buat tips AI kreatif berikutnya". `hook_kicker` stays `TIPS AI`.

### Verification

- `python3 scripts/ig_reel/selfcheck.py` — weights validate (0 and 4 rejected, default 1);
  ring for a 2/1 list has the right share; retry never returns the same theme twice; every
  account file still loads.
- `gh workflow run ig-reel.yml -f dry_run=true -f account=ai-labs -f mode=tip` — log shows a
  creative theme and a Gemini/Claude/ChatGPT source label; artifact Reel renders.
- `-f mode=news` still works (morning announcement path unchanged).

## Calls made by the designer (owner may overrule)

1. Weight range 1-3, default 1; creative themes use exactly 2, coding uses 1.
2. 12 creative + 15 other themes (27 total); nothing else trimmed to protect the creative
   share.
3. `docs/ig-reel-add-account.md` gains a `weight` row; `AGENTS.md` and `docs/status.md`
   describe the new niche in one line each.
4. No change to `dedupe_posts` (120) or to the news feeds.

## Left to the builder

Exact Indonesian wording of each theme, the ring/retry helper names, and the order of edits.
