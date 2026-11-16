"""Original, royalty-free soundtrack synthesised on the Reel's beat grid.

Two inputs shape a track besides the seed:
- mood (from the story, see story.MOODS) picks the scale, the chord progressions, the rhythm
  pattern, the pad brightness and the weight of the impacts;
- the seed ("YYYY-MM-DD-HHMM") picks the key, one of the mood's progressions and the noise.

- style (from the account file, see accounts.MUSIC_STYLES) picks the voices: "cinematic" is a
  warm pad, a soft piano-like pluck, a low drum and an airy shimmer; "electronic" is a pumping
  synth pad, a bright echoing pluck, tight drums, digital blips and glitch stutters. Each
  style also owns a short signature motif (MOTIFS, scale degrees) played at the very start
  and echoed on the CTA, transposed to the track's key and scale.

Layers: pad (one chord per bar), bass pulse on every beat, kick + hat from bar 2, plucked
arpeggio from the twist to the CTA, a texture (shimmer / stutters), a riser into the twist
and impact hits on the twist and CTA downbeats. The bass and the impacts carry harmonics
above 150 Hz so they survive phone speakers. The key steps with the slot (morning / midday / afternoon / evening), so the
four daily Reels always sit in four different keys; the same seed, style and mood render
byte-identical audio. A missing or unknown mood is derived from the seed — never an error.
"""
import hashlib
import re

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

from .accounts import DEFAULT_MUSIC_STYLE, MUSIC_STYLES
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
# per-style voices; keys must equal accounts.MUSIC_STYLES
STYLES = {
    "cinematic": {"pad_square": 0.0, "pad_duck": 0.0, "bass": "sine", "kick": (120, 45, 14, 0.0), "hat": (7000, 90, 1.0),
                  "pluck": "soft", "pluck_octave": 0, "echo": 0.0, "texture": "shimmer", "motif_octave": 12},
    "electronic": {"pad_square": 0.4, "pad_duck": 0.65, "bass": "saw", "kick": (170, 50, 22, 0.35), "hat": (9000, 170, 1.3),
                   "pluck": "bright", "pluck_octave": 12, "echo": 0.35, "texture": "glitch", "motif_octave": 12},
}
MOTIFS = {"cinematic": (0, 4, 2), "electronic": (0, 2, 4, 7)}  # scale degrees on consecutive half-beats
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


def _pluck_tone(kind, f, sr):
    """One plucked note: "soft" = piano-like sine with a slow decay, "bright" = short synth pluck."""
    if kind == "soft":
        t = np.arange(int(0.6 * sr)) / sr
        return (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)) * np.exp(-t * 6)
    t = np.arange(int(0.28 * sr)) / sr
    square = np.sign(np.sin(2 * np.pi * f * t))
    return _lowpass(0.6 * _saw(f, t) + 0.4 * square, 3500, sr, order=2) * np.exp(-t * 14) * 0.8


