"""Self-check for scripts/ig_reel (run: python3 scripts/ig_reel/selfcheck.py).

Pure checks always run. The render section needs Chrome + ffmpeg + playwright and is
skipped with a notice when they are missing.
"""
import copy
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from ig_reel.story import (  # noqa: E402
    apply_story_limits, build_caption, canonical_url, check_story, extract_article_text, extract_buffer_prompts,
    extract_buffer_seen, feed_body, filter_unseen_news, format_date_id, grounding_text, interleave, is_similar_title,
    normalize_title, numbers_in, order_by_source, proper_noun_advisories, proper_noun_errors, tip_duplicate_error,
    MOODS, STORY_SCHEMA_HINT,
    normalize_mood, SAMPLE_PROMPT_MAX,
)

# ---------- story ----------
assert [c["title"] for c in interleave([[{"title": "a1"}, {"title": "a2"}], [{"title": "b1"}]], 3)] == ["a1", "b1", "a2"]
assert [c["title"] for c in interleave([[{"title": "Same"}], [{"title": "same"}, {"title": "x"}]], 5)] == ["Same", "x"]

# --- feed full text / source-alternating shortlist (spec 2026-11-15-ig-reel-article-fetch-403) ---
# only <p> text counts, like the page path: NASA's feed body ends in "Explore More" teasers for other stories
assert feed_body("<p>Tom &amp; Jerry&nbsp;ran <b>fast</b></p><script>x()</script><h2>Explore More</h2>"
                 "<div>3 min read Other story 14 days ago</div>", 100) == "Tom & Jerry ran fast"
assert feed_body("plain text without paragraphs", 100) == ""
assert feed_body("<p>" + "a" * 50 + "</p>", 10) == "a" * 10
assert feed_body("", 10) == ""

_src = ["SD", "MIT", "NASA", "SD", "MIT", "NASA", "MIT"]          # sources of candidates 1..7
assert order_by_source([2, 5, 7, 1, 3, 4], _src) == [2, 1, 3, 5, 4, 7]   # MIT,SD,NASA | MIT,SD | MIT
assert order_by_source([2, 5, 7], _src) == [2, 5, 7]              # one source: rank order kept
assert order_by_source([4], _src) == [4]
assert order_by_source([], _src) == []


def _no_page():
    raise AssertionError("page must not be fetched when the feed body is long enough")


assert grounding_text("x" * 800, _no_page, 800) == "x" * 800
assert grounding_text("x" * 799, lambda: "PAGE", 800) == "PAGE"
assert grounding_text("", lambda: "PAGE", 800) == "PAGE"

html = "<nav><p>menu</p></nav><script>x</script><p>Para one.</p><p>Para &amp; two.</p>"
assert extract_article_text(html) == "Para one.\nPara & two.", extract_article_text(html)
assert len(extract_article_text("<nav>" + "<p>menu item</p>" * 200 + "</nav>")) < 800
assert extract_article_text('<form id="aspnetForm"><p>Body inside a form.</p></form>') == "Body inside a form."

assert numbers_in("8.700 km/jam, 1,5 kali, 2026") == {"8700", "1.5", "2026"}, numbers_in("8.700 km/jam, 1,5 kali, 2026")
assert numbers_in("8,700 mph and 1.5 times") == {"8700", "1.5"}

ARTICLE = ("Astronomers using NASA's Webb telescope found that on exoplanet WASP-127b winds reach 8,700 "
           "kilometers per hour, about 7 times the speed of sound, carrying silicate clouds — glass — sideways. "
           "The planet orbits its star 520 light-years away. " * 3)
STORY = {
    "hook": "Planet ini hujan kaca menyamping",
    "hook_highlight": ["hujan kaca"],
    "beats": [
        {"role": "context", "text": "Teleskop Webb milik NASA mengamati planet WASP-127b, 520 tahun cahaya dari planet ini.", "highlight": ""},
        {"role": "twist", "text": "Anginnya mencapai 8.700 km/jam — sekitar 7 kali kecepatan suara.", "highlight": "8.700 km/jam"},
        {"role": "why", "text": "Awan silikatnya, alias kaca, ikut terbawa angin menyamping.", "highlight": ""},
        {"role": "payoff", "text": "Cuaca terburuk di planet ini kalah jauh dibanding cuaca kita.", "highlight": ""},
    ],
    "cta": "Kirim ke teman yang suka luar angkasa 🚀",
    "image_prompts": ["glass rain planet", "webb telescope", "storm winds", "silicate clouds"],
    "caption": {"opener": "Bayangkan hujan kaca yang turun menyamping.", "body": "Webb menemukan angin 8.700 km/jam di WASP-127b.",
                "question": "Kamu mau lihat cuaca planet mana lagi?", "save_line": "Simpan biar nggak lupa."},
    "hashtags": ["#Sains", "#Astronomi", "#FaktaUnik", "#NASA", "#LuarAngkasa"],
}
hard, soft = check_story(copy.deepcopy(STORY), ARTICLE)
assert hard == [], hard

# --- regression: sentence-initial words are not names ---
# Indonesian capitalises every sentence, so only a token in the MIDDLE of a sentence can be a
# name. Every one of these was reported as an invented proper noun before the fix.
multi = copy.deepcopy(STORY)
multi["beats"][0]["text"] = "Astronom menemukan oksigen di atmosfer planet itu. Jaraknya 520 tahun cahaya."
multi["beats"][1]["text"] = "Namun anginnya mencapai 8.700 km/jam. Jadi ini cuaca ekstrem."
multi["beats"][2]["text"] = "Awan silikat ikut terbawa. Karena itu hujan kacanya menyamping."
multi["beats"][3]["text"] = "Hasilnya planet ini unik. Simpan Reel ini kalau menarik."
assert proper_noun_errors(multi, ARTICLE) == [], proper_noun_errors(multi, ARTICLE)

# A name in the middle of a sentence is still caught.
mid = copy.deepcopy(STORY)
mid["beats"][0]["text"] = "Astronom menemukan oksigen. Menurut Zorblax, ini penting."
assert any("Zorblax" in e for e in proper_noun_errors(mid, ARTICLE))

