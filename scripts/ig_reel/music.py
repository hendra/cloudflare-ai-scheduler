"""Original, royalty-free soundtrack synthesised on the Reel's beat grid.

Two inputs shape a track besides the seed:
- mood (from the story, see story.MOODS) picks the scale, the chord progressions, the rhythm
  pattern, the pad brightness and the weight of the impacts;
- the seed ("YYYY-MM-DD-HHMM") picks the key, one of the mood's progressions and the noise.

Layers: pad (one chord per bar), bass pulse on every beat, kick + hat from bar 2, plucked
arpeggio from the twist to the CTA, a riser into the twist and impact hits on the twist and
CTA downbeats. The key steps with the slot (morning / midday / afternoon / evening), so the
four daily Reels always sit in four different keys; the same seed, style and mood render
byte-identical audio. A missing or unknown mood is derived from the seed — never an error.
"""
import hashlib
import re

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

from .story import MOODS
from .timeline import BPM, scene_starts

KEY_ROOTS = {"A": 57, "C": 48, "D": 50, "E": 52, "F#": 54, "G": 55}  # midi
MOOD_SPECS = {  # scale name, scale semitones, progressions (0-based scale degrees), pad low-pass Hz
    "curious":    ("dorian",   (0, 2, 3, 5, 7, 9, 10), [(0, 3, 0, 6), (0, 6, 3, 3), (0, 2, 3, 0), (0, 3, 6, 0)], 1600),
    "wonder":     ("lydian",   (0, 2, 4, 6, 7, 9, 11), [(0, 1, 0, 4), (0, 4, 1, 0), (0, 1, 5, 4), (0, 5, 1, 0)], 2400),
    "energetic":  ("minor",    (0, 2, 3, 5, 7, 8, 10), [(0, 5, 2, 6), (0, 3, 5, 4), (5, 6, 0, 0), (0, 6, 5, 6)], 2800),
    "mysterious": ("phrygian", (0, 1, 3, 5, 7, 8, 10), [(0, 1, 0, 6), (0, 1, 2, 1), (0, 6, 1, 0), (0, 0, 1, 6)], 900),
    "uplifting":  ("major",    (0, 2, 4, 5, 7, 9, 11), [(0, 4, 5, 3), (0, 5, 3, 4), (3, 4, 0, 0), (0, 3, 0, 4)], 2600),
}
# kick: beats of the bar that get a kick; hat: None | "eighth" | "sixteenth"; arp_step: eighths
# between arpeggio notes; impact: (gain, boom decay — lower rings longer)
RHYTHMS = {
    "curious":    {"kick": (0, 1, 2, 3), "hat": "eighth",    "arp_step": 1, "arp_gain": 0.16, "impact": (0.55, 3.5)},
    "wonder":     {"kick": (0, 2),       "hat": None,        "arp_step": 2, "arp_gain": 0.18, "impact": (0.7, 2.2)},
    "energetic":  {"kick": (0, 1, 2, 3), "hat": "sixteenth", "arp_step": 1, "arp_gain": 0.2,  "impact": (1.0, 3.0)},
    "mysterious": {"kick": (0,),         "hat": None,        "arp_step": 3, "arp_gain": 0.17, "impact": (0.85, 1.6)},
    "uplifting":  {"kick": (0, 1, 2, 3), "hat": "eighth",    "arp_step": 1, "arp_gain": 0.17, "impact": (0.7, 3.0)},
}
TAIL_S = 1.0


def _hash(text):
    return int(hashlib.sha256(str(text).encode()).hexdigest()[:12], 16)


def pick_track(seed, mood=None):
    """(mood, key, progression) for a seed. The key is distinct for the 4 slots of one day; an
    unknown or missing mood is derived from the seed."""
    seed = str(seed)
    if mood not in MOODS:
        mood = MOODS[_hash(seed) % len(MOODS)]
    keys = sorted(KEY_ROOTS)
    m = re.match(r"^(\d{4}-\d{2}-\d{2})-(\d{2})\d{2}$", seed)
    if m:
        hour = int(m.group(2))
        slot = 0 if hour < 10 else 1 if hour < 14 else 2 if hour < 18 else 3
        key = keys[(_hash(m.group(1)) + slot) % len(keys)]
    else:
        key = keys[_hash("key|" + seed) % len(keys)]
    progs = MOOD_SPECS[mood][2]
    return mood, key, progs[_hash(seed + "|" + mood) % len(progs)]


def _hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def _saw(f, t):
    return 2 * ((f * t) % 1.0) - 1


def _lowpass(x, hz, sr, order=4):
    return sosfilt(butter(order, hz, btype="low", fs=sr, output="sos"), x)


def _highpass(x, hz, sr, order=4):
    return sosfilt(butter(order, hz, btype="high", fs=sr, output="sos"), x)


def _add(buf, start_s, sig, sr):
    i = int(round(start_s * sr))
    if i >= len(buf):
        return
    n = min(len(sig), len(buf) - i)
    buf[i:i + n] += sig[:n]


