"""Assemble a vertical Reel (1080x1920, 30fps H.264 + AAC) from scene PNGs,
with an original, royalty-free background track synthesised on the fly.

Usage: python3 build_reel.py scenes.json out.mp4
scenes.json: [{"png": "frames/s0.png", "dur": 3.0}, {"png": "frames/s1.png", "dur": 5.5}, ...]

Each scene is a held still with 0.25s fades (to #0B1020) encoded separately,
then concatenated with -c copy. Music: lo-fi pad + pluck + soft drums at
92 BPM in A minor, risers at every scene boundary, normalised to -16 LUFS.
"""
import json, subprocess, sys, pathlib
import numpy as np
from scipy.io import wavfile

scenes = json.loads(pathlib.Path(sys.argv[1]).read_text())
out = pathlib.Path(sys.argv[2])
work = out.parent / (out.stem + "_work"); work.mkdir(exist_ok=True)

# ---- video: one encoded file per scene, then concat
lst = []
for i, s in enumerate(scenes):
    d = float(s["dur"]); clip = work / f"c{i}.mp4"; tmp = work / f"c{i}.tmp.mp4"
    vf = (f"format=yuv420p,loop=-1:1,trim=duration={d},"
          f"fade=t=in:st=0:d=0.25:color=0x0B1020,fade=t=out:st={d-0.25}:d=0.25:color=0x0B1020,setsar=1")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "30", "-i", s["png"], "-vf", vf,
                    "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    "-r", "30", str(tmp)], check=True)
    tmp.replace(clip); lst.append(f"file '{clip.resolve()}'")
(work / "list.txt").write_text("\n".join(lst))

# ---- music
SR, BPM = 44100, 92
DUR = sum(float(s["dur"]) for s in scenes)
bounds = np.cumsum([float(s["dur"]) for s in scenes])[:-1]
N = int(SR * DUR); BEAT = 60 / BPM; bar = 4 * BEAT
rng = np.random.default_rng(7)
def midi(m): return 440.0 * 2 ** ((m - 69) / 12)
def env(n, a, r):
    e = np.ones(n); ai, ri = int(a * SR), int(r * SR)
    if ai: e[:ai] = np.linspace(0, 1, ai)
    if ri: e[-ri:] *= np.linspace(1, 0, ri)
    return e
def add(buf, st, sig):
    i = int(st * SR); j = min(N, i + len(sig))
    if i < N: buf[i:j] += sig[: j - i]
chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [52, 56, 59]]
pad = np.zeros(N); pluck = np.zeros(N); drums = np.zeros(N)
for b in range(int(DUR / bar) + 1):
    ch = chords[b % 4]; n = int(bar * SR) + int(0.3 * SR); tt = np.arange(n) / SR; s = np.zeros(n)
    for m in ch:
        for det in (-0.12, 0.12):
            f = midi(m) * 2 ** (det / 12); s += 2 * ((tt * f) % 1) - 1
    add(pad, b * bar, s * env(n, 0.4, 0.5) / 6)
a = np.exp(-2 * np.pi * 900 / SR); acc = 0.0
for k in range(N):
    acc = (1 - a) * pad[k] + a * acc; pad[k] = acc
start = float(bounds[0]) if len(bounds) else 0.0
step = BEAT / 2
for k in range(int((DUR - start) / step)):
    st = start + k * step; ch = chords[int(st // bar) % 4]; m = ch[[0, 1, 2, 1][k % 4]] + 12
    n = int(0.35 * SR); tt = np.arange(n) / SR
    add(pluck, st, (np.sin(2*np.pi*midi(m)*tt) + 0.3*np.sin(4*np.pi*midi(m)*tt)) * np.exp(-tt*9) * 0.22)
for k in range(int((DUR - start - 1.5) / step)):
    st = start + k * step
    if k % 4 == 0:
        n = int(0.25 * SR); tt = np.arange(n) / SR; f = 110 * np.exp(-tt * 18) + 45
        add(drums, st, np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-tt*14) * 0.9)
    n = int(0.05 * SR)
    add(drums, st, rng.standard_normal(n) * np.exp(-np.arange(n)/SR*90) * (0.10 if k % 2 else 0.06))
for bnd in bounds:
    n = int(0.6 * SR); tt = np.arange(n) / SR
    add(drums, float(bnd) - 0.6, rng.standard_normal(n) * (tt / 0.6) ** 2 * 0.05)
mix = 0.9 * pad + pluck + drums
mix *= env(N, 0.8, 2.5); mix /= np.max(np.abs(mix)) + 1e-9; mix *= 0.6
wavfile.write(work / "music.wav", SR, (np.stack([mix, np.roll(mix, int(0.012*SR))], 1) * 32767).astype(np.int16))

# ---- mux
tmp = out.with_suffix(".tmp.mp4")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(work / "list.txt"),
                "-i", str(work / "music.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy",
                "-c:a", "aac", "-b:a", "192k", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                "-shortest", "-movflags", "+faststart", str(tmp)], check=True)
tmp.replace(out)
print("saved", out, f"{DUR:.1f}s")