# --- a name that OPENS a sentence is advisory, not fatal (it cannot be told from "Anginnya") ---
opener = copy.deepcopy(STORY)
opener["beats"][0]["text"] = "Zorblax menemukan oksigen di planet itu."
assert "Zorblax" in proper_noun_advisories(opener, ARTICLE)
assert proper_noun_errors(opener, ARTICLE) == [], "sentence-initial words must not fail the story"

# The same name mid-sentence IS fatal.
opener2 = copy.deepcopy(STORY)
opener2["beats"][0]["text"] = "Astronom menemukan oksigen. Lalu Zorblax setuju."
assert any("Zorblax" in e for e in proper_noun_errors(opener2, ARTICLE)), proper_noun_errors(opener2, ARTICLE)

# Ordinary Indonesian sentence starters stay exempt.
for starter in ["Jaraknya", "Namun", "Jadi", "Karena", "Hasilnya", "Ternyata", "Menurut"]:
    t = copy.deepcopy(STORY)
    t["beats"][0]["text"] = f"Astronom menemukan oksigen di planet itu. {starter} anginnya 8.700 km/jam."
    assert proper_noun_errors(t, ARTICLE) == [], (starter, proper_noun_errors(t, ARTICLE))

# Acronyms and Indonesian common nouns are not invented names.
acr = copy.deepcopy(STORY)
acr["beats"][0]["text"] = "Data API dan GPU NASA dipakai para astronom bulan November ini."
assert proper_noun_errors(acr, ARTICLE + " API GPU NASA November") == [], proper_noun_errors(acr, ARTICLE)
# An acronym the article never uses is still a mid-sentence unknown, so it is reported.
assert any("GPU" in e for e in proper_noun_errors(acr, ARTICLE + " API NASA November"))

# A short name is not grounded by a longer word that merely contains it ("Tim" in "estimate").
short = copy.deepcopy(STORY)
short["beats"][0]["text"] = "Astronom memperkirakan hal itu. Menurut Tim, ini penting."
assert any("Tim" in e for e in proper_noun_errors(short, ARTICLE)), proper_noun_errors(short, ARTICLE)
assert any("Tim" in e for e in proper_noun_errors(short, ARTICLE + " We estimate the odds.")), "substring must not ground a name"
assert proper_noun_errors(short, ARTICLE + " Tim says so.") == []

# --- proper nouns: fabricated names are reported, real ones pass ---
pn = copy.deepcopy(STORY)
pn["beats"][1]["text"] = "Teleskop Zorblax menemukan oksigen di planet itu."
errs = proper_noun_errors(pn, ARTICLE)
assert any("Zorblax" in e for e in errs), errs

pn_ok = copy.deepcopy(STORY)
pn_ok["beats"][1]["text"] = "Teleskop James Webb menemukan oksigen di planet itu."
assert proper_noun_errors(pn_ok, ARTICLE + " The James Webb Telescope found oxygen.") == []

# First token of a field is exempt (Indonesian sentence starters, translated names).
pn_first = copy.deepcopy(STORY)
pn_first["hook"] = "Bumi makin panas"
assert proper_noun_errors(pn_first, ARTICLE) == []

# Captions and hashtags are not scanned.
pn_cap = copy.deepcopy(STORY)
pn_cap["caption"]["body"] = "Menurut NASA dan ESA, ini penting."
assert proper_noun_errors(pn_cap, ARTICLE) == []

# It is hard, so write_story upgrades its existing repair call (the model renames the object
# to the article's own term or rephrases) and only then drops the candidate.
pn_repair = copy.deepcopy(STORY)
pn_repair["beats"][1]["text"] = "Teleskop Zorblax menemukan oksigen, anginnya 8.700 km/jam."
hard_pn, _ = check_story(pn_repair, ARTICLE)
assert any("Zorblax" in h for h in hard_pn), hard_pn

# A translated name is a name in mid-sentence, so the repair path sees it and can rephrase.
pn_translated = copy.deepcopy(STORY)
pn_translated["beats"][1]["text"] = "Anginnya 8.700 km/jam, tujuh kali lebih cepat dari suara di Bumi."
assert any("Bumi" in h for h in check_story(pn_translated, ARTICLE)[0])

bad = copy.deepcopy(STORY)
bad["beats"][1]["text"] = "Anginnya mencapai 9.000 km/jam."
bad["beats"][1]["highlight"] = "9.000 km/jam"
hard, _ = check_story(bad, ARTICLE)
assert any("9000" in h for h in hard), hard

bad = copy.deepcopy(STORY)
bad["caption"]["body"] = "Angin 12 ribu km/jam."
hard, _ = check_story(bad, ARTICLE)
assert any("12" in h for h in hard), hard

bad = copy.deepcopy(STORY)
del bad["beats"][3]
assert check_story(bad, ARTICLE)[0]

bad = copy.deepcopy(STORY)
bad["beats"][1]["highlight"] = "tidak ada di teks"
assert check_story(bad, ARTICLE)[0]

english = copy.deepcopy(STORY)
english["hook"] = "Hidden giant beyond Pluto"
for b, t in zip(english["beats"], ["Astronomers spotted an icy world with the Webb telescope.",
                                   "Its winds reach 8.700 km/jam, which is fast.",
                                   "The clouds of glass are carried sideways by the wind.",
                                   "This is the worst weather of any planet."]):
    b["text"] = t
english["beats"][1]["highlight"] = "8.700 km/jam"
english["cta"] = "Share this with a friend who loves space"
english["caption"] = {"opener": "A giant hidden beyond Pluto.", "body": "It could be the sixth dwarf planet.",
                      "question": "What do you think?", "save_line": "Save and share this!"}
hard, _ = check_story(english, ARTICLE)
assert any("Bahasa Indonesia" in h for h in hard), hard

# English beats must be rejected even when caption/CTA are Indonesian (seen in a real run).
mixed = copy.deepcopy(STORY)
for b, t in zip(mixed["beats"], ["Scientists found that the winds on this planet are fast.",
                                 "Its winds reach 8.700 km/jam, which is faster than sound.",
                                 "The clouds of glass are carried sideways by the wind.",
                                 "This is the worst weather of any known planet."]):
    b["text"] = t
