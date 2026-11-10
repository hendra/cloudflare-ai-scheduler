#!/usr/bin/env python3
"""Build and post a daily Instagram Reel (Interesting Facts) using free services.

Uses Cloudflare Workers AI (text + image), Pillow for scene rendering, ffmpeg for
video assembly, Cloudinary for hosting, and Buffer for posting.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

WORK = Path(".").resolve()
IG = WORK / "ig-kit"
IG.mkdir(exist_ok=True)

CF_ACCOUNT = os.environ.get("CF_ACCOUNT", "").strip()
CF_TOKEN = os.environ.get("CF_TOKEN", "").strip()
CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME", "").strip()
CLOUD_KEY = os.environ.get("CLOUDINARY_API_KEY", "").strip()
CLOUD_SECRET = os.environ.get("CLOUDINARY_API_SECRET", "").strip()
BUFFER_TOKEN = os.environ.get("BUFFER_ACCESS_TOKEN", "").strip()
BUFFER_CHANNEL = os.environ.get("BUFFER_CHANNEL_ID", "").strip()

for name, val in [("CF_ACCOUNT", CF_ACCOUNT), ("CF_TOKEN", CF_TOKEN)]:
    if not val:
        print(f"Missing {name}", file=sys.stderr)
        sys.exit(1)


def cf_ai(model, payload, binary=False):
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/ai/run/{model}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {CF_TOKEN}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=120) as resp:
        if binary:
            return resp.read()
        raw = resp.read()
    try:
        j = json.loads(raw)
        return j.get("result", j)
    except Exception:
        return raw.decode("utf-8", "replace")


# ---------- 1. Research facts from RSS ----------
RSS_FEEDS = [
    "https://www.sciencedaily.com/rss/all.xml",
    "https://www.newscientist.com/feed/home/",
    "https://phys.org/rss-feed/",
]

def fetch_rss():
    items = []
    for feed in RSS_FEEDS:
        try:
            with urllib.request.urlopen(feed, timeout=20) as r:
                xml = r.read()
            root = ET.fromstring(xml)
            for it in root.iter():
                if it.tag.endswith("item") or it.tag == "item":
                    title = ""
                    link = ""
                    desc = ""
                    for child in it:
                        tag = child.tag.split("}")[-1]
                        if tag == "title":
                            title = (child.text or "").strip()
                        elif tag == "link":
                            link = (child.text or "").strip()
                        elif tag in ("description", "summary"):
                            desc = re.sub(r"<[^>]+>", "", child.text or "").strip()[:300]
                    if title:
                        items.append({"title": title, "link": link, "desc": desc})
        except Exception as e:
            print("RSS error", feed, e, file=sys.stderr)
    # dedupe by title
    seen = set()
    out = []
    for it in items:
        if it["title"] in seen:
            continue
        seen.add(it["title"])
        out.append(it)
    return out[:25]


items = fetch_rss()
print(f"Fetched {len(items)} RSS items")

# ---------- 2. Ask Workers AI to pick 4-5 facts ----------
prompt = (
    "You are a science editor. From the following recent headlines, pick 4-5 "
    "interesting, verifiable science/knowledge facts. Return ONLY a JSON array, "
    "no prose, with objects: {\"title\": short hook (<=8 words), \"fact\": 2-3 "
    "sentences, \"source\": publisher name, \"date\": YYYY-MM-DD (approx ok), "
    "\"image_prompt\": a vivid 9:16 illustration prompt with no text}. "
    "Headlines:\n" + "\n".join(f"- {it['title']} ({it['link']})" for it in items)
)

text_result = cf_ai("@cf/meta/llama-3.1-8b-instruct", {"prompt": prompt, "max_tokens": 1200})
if isinstance(text_result, dict):
    raw = text_result.get("response") or text_result.get("result") or ""
else:
    raw = str(text_result)
print("Model raw:", raw[:500])

# extract JSON array
match = re.search(r"\[.*\]", raw, re.S)
facts = []
if match:
    try:
        facts = json.loads(match.group(0))
    except Exception as e:
        print("JSON parse error", e, file=sys.stderr)
if not facts:
    # fallback: one generic fact
    facts = [{"title": "The ocean glows", "fact": "Some ocean organisms produce light through bioluminescence.",
              "source": "General knowledge", "date": time.strftime("%Y-%m-%d"),
              "image_prompt": "bioluminescent ocean at night, glowing waves, 9:16, no text"}]

facts = facts[:5]
print(f"Selected {len(facts)} facts")

# ---------- 3. Generate images + render scenes ----------
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
try:
    font_big = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 72)
    font_med = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 42)
    font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
except Exception:
    font_big = font_med = font_small = ImageFont.load_default()

scenes = []
for i, f in enumerate(facts):
    print(f"Generating image {i+1}/{len(facts)}")
    img_bytes = cf_ai("@cf/stabilityai/stable-diffusion-xl-base-1.0",
                      {"prompt": f["image_prompt"], "width": 768, "height": 1360}, binary=True)
    if not isinstance(img_bytes, (bytes, bytearray)) or len(img_bytes) < 1000:
        # fallback blank
        img = Image.new("RGB", (768, 1360), (20, 20, 40))
    else:
        from io import BytesIO
        img = Image.open(BytesIO(img_bytes)).convert("RGB")
    # fit to 1080x1920 (cover)
    img = img.resize((W, int(img.height * W / img.width)), Image.LANCZOS)
    if img.height < H:
        img = img.resize((int(img.width * H / img.height), H), Image.LANCZOS)
    left = (img.width - W) // 2
    top = (img.height - H) // 2
    img = img.crop((left, top, left + W, top + H))

    draw = ImageDraw.Draw(img)
    # dark gradient bottom
    for y in range(H // 2, H):
        alpha = int(180 * (y - H // 2) / (H // 2))
        draw.line([(0, y), (W, y)], fill=(0, 0, 0, alpha) if False else (0, 0, 0))
    # text
    y = H - 420
    draw.text((60, y), f["title"], font=font_big, fill=(255, 255, 255))
    y += 100
    # wrap fact
    words = f["fact"].split()
    line = ""
    lines = []
    for w in words:
        test = (line + " " + w).strip()
        if draw.textlength(test, font=font_med) > W - 120:
            lines.append(line)
            line = w
        else:
            line = test
    if line:
        lines.append(line)
    for ln in lines[:6]:
        draw.text((60, y), ln, font=font_med, fill=(230, 230, 230))
        y += 52
    y += 20
    draw.text((60, y), f"Source: {f['source']}  |  {f['date']}", font=font_small, fill=(180, 180, 180))

    out = IG / f"scene_{i+1}.png"
    img.save(out)
    scenes.append(out)
    print("Saved", out)

# Hook scene (first fact title as hook) - reuse scene 1 as hook by duplicating? Skip; scenes suffice.

# ---------- 4. Build reel with ffmpeg ----------
list_file = IG / "concat.txt"
with open(list_file, "w") as fh:
    for s in scenes:
        fh.write(f"file '{s.name}'\nduration 3\n")
    if scenes:
        fh.write(f"file '{scenes[-1].name}'\n")

video = WORK / "reel.mp4"
# download a free music track (best-effort)
music = WORK / "music.mp3"
if not music.exists():
    try:
        urllib.request.urlretrieve(
            "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", music)
    except Exception as e:
        print("Music download failed:", e, file=sys.stderr)
        music = None

cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
       "-vsync", "vfr", "-pix_fmt", "yuv420p", "-r", "30"]
if music and music.exists():
    cmd += ["-i", str(music), "-shortest", "-c:a", "aac", "-b:a", "128k"]
cmd += ["-c:v", "libx264", "-preset", "fast", str(video)]
print("Running ffmpeg:", " ".join(cmd))
subprocess.run(cmd, check=True, cwd=IG)
print("Built", video)

# ---------- 5. Upload to Cloudinary ----------
if not all([CLOUD_NAME, CLOUD_KEY, CLOUD_SECRET]):
    print("Cloudinary not configured; skipping upload", file=sys.stderr)
    sys.exit(0)

import hashlib, hmac

def cloudinary_sign(params):
    # params: dict of non-file params
    sorted_items = sorted((k, v) for k, v in params.items() if v is not None)
    to_sign = "&".join(f"{k}={v}" for k, v in sorted_items) + CLOUD_SECRET
    return hashlib.sha1(to_sign.encode()).hexdigest()

timestamp = int(time.time())
sig_params = {"timestamp": timestamp}
signature = cloudinary_sign(sig_params)
upload_url = f"https://api.cloudinary.com/v1_1/{CLOUD_NAME}/video/upload"
# build multipart
import mimetypes
boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
def field(name, value):
    return (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").encode()

body = bytearray()
body += field("timestamp", str(timestamp))
body += field("api_key", CLOUD_KEY)
body += field("signature", signature)
# file
body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"reel.mp4\"\r\nContent-Type: video/mp4\r\n\r\n".encode()
with open(video, "rb") as fh:
    body += fh.read()
body += f"\r\n--{boundary}--\r\n".encode()

req = urllib.request.Request(upload_url, data=bytes(body), headers={
    "Content-Type": f"multipart/form-data; boundary={boundary}",
})
with urllib.request.urlopen(req, timeout=300) as resp:
    up = json.loads(resp.read())
video_url = up.get("secure_url") or up.get("url")
print("Uploaded:", video_url)

# ---------- 6. Post to Buffer ----------
if not BUFFER_TOKEN or not BUFFER_CHANNEL:
    print("Buffer not configured; skipping post", file=sys.stderr)
    sys.exit(0)

post_data = urllib.parse.urlencode({
    "access_token": BUFFER_TOKEN,
    "text": facts[0]["title"] if facts else "Interesting facts",
    "profile_ids[]": BUFFER_CHANNEL,
    "media[video]": video_url,
    "now": "true",
}).encode()
req = urllib.request.Request("https://api.bufferapp.com/1/updates/create.json", data=post_data, method="POST")
with urllib.request.urlopen(req, timeout=60) as resp:
    buf = json.loads(resp.read())
print("Buffer response:", json.dumps(buf)[:500])

# poll for sent status
update_id = None
if isinstance(buf, dict):
    updates = buf.get("updates") or []
    if updates:
        update_id = updates[0].get("id")
if update_id:
    for _ in range(12):
        time.sleep(10)
        try:
            with urllib.request.urlopen(f"https://api.bufferapp.com/1/updates/{update_id}.json?access_token={BUFFER_TOKEN}", timeout=30) as resp:
                st = json.loads(resp.read())
            print("Status:", st.get("status"))
            if st.get("status") == "sent":
                break
        except Exception as e:
            print("Poll error", e, file=sys.stderr)

print("DONE")