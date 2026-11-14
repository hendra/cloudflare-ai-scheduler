"""Original, royalty-free cinematic soundtrack synthesised on the Reel's beat grid.

Layers: detuned-saw pad (one chord per bar), sub pulse on every beat, soft kick + offbeat
hat from bar 2, plucked arpeggio from the twist to the CTA, a riser into the twist and
impact hits on the twist and CTA downbeats. Key and chord progression come from small
pools seeded by `seed` (date + slot), so the four daily Reels don't share a track while a
given seed always renders byte-identical audio.
"""
import hashlib
import random

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

from .timeline import BPM, scene_starts

KEYS = {"A minor": 57, "C minor": 48, "D minor": 50, "E minor": 52, "F# minor": 54, "G minor": 55}
CHORDS = {"i": (0, 3, 7), "iv": (5, 8, 12), "V": (7, 11, 14), "VI": (8, 12, 15), "III": (3, 7, 10), "VII": (10, 14, 17)}
PROGRESSIONS = [
    ["i", "VI", "III", "VII"],
    ["i", "iv", "VI", "V"],
    ["VI", "VII", "i", "i"],
    ["i", "VII", "VI", "VII"],
]
TAIL_S = 1.0


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


def compose(seed, beats, out_wav, bpm=BPM, sr=44100):
    rnd = random.Random(seed)
    rng = np.random.default_rng(int(hashlib.sha256(seed.encode()).hexdigest()[:12], 16))
    key_name = rnd.choice(sorted(KEYS))
    root = KEYS[key_name]
    prog = rnd.choice(PROGRESSIONS)

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

    # pad: one chord per bar, three detuned saws per note, slow swell, low-passed
    n_bars = int(np.ceil(beats / 4)) + 1
    for b in range(n_bars):
        chord = CHORDS[prog[b % len(prog)]]
        dur = bar + 0.4
        t = np.arange(int(dur * sr)) / sr
        env = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.5)
        sig = np.zeros_like(t)
        for semis in chord:
            f = _hz(root + semis - 12)
            for cents in (-7, 0, 7):
                sig += _saw(f * 2 ** (cents / 1200), t + rng.random() / f)
        _add(pad, b * bar, sig * env / 9, sr)
    pad = _lowpass(pad, 1600, sr) * 0.55

    # sub pulse on every beat (root, two octaves down)
    t = np.arange(int(0.45 * sr)) / sr
    sub_env = np.exp(-t * 7)
    for k in range(beats):
        chord_root = CHORDS[prog[(k // 4) % len(prog)]][0]
        _add(drums, k * beat, np.sin(2 * np.pi * _hz(root + chord_root - 24) * t) * sub_env * 0.5, sr)

    # soft kick on beats from bar 2 (half-time during the CTA), offbeat hat
    kt = np.arange(int(0.3 * sr)) / sr
    kick = np.sin(2 * np.pi * (45 * kt + (120 - 45) * (1 - np.exp(-kt * 30)) / 30)) * np.exp(-kt * 14)
    hat_len = int(0.05 * sr)
    for k in range(4, beats):
        if k >= cta_beat and (k - cta_beat) % 2:
            continue
        _add(drums, k * beat, kick * 0.6, sr)
        if k < cta_beat:
            hat = _highpass(rng.standard_normal(hat_len), 7000, sr) * np.exp(-np.arange(hat_len) / sr * 90)
            _add(drums, k * beat + beat / 2, hat * 0.12, sr)

    # plucked arpeggio on eighth notes from the twist to the CTA
    pt = np.arange(int(0.35 * sr)) / sr
    penv = np.exp(-pt * 9)
    for e in range(twist_beat * 2, payoff_end * 2):
        chord = CHORDS[prog[(e // 8) % len(prog)]]
        note = root + chord[e % len(chord)] + (12 if (e // 3) % 2 else 0)
        f = _hz(note)
        tone = (np.sin(2 * np.pi * f * pt) + 0.3 * np.sin(4 * np.pi * f * pt)) * penv
        _add(pluck, e * beat / 2, tone * 0.16, sr)

    # riser over the 4 beats before the twist
    rl = int(4 * beat * sr)
    rt = np.arange(rl) / sr
    sweep = np.sin(2 * np.pi * (200 * rt + (1200 - 200) * rt ** 2 / (2 * rt[-1])))
    noise = _highpass(rng.standard_normal(rl), 2000, sr)
    _add(fx, (twist_beat - 4) * beat, (sweep * 0.25 + noise * 0.15) * (rt / rt[-1]) ** 2, sr)

    # impact hits on the twist and CTA downbeats
    ht = np.arange(int(1.4 * sr)) / sr
    boom = np.sin(2 * np.pi * 50 * ht) * np.exp(-ht * 3)
    burst = _lowpass(rng.standard_normal(len(ht)), 3000, sr) * np.exp(-ht * 12)
    stab = sum(np.sin(2 * np.pi * _hz(root + s) * ht) for s in CHORDS[prog[0]]) / 3 * np.exp(-ht * 4)
    for hb in (twist_beat, cta_beat):
        _add(fx, hb * beat, boom * 0.7 + burst * 0.25 + stab * 0.25, sr)

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
    return {"key": key_name, "progression": prog, "seconds": round(n / sr, 3)}