mixed["beats"][1]["highlight"] = "8.700 km/jam"
hard, _ = check_story(mixed, ARTICLE)
assert any("beat" in h and "Indonesia" in h for h in hard), hard
# English hook copied from the article's own words is rejected; an Indonesian hook passes.
eng_hook = copy.deepcopy(STORY)
eng_hook["hook"] = "Glass carried sideways by winds"
hard, _ = check_story(eng_hook, ARTICLE)
assert any("hook" in h and "Indonesia" in h for h in hard), hard

# An English phrase lifted from the article as the on-screen highlight is rejected.
eng_hl = copy.deepcopy(STORY)
eng_hl["beats"][1]["text"] = "Anginnya bertiup 8,700 kilometers per hour di planet ini."
eng_hl["beats"][1]["highlight"] = "8,700 kilometers per hour"
hard, _ = check_story(eng_hl, ARTICLE)
assert any("highlight" in h and "Indonesia" in h for h in hard), hard

assert format_date_id("Sat, 14 Nov 2026 09:23:09 EST") == "14 Nov 2026"
assert format_date_id("Wed, 12 Aug 2026 10:00:00 +0000") == "12 Agu 2026"
assert format_date_id("2026-05-03T10:00:00Z") == "3 Mei 2026"
assert format_date_id("") == "tanggal tidak tercantum"
assert format_date_id("sometime soon") == "sometime soon"

# --- review fixes ---
# Proper nouns / loanwords in otherwise Indonesian copy must not be flagged as English.
for hook_ok in ("Teleskop James Webb", "Robot NASA temukan virus Mars", "Black hole raksasa", "Planet ini hujan kaca"):
    t = copy.deepcopy(STORY); t["hook"] = hook_ok
    h, _ = check_story(t, ARTICLE + " James Webb Space Telescope NASA robot virus Mars black hole")
    assert not any("Indonesia" in x for x in h), (hook_ok, h)
for hl_ok in ("WASP-127b", "James Webb Space Telescope"):
    t = copy.deepcopy(STORY); t["beats"][0]["text"] = f"Teleskop mengamati {hl_ok} dari jauh."; t["beats"][0]["highlight"] = hl_ok
    h, _ = check_story(t, ARTICLE + " James Webb Space Telescope")
    assert not any("Indonesia" in x for x in h), (hl_ok, h)
# Indonesian scale words: "33 ribu" = 33,000; "1,5 miliar" must NOT match "1.5 million".
scaled = copy.deepcopy(STORY); scaled["caption"]["body"] = "Sekitar 33 ribu orang ikut studi ini."
assert check_story(scaled, ARTICLE + " About 33,000 people took part.")[0] == [], check_story(scaled, ARTICLE + " About 33,000 people took part.")[0]
scaled["caption"]["body"] = "Biayanya 1,5 miliar dolar."
assert any("1500000000" in x for x in check_story(scaled, ARTICLE + " It cost 1.5 million dollars.")[0])
scaled["caption"]["body"] = "Biayanya 1,5 juta dolar."
assert check_story(scaled, ARTICLE + " It cost 1.5 million dollars.")[0] == []
# CTA numbers are checked; extra allowed numbers (e.g. the article's year) are accepted.
cta_num = copy.deepcopy(STORY); cta_num["cta"] = "90% orang belum tahu ini 🚀"
assert any("90" in x for x in check_story(cta_num, ARTICLE)[0])
yr = copy.deepcopy(STORY); yr["caption"]["body"] = "Temuan tahun 2026 ini mengejutkan."
assert check_story(yr, ARTICLE, extra_allowed={"2026"})[0] == []
# hook_highlight given as a string (model slip) is coerced, not iterated char by char.
hs = copy.deepcopy(STORY); hs["hook_highlight"] = "hujan kaca"
assert check_story(hs, ARTICLE)[0] == []
apply_story_limits(hs)
assert hs["hook_highlight"] == ["hujan kaca"], hs["hook_highlight"]
# A numeric highlight must not crash apply_story_limits.
nh = copy.deepcopy(STORY); nh["beats"][1]["highlight"] = 8700
apply_story_limits(nh)
# mood (soundtrack): recognised despite case/spaces; anything else is "" and never an error
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

cap = build_caption(copy.deepcopy(STORY), "NASA", "https://x")
assert cap.startswith("Bayangkan hujan kaca"), cap
assert "Sumber: NASA (https://x)" in cap
assert cap.rstrip().splitlines()[-1] == "#Sains #Astronomi #FaktaUnik #NASA #LuarAngkasa"

# Feed item age (announcement freshness): RSS and Atom dates; junk is "unknown", never "fresh".
import datetime as _dt  # noqa: E402

from ig_reel.story import age_days  # noqa: E402

_now = _dt.datetime(2026, 11, 15, 12, 0, tzinfo=_dt.timezone.utc)
assert abs(age_days("Sat, 14 Nov 2026 12:00:00 GMT", _now) - 1) < 1e-6
assert abs(age_days("2026-11-13T12:00:00Z", _now) - 2) < 1e-6
assert age_days("", _now) is None and age_days("kemarin", _now) is None

# ---------- tip mode (no source article) ----------
TIP = {"hook": "Jawaban AI kamu masih ngawur?",
       "hook_highlight": ["ngawur"],
       "beats": [{"role": "context", "text": "Banyak orang langsung minta jawaban, lalu hasilnya tidak sesuai dengan yang dimau.", "highlight": ""},
                 {"role": "twist", "text": "Triknya: suruh Claude bertanya balik dulu sebelum dia menjawab.", "highlight": "bertanya balik dulu"},
                 {"role": "why", "text": "Sebelum menjawab, tanyakan 3 hal yang perlu kamu tahu dari saya.", "highlight": ""},
                 {"role": "payoff", "text": "Jawaban yang kamu dapat jadi lebih pas dengan kebutuhanmu.", "highlight": ""}],
       "cta": "Kirim ke teman yang sering kesal dengan AI 🤖",
       "image_prompts": ["a", "b", "c", "d"],
       "caption": {"opener": "Jawaban AI sering tidak sesuai dengan yang kamu mau?", "body": "Coba minta dia bertanya dulu.",
                   "question": "Kamu sudah pernah coba cara ini?", "save_line": "Simpan dulu biar tidak lupa."},
       "hashtags": ["#TipsAI", "#Claude", "#ChatGPT", "#BelajarAI", "#Produktif"],
       "sample_prompt": "Hapus semua objek yang mengganggu di foto ini, lalu ganti latarnya dengan jalan kota malam yang basah oleh hujan, cahaya neon lembut."}