def _degree(scale, d):
    """Semitones above the root of scale degree d (0-based; 7 = the octave)."""
    return scale[d % len(scale)] + 12 * (d // len(scale))


def _chord(scale, d):
    return tuple(_degree(scale, d + k) for k in (0, 2, 4))


def compose(seed, beats, out_wav, style="cinematic", mood=None, bpm=BPM, sr=44100):
    seed = str(seed)
    mood, key_name, prog = pick_track(seed, mood)
    scale_name, scale, _progs, pad_cutoff = MOOD_SPECS[mood]
    rhythm = RHYTHMS[mood]
    rng = np.random.default_rng(_hash(f"{seed}|{style}|{mood}"))
    root = KEY_ROOTS[key_name]
    chords = [_chord(scale, d) for d in prog]

    beat = 60 / bpm
    bar = 4 * beat
    seconds = beats * beat + TAIL_S
    n = int(round(seconds * sr))
    pad = np.zeros(n)
    drums = np.zeros(n)
    fx = np.zeros(n)
    pluck = np.zeros(n)

    starts = scene_starts()
    twist_beat, payoff_end, cta_beat = starts[2], starts[5], starts[5]

    # pad: one chord per bar, three detuned saws per note, slow swell, low-passed by the mood
    n_bars = int(np.ceil(beats / 4)) + 1
    for b in range(n_bars):
        dur = bar + 0.4
        t = np.arange(int(dur * sr)) / sr
        env = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.5)
        sig = np.zeros_like(t)
        for semis in chords[b % len(chords)]:
            f = _hz(root + semis - 12)
            for cents in (-7, 0, 7):
                sig += _saw(f * 2 ** (cents / 1200), t + rng.random() / f)
        _add(pad, b * bar, sig * env / 9, sr)
    pad = _lowpass(pad, pad_cutoff, sr) * 0.55

    # bass pulse on every beat (chord root, two octaves down)
    t = np.arange(int(0.45 * sr)) / sr
    sub_env = np.exp(-t * 7)
    for k in range(beats):
        chord_root = chords[(k // 4) % len(chords)][0]
        _add(drums, k * beat, np.sin(2 * np.pi * _hz(root + chord_root - 24) * t) * sub_env * 0.5, sr)

    # kick on the mood's beats from bar 2 (every other one during the CTA), hats until the CTA
    kt = np.arange(int(0.3 * sr)) / sr
    kick = np.sin(2 * np.pi * (45 * kt + (120 - 45) * (1 - np.exp(-kt * 30)) / 30)) * np.exp(-kt * 14)
    hat_len = int(0.05 * sr)
    hat_env = np.exp(-np.arange(hat_len) / sr * 90)
    hat_hits = {None: (), "eighth": ((0.5, 0.12),), "sixteenth": ((0.25, 0.07), (0.5, 0.12), (0.75, 0.07))}[rhythm["hat"]]
    for k in range(4, beats):
        if k % 4 in rhythm["kick"] and not (k >= cta_beat and (k - cta_beat) % 2):
            _add(drums, k * beat, kick * 0.6, sr)
        if k < cta_beat:
            for offset, gain in hat_hits:
                hat = _highpass(rng.standard_normal(hat_len), 7000, sr) * hat_env
                _add(drums, (k + offset) * beat, hat * gain, sr)

    # plucked arpeggio from the twist to the CTA, as dense as the mood asks
    pt = np.arange(int(0.35 * sr)) / sr
    penv = np.exp(-pt * 9)
    for i, e in enumerate(range(twist_beat * 2, payoff_end * 2, rhythm["arp_step"])):
        chord = chords[(e // 8) % len(chords)]
        note = root + chord[i % len(chord)] + (12 if (i // 3) % 2 else 0)
        f = _hz(note)
        tone = (np.sin(2 * np.pi * f * pt) + 0.3 * np.sin(4 * np.pi * f * pt)) * penv
        _add(pluck, e * beat / 2, tone * rhythm["arp_gain"], sr)

    # riser over the 4 beats before the twist
    rl = int(4 * beat * sr)
    rt = np.arange(rl) / sr
    sweep = np.sin(2 * np.pi * (200 * rt + (1200 - 200) * rt ** 2 / (2 * rt[-1])))
    noise = _highpass(rng.standard_normal(rl), 2000, sr)
    _add(fx, (twist_beat - 4) * beat, (sweep * 0.25 + noise * 0.15) * (rt / rt[-1]) ** 2, sr)

    # impact hits on the twist and CTA downbeats, weighted by the mood
    impact_gain, boom_decay = rhythm["impact"]
    ht = np.arange(int(1.8 * sr)) / sr
    boom = np.sin(2 * np.pi * 50 * ht) * np.exp(-ht * boom_decay)
    burst = _lowpass(rng.standard_normal(len(ht)), 3000, sr) * np.exp(-ht * 12)
    stab = sum(np.sin(2 * np.pi * _hz(root + s) * ht) for s in chords[0]) / 3 * np.exp(-ht * 4)
    for hb in (twist_beat, cta_beat):
        _add(fx, hb * beat, (boom * 0.7 + burst * 0.25 + stab * 0.25) * impact_gain, sr)

    # stereo: pad and pluck widened with a short delay on one side
    d = int(0.012 * sr)
    wide = pad + pluck
    left = drums + fx + wide
    right = drums + fx + np.concatenate([np.zeros(d), wide[:-d]])
    mix = np.stack([left, right], axis=1)
    fade = int(1.5 * sr)
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
    mix *= 0.891 / max(np.abs(mix).max(), 1e-9)  # peak −1 dBFS
    wavfile.write(out_wav, sr, (mix * 32767).astype(np.int16))
    return {"style": style, "mood": mood, "key": f"{key_name} {scale_name}",
            "progression": [str(d + 1) for d in prog], "seconds": round(n / sr, 3)}
