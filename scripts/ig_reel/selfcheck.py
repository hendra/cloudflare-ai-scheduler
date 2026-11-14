"""Self-check for scripts/ig_reel (run: python3 scripts/ig_reel/selfcheck.py).

Pure checks always run. The render section needs Chrome + ffmpeg + playwright and is
skipped with a notice when they are missing.
"""
import copy
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from ig_reel.story import (  # noqa: E402
    build_caption, check_story, extract_article_text, format_date_id, interleave, numbers_in,
)

# ---------- story ----------
assert [c["title"] for c in interleave([[{"title": "a1"}, {"title": "a2"}], [{"title": "b1"}]], 3)] == ["a1", "b1", "a2"]
assert [c["title"] for c in interleave([[{"title": "Same"}], [{"title": "same"}, {"title": "x"}]], 5)] == ["Same", "x"]

html = "<nav><p>menu</p></nav><script>x</script><p>Para one.</p><p>Para &amp; two.</p>"
assert extract_article_text(html) == "Para one.\nPara & two.", extract_article_text(html)
assert len(extract_article_text("<nav>" + "<p>menu item</p>" * 200 + "</nav>")) < 800

assert numbers_in("8.700 km/jam, 1,5 kali, 2026") == {"8700", "1.5", "2026"}, numbers_in("8.700 km/jam, 1,5 kali, 2026")
assert numbers_in("8,700 mph and 1.5 times") == {"8700", "1.5"}

ARTICLE = ("Astronomers using NASA's Webb telescope found that on exoplanet WASP-127b winds reach 8,700 "
           "kilometers per hour, about 7 times the speed of sound, carrying silicate clouds — glass — sideways. "
           "The planet orbits its star 520 light-years away. " * 3)
STORY = {
    "hook": "Planet ini hujan kaca menyamping",
    "hook_highlight": ["hujan kaca"],
    "beats": [
        {"role": "context", "text": "Teleskop Webb milik NASA mengamati planet WASP-127b, 520 tahun cahaya dari Bumi.", "highlight": ""},
        {"role": "twist", "text": "Anginnya mencapai 8.700 km/jam — sekitar 7 kali kecepatan suara.", "highlight": "8.700 km/jam"},
        {"role": "why", "text": "Awan silikatnya, alias kaca, ikut terbawa angin menyamping.", "highlight": ""},
        {"role": "payoff", "text": "Cuaca terburuk di Bumi kalah jauh dari planet ini.", "highlight": ""},
    ],
    "cta": "Kirim ke teman yang suka luar angkasa 🚀",
    "image_prompts": ["glass rain planet", "webb telescope", "storm winds", "silicate clouds"],
    "caption": {"opener": "Bayangkan hujan kaca yang turun menyamping.", "body": "Webb menemukan angin 8.700 km/jam di WASP-127b.",
                "question": "Kamu mau lihat cuaca planet mana lagi?", "save_line": "Simpan biar nggak lupa."},
    "hashtags": ["#Sains", "#Astronomi", "#FaktaUnik", "#NASA", "#LuarAngkasa"],
}
hard, soft = check_story(copy.deepcopy(STORY), ARTICLE)
assert hard == [], hard

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

cap = build_caption(copy.deepcopy(STORY), "NASA", "https://x")
assert cap.startswith("Bayangkan hujan kaca"), cap
assert "Sumber: NASA (https://x)" in cap
assert cap.rstrip().splitlines()[-1] == "#Sains #Astronomi #FaktaUnik #NASA #LuarAngkasa"

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
    from ig_reel.music import compose

    tmp = pathlib.Path(tempfile.mkdtemp())
    info = compose("2026-11-16-0730", 46, tmp / "a.wav")
    assert abs(info["seconds"] - 28.6) < 0.01, info
    sr, data = wavfile.read(tmp / "a.wav")
    assert data.ndim == 2 and data.shape[1] == 2 and abs(len(data) / sr - 28.6) < 0.01
    assert abs(data).max() / 32767 <= 0.9, abs(data).max()
    compose("2026-11-16-0730", 46, tmp / "b.wav")
    assert (tmp / "a.wav").read_bytes() == (tmp / "b.wav").read_bytes(), "same seed must give identical audio"
    pairs = [(f"2026-11-1{d}-0730", f"2026-11-1{d}-1130") for d in range(6, 10)]
    variants = []
    for s1, s2 in pairs:
        a = compose(s1, 46, tmp / "x.wav")
        b = compose(s2, 46, tmp / "y.wav")
        variants.append((a["key"], a["progression"]) != (b["key"], b["progression"]))
    assert any(variants), "slots on the same day should not all share a track"

# ---------- scenes ----------
from ig_reel.scenes import FOLLOW_LINE, scene_html  # noqa: E402
from ig_reel.timeline import SCENE_BEATS  # noqa: E402

IMGS = {k: pathlib.Path(f"/tmp/img{k}.jpg") for k in (1, 2, 3, 4)}
META = {"source": "NASA", "date": "12 Nov 2026", "handle": "@kaliajatau.id", "progress_from": 0.0, "progress_to": 0.1}
assert FOLLOW_LINE == "Ikuti @kaliajatau.id buat fakta gila berikutnya"
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
cta = scene_html("cta", copy.deepcopy(STORY), IMGS, META)
assert FOLLOW_LINE in cta and "Kirim ke teman" in cta
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
    t0 = time.time()
    out = work / "reel.mp4"
    res = render_reel(longest, imgs, {"source": "NASA", "date": "12 Nov 2026", "handle": "@kaliajatau.id"},
                      "2026-11-16-0730", out)
    took = time.time() - t0
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
    print(f"selfcheck: rendered {res['frames']} frames in {took:.1f}s ({res['frames'] / took:.1f} fps) → {out}")

print("ig_reel selfcheck: all assertions passed")