assert check_story(TIP, "", mode="tip") == ([], []), check_story(TIP, "", mode="tip")
# sample_prompt: required for tips, Indonesian, tip rules, soft length cap; dropped for news
t = {k: v for k, v in copy.deepcopy(TIP).items() if k != "sample_prompt"}
assert any("sample_prompt" in x for x in check_story(t, "", mode="tip")[0])
for bad, rule in (("Remove every distracting object in this photo and replace the background with a rainy city street.", "Indonesia"),
                  ("Hapus objek di foto ini, hasilnya setara jasa edit Rp 50.000 untuk kamu.", "prices")):
    t = copy.deepcopy(TIP)
    t["sample_prompt"] = bad
    assert any(rule in x for x in check_story(t, "", mode="tip")[0]), (bad, check_story(t, "", mode="tip"))
t = copy.deepcopy(TIP)
t["sample_prompt"] = ("Hapus objek yang mengganggu di foto ini dan ganti latarnya dengan kota malam. " * 6)[:450]
assert any("sample_prompt" in x for x in check_story(t, "", mode="tip")[1])
apply_story_limits(t, mode="tip")
assert 0 < len(t["sample_prompt"]) <= SAMPLE_PROMPT_MAX == 400
cap = build_caption(TIP, "Claude", None)
block = "📋 Salin prompt ini:\n" + TIP["sample_prompt"]
assert block in cap and cap.index(TIP["caption"]["opener"]) < cap.index(block) < cap.index(TIP["caption"]["body"]), cap
_long = copy.deepcopy(TIP)
_long["caption"]["body"] = "Coba cara ini ya. " * 120
assert block in build_caption(_long, "Claude", None)
s = copy.deepcopy(STORY)
s["sample_prompt"] = "Buat 99 variasi foto."
assert check_story(s, ARTICLE, mode="news") == ([], []), check_story(s, ARTICLE, mode="news")
apply_story_limits(s, mode="news")
assert s["sample_prompt"] == "" and "Salin prompt" not in build_caption(s, "NASA", "https://x")
for bad_text, rule in (("Paket ini cuma Rp 300.000 per bulan untuk kamu.", "prices"), ("Hasilnya jadi 50% lebih cepat dari yang biasa.", "percentages"),
                       ("Pakai GPT-4 supaya hasilnya lebih pas dengan kamu.", "versions"), ("Pakai Claude 3.5 supaya hasilnya lebih pas.", "versions"),
                       ("Pilih Sonnet supaya hasilnya lebih pas dengan kamu.", "versions"), ("Ikuti 25 langkah ini dengan teliti ya.", "above 10")):
    t = copy.deepcopy(TIP)
    t["beats"][3]["text"] = bad_text
    h, _ = check_story(t, "", mode="tip")
    assert any(rule in x for x in h), (bad_text, h)
t = copy.deepcopy(TIP)
t["beats"][0]["text"] = "Most people ask for the answer and the result is not what they want."
assert any("Indonesia" in x for x in check_story(t, "", mode="tip")[0])
# The news rule still applies outside tip mode: the same text fails there (its "3" is in no article).
assert any("numbers not found" in x for x in check_story(TIP, "")[0])
assert "http" not in build_caption(TIP, "Claude", None) and "Sumber" not in build_caption(TIP, "Claude", None)

# ---------- deduplication ----------
assert canonical_url("https://Example.com/news/?utm_source=ig&b=2&a=1#frag") == "https://example.com/news?a=1&b=2"
assert canonical_url("https://Example.com/") == "https://example.com/"
assert canonical_url("https://example.com/p/?fbclid=1&gclid=2&igshid=3&mc_cid=4&mc_eid=5&ref=x&source=y") == "https://example.com/p"
assert canonical_url("ftp://example.com/a") == "" and canonical_url("not a url") == "" and canonical_url("") == ""

assert normalize_title("Caf\u00e9 &amp; Webb\u2019s 1st Exo_Planet!") == "cafe webb s 1st exo planet"
assert is_similar_title("Webb finds glass rain on exoplanet", "NASA Webb Finds Glass Rain on Exoplanet!") is True
assert is_similar_title("Webb finds glass rain on exoplanet", "Deep sea octopus builds hydrothermal nest") is False
assert is_similar_title("", "Webb finds glass rain") is False

# shared with scripts/published-selfcheck.mjs so the two languages cannot drift
_CASES = json.loads(
    (pathlib.Path(__file__).resolve().parent.parent / "fixtures" / "title-similarity-cases.json").read_text()
)
for _a, _b in _CASES["similar"]:
    assert is_similar_title(_a, _b) is True, f"expected similar: {_a} || {_b}"
    assert is_similar_title(_b, _a) is True, f"expected similar (reversed): {_b} || {_a}"
for _a, _b in _CASES["distinct"]:
    assert is_similar_title(_a, _b) is False, f"expected distinct: {_a} || {_b}"
assert is_similar_title("!!!", "   ") is False

assert extract_buffer_seen([
    "Bayangkan hujan kaca.\n\nIsi.\n\nSumber: NASA (https://nasa.gov/story/?utm_medium=ig)"
]) == ({"https://nasa.gov/story"}, ["Bayangkan hujan kaca."])
assert extract_buffer_seen([
    "Trik AI cepat.\n\n📋 Salin prompt ini:\nBuat poster film retro.\n\n#TipsAI",
    "",
]) == (set(), ["Trik AI cepat."])
assert extract_buffer_prompts([
    "Trik AI cepat.\n\n📋 Salin prompt ini:\nBuat poster film retro.\n\n#TipsAI",
    "Biasa saja.",
]) == ["Buat poster film retro."]

