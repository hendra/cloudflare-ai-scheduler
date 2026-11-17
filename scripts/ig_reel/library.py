"""Pre-made soundtrack library: scripts/ig_reel/music_library/<account-id>/<mood>-<n>.mp3.

The owner generates the tracks once (Suno, prompts in docs/ig-reel-suno-prompts.md) and trims
them to about 30 s before committing. A Reel picks one by account + story mood + seed; ffmpeg cuts
it to the Reel's length, fades the end and sets the loudness. An account or mood without tracks
falls back to the synth in music.py, so music never blocks a post.
"""
import hashlib
import pathlib
import re
import subprocess

from .story import MOODS

LIBRARY = pathlib.Path(__file__).resolve().parent / "music_library"
TRACK_RE = re.compile(r"^([a-z]+)-(\d+)\.mp3$")
FADE_S = 1.5
LOUDNESS_LUFS = -20  # about the level of the old synth track (-20.5 dBFS RMS)


def seed_hash(text):
    return int(hashlib.sha256(str(text).encode()).hexdigest()[:12], 16)


def day_slot(seed):
    """("YYYY-MM-DD", slot 0..3) for a "YYYY-MM-DD-HHMM" seed (morning / midday / afternoon / evening), else None."""
    m = re.match(r"^(\d{4}-\d{2}-\d{2})-(\d{2})\d{2}$", str(seed))
    if not m:
        return None
    hour = int(m.group(2))
    return m.group(1), 0 if hour < 10 else 1 if hour < 14 else 2 if hour < 18 else 3


def account_tracks(account_id, root=LIBRARY):
    """{mood: [Path, ...]} of the account's tracks, sorted; files with other names are ignored."""
    out = {}
    folder = pathlib.Path(root) / str(account_id or "")
    if not account_id or not folder.is_dir():
        return out
    for p in sorted(folder.iterdir()):
        m = TRACK_RE.match(p.name)
        if m and m.group(1) in MOODS:
            out.setdefault(m.group(1), []).append(p)
    return out


def pick_library_track(account_id, mood, seed, root=LIBRARY):
    """The account's track for this post, or None when the account has none. Same inputs → same
    track. Prefers tracks of the story's mood, else any of the account's tracks. The 4 slots of
    one day step through the list, so they get different tracks when there are enough."""
    tracks = account_tracks(account_id, root)
    pool = tracks.get(mood) or [p for mood_list in tracks.values() for p in mood_list]
    if not pool:
        return None
    ds = day_slot(seed)
    i = seed_hash(ds[0]) + ds[1] if ds else seed_hash(seed)
    return pool[i % len(pool)]


def render_library_track(track, out_wav, seconds, sr=44100):
    """Cut the track to `seconds`, fade the last FADE_S, normalise loudness → stereo 16-bit WAV."""
    track = pathlib.Path(track)
    af = (f"atrim=0:{seconds},afade=t=out:st={seconds - FADE_S}:d={FADE_S},"
          f"loudnorm=I={LOUDNESS_LUFS}:TP=-1.5:LRA=11,aresample={sr},apad=whole_dur={seconds}")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(track), "-af", af,
                    "-ac", "2", "-ar", str(sr), "-c:a", "pcm_s16le", "-t", str(seconds), str(out_wav)], check=True)
    m = TRACK_RE.match(track.name)
    return {"source": "library", "track": f"{track.parent.name}/{track.name}", "mood": m.group(1) if m else "",
            "seconds": round(seconds, 3)}
