"""Self-check for scripts/ig_reel (run: python3 scripts/ig_reel/selfcheck.py).

Pure checks always run. The render section needs Chrome + ffmpeg + playwright and is
skipped with a notice when they are missing.
"""
import copy
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from ig_reel.story import (  # noqa: E402
    build_caption, check_story, extract_article_text, interleave, numbers_in,
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

print("ig_reel selfcheck: all assertions passed")