_cands = [
    {"title": "NASA Webb Finds Glass Rain on Exoplanet!", "link": "https://nasa.gov/story/?utm_source=rss"},
    {"title": "Webb finds glass rain on exoplanet", "link": "https://other.example.com/glass"},
    {"title": "New battery chemistry doubles range", "link": "https://mit.edu/battery"},
]
assert [c["link"] for c in filter_unseen_news(
    _cands, {"https://nasa.gov/story"}, ["NASA Webb Finds Glass Rain on Exoplanet!"]
)] == ["https://mit.edu/battery"]

assert tip_duplicate_error(TIP, ["Jawaban AI kamu masih ngawur?"], []) is not None
assert tip_duplicate_error(TIP, [], [TIP["sample_prompt"]]) is not None
assert tip_duplicate_error(TIP, ["Cara edit foto malam"], ["Buat gambar kucing di pantai."]) is None

# ---------- accounts ----------
import datetime as _d  # noqa: E402

from ig_reel.accounts import (  # noqa: E402
    SLOTS, account_target_errors, load_account, pick_theme, slot_name, theme_plan, theme_ring, validate_account,
    wants_news, MUSIC_STYLES, music_style,
)

KALI = load_account("kaliajatau")
assert KALI["handle"] == "@kaliajatau.id" and KALI["news_slots"] == "all" and KALI["themes"] == []
assert KALI["follow_line"] == "Ikuti @kaliajatau.id buat fakta gila berikutnya"
assert KALI["dedupe_posts"] == 28 and KALI["cloudinary_cloud_name"] is None  # repo-level secrets, not pinned
assert KALI["buffer_channel_id"] == "6aed5544e29c69a1717ba62e" and KALI["buffer_org_id"] == "6aed53e7ec5c7c6d73f3e437"
assert [n for n, _ in KALI["feeds"]] == ["ScienceDaily", "MIT News", "NASA"]
LABS = load_account("ai-labs")
assert LABS["news_slots"] == ["morning"] and LABS["dedupe_posts"] == 120
assert len(LABS["themes"]) == 27
assert {t["tool"] for t in LABS["themes"]} == {"Claude", "ChatGPT", "Gemini"}
assert sum(1 for t in LABS["themes"] if t.get("weight") == 2) == 12
assert len(theme_ring(LABS["themes"])) == 39
assert len({pick_theme(theme_ring(LABS["themes"]), _d.date(2026, 11, 16), s)["topic"] for s in SLOTS}) == 4
for bad in ("", "../x", "Kaliajatau", "nope"):
    try:
        load_account(bad)
        raise AssertionError(bad)
    except ValueError:
        pass
assert validate_account({**KALI, "feeds": [], "themes": []})
assert validate_account({**LABS, "themes": LABS["themes"][:3]})
assert validate_account({**KALI, "feeds": [["x", "http://insecure"]]})
assert validate_account({**KALI, "dedupe_posts": 0}) and validate_account({**KALI, "news_slots": ["noon"]})
assert [slot_name(h) for h in (8, 11, 16, 19)] == list(SLOTS)

# Weighted rotation: every theme once, then the weight-2 themes again (round-robin, so a day's
# four slots stay four different themes); retry never hands back a theme already tried.
W = [{"tool": "Claude", "topic": "t1", "weight": 2}, {"tool": "Gemini", "topic": "t2", "weight": 2},
     {"tool": "ChatGPT", "topic": "t3"}, {"tool": "Claude", "topic": "t4"}, {"tool": "Gemini", "topic": "t5"}]
assert len(theme_ring(W)) == 7 and [t["topic"] for t in theme_ring(W)] == ["t1", "t2", "t3", "t4", "t5", "t1", "t2"]
assert theme_ring([]) == [] and theme_plan([], _d.date(2026, 11, 16), "morning", 3) == []
_day = _d.date(2026, 11, 16)
_WR = theme_ring(W)
assert pick_theme(_WR, _day, "morning") == _WR[(_day.toordinal() * 4) % len(_WR)]
_p = theme_plan(_WR, _day, "morning", 3)
assert _p[0] == pick_theme(_WR, _day, "morning") and len(_p) == len({t["topic"] for t in _p})
assert len({t["topic"] for t in theme_plan(_WR, _day, "morning", 99)}) == 5   # terminates, no repeats
# A retry skips today's other slots (four ring positions per retry), and an empty ring fails loudly.
_LR = theme_ring(LABS["themes"])
_today = {pick_theme(_LR, _day, s)["topic"] for s in SLOTS}
_p2 = theme_plan(_LR, _day, "morning", 3)
assert not ({t["topic"] for t in _p2[1:]} & (_today - {_p2[0]["topic"]})), _p2
try:
    pick_theme([], _day, "morning")
    raise AssertionError("empty ring must fail with a message, not ZeroDivisionError")
except ValueError:
    pass
for bad_w in (0, 4, "2", True):
    BAD8 = [{**W[2], "weight": bad_w}] * 8
    assert any("weight" in e for e in validate_account({**LABS, "themes": BAD8})), bad_w
