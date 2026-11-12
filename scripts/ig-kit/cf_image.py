"""Generate an image with Cloudflare Workers AI (free tier) and save it as JPEG.

Usage:
  python3 cf_image.py "<prompt>" out.jpg [--size 1024x1280] [--fit 1080x1350] [--bottom]
  python3 cf_image.py "<prompt>" out.jpg --model schnell

Credentials: environment variables CF_TOKEN and CF_ACCOUNT (never print them).
Models
  klein   (default) @cf/black-forest-labs/flux-2-klein-4b — multipart request,
          native width/height (multiples of 16; 1024x1280 = 4:5), ~130 neurons.
  schnell @cf/black-forest-labs/flux-1-schnell — JSON, 1024x1024 only, ~96 neurons.
Free quota: 10,000 neurons/day, resets 07:00 WIB; requests fail (no charge) when spent.
Text in generated images is unreliable: always ask for "no text" and overlay text in HTML.
"""
import argparse, base64, io, json, os, sys, urllib.request, uuid
from PIL import Image

MODELS = {"klein": "@cf/black-forest-labs/flux-2-klein-4b",
          "schnell": "@cf/black-forest-labs/flux-1-schnell"}

def multipart(fields):
    bnd = uuid.uuid4().hex
    body = "".join(f'--{bnd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in fields.items())
    return (body + f"--{bnd}--\r\n").encode(), f"multipart/form-data; boundary={bnd}"

def generate(prompt, model, size, steps):
    token, account = os.environ.get("CF_TOKEN"), os.environ.get("CF_ACCOUNT")
    if not token or not account:
        sys.exit("CF_TOKEN / CF_ACCOUNT not set")
    if model == "klein":
        body, ctype = multipart({"prompt": prompt, "width": size[0], "height": size[1]})
    else:
        body, ctype = json.dumps({"prompt": prompt, "steps": steps}).encode(), "application/json"
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{MODELS[model]}",
        data=body, headers={"Authorization": f"Bearer {token}", "Content-Type": ctype}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.load(r)
    img = (d.get("result") or {}).get("image")
    if not img:
        sys.exit(f"generation failed: {d.get('errors')}")
    return Image.open(io.BytesIO(base64.b64decode(img))).convert("RGB")

def fit(im, w, h, bottom):
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    left = (im.width - w) // 2; top = im.height - h if bottom else (im.height - h) // 2
    return im.crop((left, top, left + w, top + h))

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt"); ap.add_argument("out")
    ap.add_argument("--model", choices=MODELS, default="klein")
    ap.add_argument("--size", default="1024x1280")
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--fit"); ap.add_argument("--bottom", action="store_true")
    a = ap.parse_args()
    im = generate(a.prompt, a.model, tuple(map(int, a.size.split("x"))), a.steps)
    if a.fit:
        im = fit(im, *map(int, a.fit.split("x")), a.bottom)
    im.save(a.out, "JPEG", quality=92)
    print("saved", a.out, im.size, a.model)
