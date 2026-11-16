"""Render the whole Reel: scene HTML → seeked frames → soundtrack → H.264/AAC MP4."""
import pathlib
import shutil
import subprocess

from .accounts import DEFAULT_MUSIC_STYLE
from .capture import Capturer
from .music import TAIL_S, compose
from .scenes import scene_html
from .timeline import FPS, SCENE_BEATS, TOTAL_BEATS, frames_for


def assemble(frames_dir, wav, out_mp4):
    """Frames + soundtrack → MP4. The last frame is held for the music's tail so the
    fade-out completes on the CTA."""
    subprocess.run([
        "ffmpeg", "-loglevel", "error", "-y",
        "-framerate", str(FPS), "-i", str(pathlib.Path(frames_dir) / "f%05d.jpg"),
        "-i", str(wav),
        "-vf", f"tpad=stop_mode=clone:stop_duration={TAIL_S}",
        "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
        str(out_mp4)], check=True)


FONT_SCALES = (1.0, 0.9, 0.8, 0.7)


def fit_scales(cap, story, images, meta_base, work):
    """Per scene, the largest font scale whose text stays inside the safe area once all
    animations have settled (measured once, before any frame is captured). Raises only if
    even the smallest scale overflows."""
    out = {}
    for idx, (kind, beats) in enumerate(SCENE_BEATS):
        end_ms = frames_for(beats) * 1000 / FPS
        for scale in FONT_SCALES:
            html_path = pathlib.Path(work) / f"fit_{idx}_{kind}.html"
            meta = dict(meta_base, progress_from=0, progress_to=0, font_scale=scale)
            html_path.write_text(scene_html(kind, story, images, meta), encoding="utf-8")
            overflow = cap.measure(html_path, end_ms)
            if not overflow:
                out[kind] = scale
                break
        else:
            raise RuntimeError(f"text outside the safe area even at {FONT_SCALES[-1]}× font: {kind}: " + " | ".join(overflow))
    return out


def render_reel(story, images, meta_base, seed, out_mp4):
    """images: {1..4: Path}. meta_base: {"source","date","handle","follow_line"} (+ optional source_label, kickers, hook_kicker,
    music_style = the account's soundtrack style). The soundtrack mood comes from story["mood"]. Returns
    {"seconds","frames","overflow","hook_visible_at_0","music"}; raises if text leaves the safe area."""
    out_mp4 = pathlib.Path(out_mp4)
    work = out_mp4.parent / (out_mp4.stem + "_frames")
    sample_dir = out_mp4.parent / "frames_sample"
    for d in (work, sample_dir):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)

    overflow, frame, beat, hook_ok = [], 0, 0, False
    with Capturer() as cap:
        scales = fit_scales(cap, story, images, meta_base, work)
        for idx, (kind, beats) in enumerate(SCENE_BEATS):
            meta = dict(meta_base, progress_from=beat / TOTAL_BEATS, progress_to=(beat + beats) / TOTAL_BEATS,
                        font_scale=scales[kind])
            html_path = work / f"scene_{idx}_{kind}.html"
            html_path.write_text(scene_html(kind, story, images, meta), encoding="utf-8")
            n = frames_for(beats)
            res = cap.capture(html_path, n, work, frame)
            overflow += [f"{kind}: {o}" for o in res["overflow"]]
            if kind == "hook":
                hook_ok = res["hook_visible_at_0"]
            shutil.copy(work / f"f{frame + int(n * 0.7):05d}.jpg", sample_dir / f"{idx}_{kind}.jpg")
            frame += n
            beat += beats
    if overflow:
        raise RuntimeError("text outside the safe area: " + " | ".join(overflow))

    wav = work / "music.wav"
    music = compose(seed, TOTAL_BEATS, wav, style=meta_base.get("music_style", DEFAULT_MUSIC_STYLE), mood=story.get("mood"))
    assemble(work, wav, out_mp4)
    return {"seconds": music["seconds"], "frames": frame, "overflow": overflow,
            "hook_visible_at_0": hook_ok, "music": music, "font_scales": scales}