assert validate_account({**LABS, "themes": [{**W[2], "topic": f"v{i}", "weight": 2} for i in range(8)]}) == []
# Focus 1: no weight field at all = today's identity ring.
_ID = [{"tool": "Claude", "topic": f"x{i}"} for i in range(8)]
assert [t["topic"] for t in theme_ring(_ID)] == [f"x{i}" for i in range(8)]
assert validate_account({**KALI, "themes": _ID}) == []
# Focus 2 at validation time: a weight mix that puts one theme in a day's four slots is rejected,
# not posted as the same Reel twice.
_T3 = [{"tool": "Claude", "topic": f"x{i}", "weight": 3 if i < 2 else 1} for i in range(8)]
assert any("repeat" in e for e in validate_account({**LABS, "themes": _T3})), validate_account({**LABS, "themes": _T3})
assert wants_news(KALI, "evening") and wants_news(LABS, "morning") and not wants_news(LABS, "midday")
# Wrong-account guard: an account that is not set up, or Cloudinary secrets of another account, must not post.
assert account_target_errors(KALI, "whatever-the-repo-secret-is") == []
assert len(account_target_errors({**KALI, "handle": ""}, "x")) == 1
PINNED = {**KALI, "cloudinary_cloud_name": "mycloud"}
assert account_target_errors(PINNED, "mycloud") == [] and len(account_target_errors(PINNED, "other")) == 1
assert len(account_target_errors(PINNED, "")) == 1
assert account_target_errors(LABS, LABS["cloudinary_cloud_name"]) == [] and len(account_target_errors(LABS, "opqimovw")) == 1
assert validate_account({**KALI, "cloudinary_cloud_name": ""})
assert any("unknown key" in e for e in validate_account({**KALI, "music": {"stlye": "electronic"}}))
# music style: named in the account file, default cinematic, malformed blocks are readable errors
assert MUSIC_STYLES == ("cinematic", "electronic")
assert music_style(LABS) == "electronic" and music_style(KALI) == "cinematic"
_NO_MUSIC = {k: v for k, v in KALI.items() if k != "music"}
assert validate_account(_NO_MUSIC) == [] and music_style(_NO_MUSIC) == "cinematic"
assert validate_account({**KALI, "music": {}}) == [] and music_style({**KALI, "music": {}}) == "cinematic"
for bad in ("electronic", {"style": 3}, {"style": "jazz"}, [], {"style": ""}):
    errs = validate_account({**KALI, "music": bad})
    assert any(e.startswith("music") for e in errs), (bad, errs)

# ---------- timeline ----------
from ig_reel.timeline import scene_starts, total_frames  # noqa: E402

assert total_frames() == 828, total_frames()
assert scene_starts() == [0, 5, 15, 25, 33, 39], scene_starts()

# ---------- music (needs numpy/scipy) ----------
import tempfile  # noqa: E402

try:
    import numpy  # noqa: F401
    from scipy.io import wavfile
    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = False
    print("selfcheck: numpy/scipy missing — music section skipped")

if HAVE_NUMPY:
    from ig_reel.music import MOOD_SPECS, compose, pick_track

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
    x = compose("manual-run", 46, tmp / "x1.wav")
    compose("manual-run", 46, tmp / "x2.wav")
    assert x["mood"] in MOODS and (tmp / "x1.wav").read_bytes() == (tmp / "x2.wav").read_bytes()
    # four slots of one day: four different keys, even when all four share a mood
    for day in range(1, 31):
        keys = [pick_track(f"2026-11-{day:02d}-{hm}", "wonder")[1] for hm in ("0815", "1145", "1635", "1930")]
        assert len(set(keys)) == 4, (day, keys)
    assert pick_track("2026-11-16-0815", "wonder") == pick_track("2026-11-16-0815", "wonder")

    # styles: every style × mood renders, differs, carries on phone speakers and sits at a similar level
    import numpy as np
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
    # the phone-speaker share also holds in the lowest keys (four slots of a day = four keys)
    for hm in ("0815", "1145", "1635", "1930"):
        compose(f"2026-11-17-{hm}", 46, tmp / "k.wav", style="cinematic", mood="mysterious")
        x = _load(tmp / "k.wav")
        spec = np.abs(np.fft.rfft(x.mean(axis=1))) ** 2
        freqs = np.fft.rfftfreq(len(x), 1 / 44100)
        assert spec[(freqs >= 150) & (freqs <= 4000)].sum() / spec.sum() >= 0.6, hm
    assert max(rms_db.values()) - min(rms_db.values()) <= 4.0, rms_db
    # never louder than the old track (−20.5 dBFS RMS)
    assert max(rms_db.values()) <= -20.0, rms_db
    try:
        compose(SEED, 46, tmp / "bad.wav", style="jazz")
        raise AssertionError("unknown style must raise")
    except ValueError:
        pass
    # the render hands the account's style and the story's mood to the synth
    import inspect
    from ig_reel import reel as _reel
    _src = inspect.getsource(_reel.soundtrack)
    assert 'meta_base.get("music_style"' in _src and 'meta_base.get("account")' in _src
    assert 'story.get("mood")' in inspect.getsource(_reel.render_reel)
    # no library track → synth, tagged as such
    syn = _reel.soundtrack({"account": "no-such-account", "music_style": "electronic"}, "wonder", SEED, tmp / "s.wav")
    assert syn["source"] == "synth" and syn["style"] == "electronic", syn
    assert _reel.music_line(syn).startswith("synth electronic/wonder")

# ---------- music library (pure; render needs ffmpeg) ----------
from ig_reel.library import LIBRARY, account_tracks, day_slot, pick_library_track  # noqa: E402
import shutil  # noqa: E402
import tempfile as _tf  # noqa: E402

_lib = pathlib.Path(_tf.mkdtemp())
(_lib / "acc").mkdir()
for name in ("wonder-1.mp3", "wonder-2.mp3", "curious-1.mp3", "sedih-1.mp3", "notes.txt", "wonder.mp3"):
    (_lib / "acc" / name).write_bytes(b"")
assert {m: [p.name for p in ps] for m, ps in account_tracks("acc", _lib).items()} == \
    {"curious": ["curious-1.mp3"], "wonder": ["wonder-1.mp3", "wonder-2.mp3"]}
assert pick_library_track("missing", "wonder", "2026-11-17-0815", _lib) is None
assert pick_library_track("", "wonder", "2026-11-17-0815", _lib) is None
assert pick_library_track("acc", "curious", "2026-11-17-0815", _lib).name == "curious-1.mp3"
# same inputs → same track; mood without tracks (or unknown) → any of the account's tracks
assert pick_library_track("acc", "wonder", "x", _lib) == pick_library_track("acc", "wonder", "x", _lib)
for m in ("energetic", "", None, "sedih"):
    assert pick_library_track("acc", m, "2026-11-17-0815", _lib).name in ("curious-1.mp3", "wonder-1.mp3", "wonder-2.mp3")
