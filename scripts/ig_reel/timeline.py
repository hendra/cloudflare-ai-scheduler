"""Shared beat grid for the Reel: scene lengths in beats at a fixed tempo.

Every scene cut, text reveal and music accent lands on this grid, so the edit is
beat-synced by construction. 46 beats at 100 BPM = 27.6 s = 828 frames at 30 fps.
"""
BPM = 100
FPS = 30
BEAT_S = 60 / BPM

SCENE_BEATS = [("hook", 5), ("context", 10), ("twist", 10), ("why", 8), ("payoff", 6), ("cta", 7)]
TOTAL_BEATS = sum(b for _, b in SCENE_BEATS)


def scene_starts():
    """Start beat of each scene, in SCENE_BEATS order."""
    out, t = [], 0
    for _, beats in SCENE_BEATS:
        out.append(t)
        t += beats
    return out


def frames_for(beats):
    return round(beats * BEAT_S * FPS)


def total_frames():
    return sum(frames_for(b) for _, b in SCENE_BEATS)