def compose(seed, beats, out_wav, style=DEFAULT_MUSIC_STYLE, mood=None, bpm=BPM, sr=44100):
    if style not in STYLES:
        raise ValueError(f"unknown music style {style!r}; known: {', '.join(MUSIC_STYLES)}")
    seed = str(seed)
    voice = STYLES[style]
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
    bass = np.zeros(n)
    drums = np.zeros(n)
    fx = np.zeros(n)
    pluck = np.zeros(n)
    air = np.zeros(n)

    starts = scene_starts()
    twist_beat, why_beat, payoff_end, cta_beat = starts[2], starts[3], starts[5], starts[5]

    # pad: one chord per bar, three detuned saws (plus square for the synth style) per note
    n_bars = int(np.ceil(beats / 4)) + 1
    for b in range(n_bars):
        dur = bar + 0.4
        t = np.arange(int(dur * sr)) / sr
        env = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.5)
        sig = np.zeros_like(t)
        for semis in chords[b % len(chords)]:
            f = _hz(root + semis)
            for cents in (-7, 0, 7):
                tt = t + rng.random() / f
                wave = _saw(f * 2 ** (cents / 1200), tt)
                if voice["pad_square"]:
                    wave = (1 - voice["pad_square"]) * wave + voice["pad_square"] * np.sign(np.sin(2 * np.pi * f * tt))
                sig += wave
        _add(pad, b * bar, sig * env / 9, sr)
    pad = _lowpass(pad, pad_cutoff, sr) * (0.6 + 0.5 * voice["pad_duck"])
    if voice["pad_duck"]:  # pumping: the pad dips on every beat and swells back
        phase = (np.arange(n) / sr) % beat
        pad *= 1 - voice["pad_duck"] * np.exp(-phase * 9)

    # bass pulse on every beat (chord root); harmonics keep it audible on small speakers
    bt = np.arange(int(0.45 * sr)) / sr
    for k in range(beats):
        f = _hz(root + chords[(k // 4) % len(chords)][0] - 24)
        if voice["bass"] == "sine":
            tone = (0.15 * np.sin(2 * np.pi * f * bt) + 0.5 * np.sin(4 * np.pi * f * bt)
                    + 0.4 * np.sin(8 * np.pi * f * bt) + 0.3 * np.sin(12 * np.pi * f * bt)) * np.exp(-bt * 7)
        else:
            tone = _saw(f, bt) * 0.5 * np.exp(-bt * 10)
        _add(bass, k * beat, tone * 0.32, sr)
    if voice["bass"] == "saw":
        bass = _highpass(_lowpass(bass, 800, sr), 90, sr, order=2)

    # kick on the mood's beats from bar 2 (every other one during the CTA), hats until the CTA
    k_hi, k_lo, k_decay, k_click = voice["kick"]
    kt = np.arange(int(0.3 * sr)) / sr
    kick = np.sin(2 * np.pi * (k_lo * kt + (k_hi - k_lo) * (1 - np.exp(-kt * 30)) / 30)) * np.exp(-kt * k_decay)
    kick[:int(0.004 * sr)] += k_click * np.linspace(1, 0, int(0.004 * sr))
    hat_hp, hat_decay, hat_gain = voice["hat"]
    hat_len = int(0.05 * sr)
    hat_env = np.exp(-np.arange(hat_len) / sr * hat_decay)
    hat_hits = {None: (), "eighth": ((0.5, 0.12),), "sixteenth": ((0.25, 0.07), (0.5, 0.12), (0.75, 0.07))}[rhythm["hat"]]
    blip_t = np.arange(int(0.045 * sr)) / sr
    for k in range(4, beats):
        if k % 4 in rhythm["kick"] and not (k >= cta_beat and (k - cta_beat) % 2):
            _add(drums, k * beat, kick * 0.26, sr)
        if k < cta_beat:
            for offset, gain in hat_hits:
                hat = _highpass(rng.standard_normal(hat_len), hat_hp, sr) * hat_env
                _add(drums, (k + offset) * beat, hat * gain * hat_gain, sr)
            if voice["texture"] == "glitch" and rng.random() < 0.3:  # digital blip on some offbeats
                f = _hz(root + 24 + _degree(scale, int(rng.integers(0, 7))))
                _add(air, (k + 0.75) * beat, np.sin(2 * np.pi * f * blip_t) * np.exp(-blip_t * 60) * 0.07, sr)

    # plucked arpeggio from the twist to the CTA, as dense as the mood asks
    for i, e in enumerate(range(twist_beat * 2, payoff_end * 2, rhythm["arp_step"])):
        chord = chords[(e // 8) % len(chords)]
        note = root + chord[i % len(chord)] + (12 if (i // 3) % 2 else 0) + voice["pluck_octave"]
        _add(pluck, e * beat / 2, _pluck_tone(voice["pluck"], _hz(note), sr) * rhythm["arp_gain"], sr)

    # signature motif: the style's own notes at the very start, echoed quietly on the CTA
    for at_beat, gain in ((0, 0.34), (cta_beat, 0.17)):
        for j, deg in enumerate(MOTIFS[style]):
            f = _hz(root + _degree(scale, deg) + voice["motif_octave"])
            _add(pluck, (at_beat + j / 2) * beat, _pluck_tone(voice["pluck"], f, sr) * gain, sr)

    if voice["echo"]:  # dotted-eighth echo on the synth pluck
        dly = int(0.75 * beat * sr)
        pluck[dly:] += pluck[:-dly] * voice["echo"]

    if voice["texture"] == "shimmer":  # airy high chord tones swelling over the twist and the payoff
        st = np.arange(int(2 * bar * sr)) / sr
        senv = np.minimum(1, st / 1.2) * np.minimum(1, (st[-1] - st) / 1.2) * (1 + 0.25 * np.sin(2 * np.pi * 0.7 * st))
        for sb in (twist_beat, starts[4]):
            for semis in chords[(sb // 4) % len(chords)]:
                _add(air, sb * beat, np.sin(2 * np.pi * _hz(root + semis + 24) * st) * senv * 0.035, sr)
    else:  # glitch stutters: a 1/16 slice of the lead repeats over one beat, 3 times in why/payoff
        lead = pad + pluck
        sl = int(beat / 4 * sr)
        ramp = int(0.002 * sr)
        for gb in sorted(rng.choice(np.arange(why_beat + 1, cta_beat - 1), size=3, replace=False)):
            i0 = int(round(gb * beat * sr))
            piece = lead[i0:i0 + sl].copy()
            piece[:ramp] *= np.linspace(0, 1, ramp)
            piece[-ramp:] *= np.linspace(1, 0, ramp)
            for r in range(1, 4):
                seg = slice(i0 + r * sl, i0 + (r + 1) * sl)
                pad[seg] = piece * (1 - 0.2 * r)
                pluck[seg] = 0

    # riser over the 4 beats before the twist
    rl = int(4 * beat * sr)
    rt = np.arange(rl) / sr
    sweep = np.sin(2 * np.pi * (200 * rt + (1200 - 200) * rt ** 2 / (2 * rt[-1])))
    noise = _highpass(rng.standard_normal(rl), 2000, sr)
    _add(fx, (twist_beat - 4) * beat, (sweep * 0.25 + noise * 0.15) * (rt / rt[-1]) ** 2, sr)

    # impact hits on the twist and CTA downbeats, weighted by the mood
    impact_gain, boom_decay = rhythm["impact"]
    ht = np.arange(int(1.8 * sr)) / sr
    boom = (0.3 * np.sin(2 * np.pi * 50 * ht) + 0.45 * np.sin(2 * np.pi * 100 * ht)
            + 0.3 * np.sin(2 * np.pi * 200 * ht)) * np.exp(-ht * boom_decay)
    burst = _lowpass(rng.standard_normal(len(ht)), 3000, sr) * np.exp(-ht * 12)
    stab = sum(np.sin(2 * np.pi * _hz(root + s + 12) * ht) for s in chords[0]) / 3 * np.exp(-ht * 4)
    for hb in (twist_beat, cta_beat):
        _add(fx, hb * beat, (boom * 0.4 + burst * 0.25 + stab * 0.3) * impact_gain, sr)

    # stereo: pad, pluck and air widened with a short delay on one side
    d = int(0.012 * sr)
    wide = pad + pluck + air
    centre = bass + drums + fx
    mix = np.stack([centre + wide, centre + np.concatenate([np.zeros(d), wide[:-d]])], axis=1)
    mix = np.tanh(mix * 1.6)  # gentle saturation: evens out the level between styles and moods
    fade = int(1.5 * sr)
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
    mix *= 0.891 / max(np.abs(mix).max(), 1e-9)  # peak −1 dBFS
    wavfile.write(out_wav, sr, (mix * 32767).astype(np.int16))
    return {"style": style, "mood": mood, "key": f"{key_name} {scale_name}",
            "progression": [str(d + 1) for d in prog], "seconds": round(n / sr, 3)}


if __name__ == "__main__":  # listen to one track: python3 -m ig_reel.music <style> <mood> <seed> <out.wav>
    import sys

    from .timeline import TOTAL_BEATS

    if len(sys.argv) != 5:
        sys.exit("usage: python3 -m ig_reel.music <style> <mood> <seed> <out.wav>")
    print(compose(sys.argv[3], TOTAL_BEATS, sys.argv[4], style=sys.argv[1], mood=sys.argv[2]))