# one day's slots step through the pool: consecutive slots differ when there are ≥2 tracks
for day in range(1, 31):
    picks = [pick_library_track("acc", "wonder", f"2026-11-{day:02d}-{hm}", _lib).name for hm in ("0815", "1145", "1635", "1930")]
    assert all(a != b for a, b in zip(picks, picks[1:])), (day, picks)
assert day_slot("2026-11-17-1930") == ("2026-11-17", 3) and day_slot("manual") is None
shutil.rmtree(_lib)
# the committed library: every file is named <mood>-<n>.mp3 and both live accounts have tracks
for acc in ("kaliajatau", "ai-labs"):
    folder = LIBRARY / acc
    assert folder.is_dir() and account_tracks(acc), acc
    bad = [p.name for p in folder.iterdir() if not any(p in ps for ps in account_tracks(acc).values())]
    assert not bad, (acc, bad)

if shutil.which("ffmpeg") and shutil.which("ffprobe") and HAVE_NUMPY:
    from ig_reel.library import render_library_track
    _t = pathlib.Path(_tf.mkdtemp())
    for acc in ("kaliajatau", "ai-labs"):
        for ps in account_tracks(acc).values():
            for track in ps:
                out = _t / "lib.wav"
                info = render_library_track(track, out, 28.6)
                _sr, d = wavfile.read(out)
                assert _sr == 44100 and d.ndim == 2 and abs(len(d) / _sr - 28.6) < 0.02, (track, len(d) / _sr)
                x = d.astype(np.float64) / 32767
                rms = 20 * np.log10(np.sqrt((x ** 2).mean()))
                assert -24 <= rms <= -18 and np.abs(x).max() <= 0.9, (track, rms)  # about the old level, never louder
                assert np.abs(x[-int(0.05 * _sr):]).max() < 0.02, track  # faded out
                assert info["source"] == "library" and info["track"] == f"{acc}/{track.name}", info
    # a broken library file never blocks the Reel: the synth takes over
    _bad = pathlib.Path(_tf.mkdtemp())
    (_bad / "broken").mkdir()
    (_bad / "broken" / "wonder-1.mp3").write_bytes(b"not audio")
    _reel.pick_library_track = lambda a, m, s: pick_library_track(a, m, s, _bad)
    fb = _reel.soundtrack({"account": "broken", "music_style": "cinematic"}, "wonder", SEED, _t / "fb.wav")
    _reel.pick_library_track = pick_library_track
    assert fb["source"] == "synth", fb
    lib = _reel.soundtrack({"account": "ai-labs"}, "energetic", SEED, _t / "lib2.wav")
    assert lib["source"] == "library" and _reel.music_line(lib).startswith("library ai-labs/"), lib
else:
    print("selfcheck: ffmpeg or numpy missing — library render skipped")

# ---------- scenes ----------
from ig_reel.scenes import scene_html  # noqa: E402
from ig_reel.timeline import SCENE_BEATS  # noqa: E402

IMGS = {k: pathlib.Path(f"/tmp/img{k}.jpg") for k in (1, 2, 3, 4)}
META = {"source": "NASA", "date": "12 Nov 2026", "handle": "@tes", "follow_line": "Ikuti @tes buat tips", "progress_from": 0.0, "progress_to": 0.1}
for kind, _ in SCENE_BEATS:
    h = scene_html(kind, copy.deepcopy(STORY), IMGS, META)
    assert "@font-face" in h and "Anton" in h and re.search(r'class="[^"]*\bsafe\b', h), kind
    if kind in ("context", "twist", "why", "payoff"):
        assert "Sumber: NASA · 12 Nov 2026" in h, kind
hook = scene_html("hook", copy.deepcopy(STORY), IMGS, META)
assert "hujan kaca" in hook.lower() and "hook-text" in hook
assert "<em>hujan kaca</em>" in hook.lower(), "hook highlight words must be wrapped"
hook_rule = hook.split(".hook-text {")[1].split("}")[0]
assert "animation" not in hook_rule, "hook text must be fully visible at t=0 (cover)"
twist = scene_html("twist", copy.deepcopy(STORY), IMGS, META)
assert 'class="hl"' in twist and "8.700" in twist.split('class="hl"')[1].split("</span></span>")[0]
visible = re.sub(r"<[^>]+>", "", twist)
assert "8.700 km/jam — sekitar" in visible, "space after the highlight must survive"
for kind in ("context", "twist", "why", "payoff", "cta"):
    assert "scenein" not in scene_html(kind, copy.deepcopy(STORY), IMGS, META), f"{kind}: cuts are hard cuts on the beat"
small = scene_html("payoff", copy.deepcopy(STORY), IMGS, dict(META, font_scale=0.8))
assert "--fs: 0.8" in small or "--fs:0.8" in small, "font_scale must reach the CSS"
# Hook highlight: a string must not produce tag fragments; a short phrase must not colour part of a word.
hs_html = scene_html("hook", dict(copy.deepcopy(STORY), hook="Meteor jatuh di kota", hook_highlight="meteor"), IMGS, META)
hook_h1 = hs_html.split('class="hook-text safe">')[1].split("</h1>")[0]
assert hook_h1 == "<em>Meteor</em> jatuh di kota", hook_h1
hs_html = scene_html("hook", dict(copy.deepcopy(STORY), hook="Planet ini hujan kaca", hook_highlight=["kaca", "a"]), IMGS, META)
hook_h1 = hs_html.split('class="hook-text safe">')[1].split("</h1>")[0]
assert hook_h1 == "Planet ini hujan <em>kaca</em>", hook_h1
# Highlight sweep never starts before the highlighted words have appeared.
late = copy.deepcopy(STORY)
late["beats"][1]["text"] = "Satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas tiga belas lalu 8.700 km/jam."
late["beats"][1]["highlight"] = "8.700 km/jam"
lt = scene_html("twist", late, IMGS, META)
hl_delay = float(lt.split('class="hl" style="animation-delay:')[1].split("s")[0])
box_delay = float(lt.split('class="hlbox" style="animation-delay:')[1].split("s")[0])
assert box_delay >= hl_delay, (hl_delay, box_delay)
cta = scene_html("cta", copy.deepcopy(STORY), IMGS, META)
from ig_reel.scenes import TIP_KICKERS  # noqa: E402
_tipctx = scene_html("context", TIP, IMGS, {**META, "kickers": TIP_KICKERS, "source_label": "Tips", "source": "Claude", "hook_kicker": "TIPS AI"})
assert "MASALAHNYA" in _tipctx and "Tips: Claude" in _tipctx and "YANG DITEMUKAN" not in _tipctx
assert "TIPS AI" in scene_html("hook", TIP, IMGS, {**META, "hook_kicker": "TIPS AI"})
assert "FAKTA SAINS" in scene_html("hook", TIP, IMGS, META)
assert "Ikuti @tes buat tips" in cta and "kaliajatau" not in cta and "Kirim ke teman" in cta
# highlight: one box per word so the phrase wraps with the sentence; trailing punctuation stays on the last word
from ig_reel.scenes import _beat_text  # noqa: E402
_bt = _beat_text("Jaringan parut ada di katup dan pembuluh darah utama.", "katup dan pembuluh darah utama", 1.0)
assert _bt.count('class="hlbox"') == 5, _bt
_last = _bt.split('class="hl"')[-1]
assert "utama." in re.sub(r"<[^>]+>", "", _last) and not re.sub(r"<[^>]+>", "", _bt.split("utama")[1]).replace(".", "", 1).strip(), _bt
assert "ada di katup dan pembuluh darah utama." in re.sub(r"<[^>]+>", "", _bt)
# prompt pointers: only when the story carries a sample_prompt
_tm = {**META, "kickers": TIP_KICKERS, "source_label": "Tips", "source": "Claude"}
assert "PROMPT LENGKAP DI CAPTION" in scene_html("cta", TIP, IMGS, _tm)
assert "lengkapnya di caption" in scene_html("why", TIP, IMGS, _tm)
_np = {**TIP, "sample_prompt": ""}
assert "PROMPT LENGKAP" not in scene_html("cta", _np, IMGS, _tm) and "lengkapnya di caption" not in scene_html("why", _np, IMGS, _tm)
assert "PROMPT LENGKAP" not in cta
evil = copy.deepcopy(STORY)
evil["beats"][0]["text"] = "<script>alert(1)</script> teks"
ctx = scene_html("context", evil, IMGS, META)
assert "<script>alert" not in ctx and "&lt;script&gt;" in ctx

# ---------- render (needs playwright + Chrome + ffmpeg) ----------
import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import time  # noqa: E402

try:
    import playwright  # noqa: F401
    HAVE_RENDER = HAVE_NUMPY and bool(shutil.which("ffmpeg")) and bool(shutil.which("ffprobe"))
except ImportError:
    HAVE_RENDER = False
if not HAVE_RENDER:
    print("selfcheck: playwright/ffmpeg/numpy missing — render section skipped")
else:
    from ig_reel.reel import render_reel

    work = pathlib.Path(tempfile.mkdtemp())
    imgs = {}
    for k, color in zip((1, 2, 3, 4), ("0x1d3557", "0x6a040f", "0x264653", "0x3c096c")):
        imgs[k] = work / f"img{k}.jpg"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:s=1080x1920",
                        "-frames:v", "1", str(imgs[k])], check=True)
    longest = copy.deepcopy(STORY)
    longest["hook"] = "Menyamping Menakjubkan Mengerikan Berbahaya Misterius Raksasa Planet"
    longest["hook_highlight"] = ["Mengerikan Berbahaya"]
    for b in longest["beats"]:
        b["text"] = (b["text"] + " " + "kata " * 40)[:120].strip()
        if b["highlight"] and b["highlight"] not in b["text"]:
            b["highlight"] = ""
    longest["cta"] = ("Kirim ke teman yang suka luar angkasa dan sains 🚀 " + "x" * 20)[:60]
    longest["mood"] = "mysterious"
    longest["sample_prompt"] = TIP["sample_prompt"]  # the longest CTA card also carries the prompt chip
    t0 = time.time()
    out = work / "reel.mp4"
    res = render_reel(longest, imgs, {"source": "NASA", "date": "12 Nov 2026", "handle": "@tes", "follow_line": "Ikuti @tes buat tips",
                                     "music_style": "electronic"},
                      "2026-11-16-0730", out)
    took = time.time() - t0
    assert res["music"]["style"] == "electronic" and res["music"]["mood"] == "mysterious", res["music"]
    assert res["overflow"] == [], res["overflow"]
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(out)],
                                      capture_output=True, text=True, check=True).stdout)
    v = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (v["width"], v["height"], v["r_frame_rate"]) == (1080, 1920, "30/1"), v
    assert any(s["codec_type"] == "audio" for s in probe["streams"])
    assert abs(float(probe["format"]["duration"]) - 28.6) < 0.15, probe["format"]["duration"]
    assert res["hook_visible_at_0"] is True
    samples = sorted((out.parent / "frames_sample").glob("*.jpg"))
    assert len(samples) == 6, samples
    wide = copy.deepcopy(STORY)
    # past the 120-char limit on purpose: proves the step-down engages instead of failing the post
    wide["beats"][3]["text"] = " ".join(["MMMMMMMM", "WWWWWWWW"] * 13)
    from ig_reel.reel import fit_scales
    with __import__("ig_reel.capture", fromlist=["Capturer"]).Capturer() as cap:
        scales = fit_scales(cap, wide, imgs, {"source": "NASA", "date": "12 Nov 2026", "handle": "@tes", "follow_line": "Ikuti @tes buat tips"}, work)
    assert scales["payoff"] < 1.0 and scales["hook"] == 1.0, scales
    print(f"selfcheck: rendered {res['frames']} frames in {took:.1f}s ({res['frames'] / took:.1f} fps) → {out}")

print("ig_reel selfcheck: all assertions passed")
