// Renders a cover spec to PNG with headless Chrome, using the site's template.
import { execFileSync } from "node:child_process";
import { mkdirSync, openSync, readSync, closeSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TEMPLATES } from "./templates.mjs";

const CHROMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

export function findChrome() {
  for (const bin of CHROMES) {
    try { execFileSync(bin, ["--version"], { stdio: "ignore", timeout: 15000 }); return bin; } catch {}
  }
  return null;
}

// PNG width/height from the IHDR chunk (bytes 16–23).
export function pngSize(path) {
  const buf = Buffer.alloc(24);
  const fd = openSync(path, "r");
  try { readSync(fd, buf, 0, 24, 0); } finally { closeSync(fd); }
  if (buf.toString("ascii", 12, 16) !== "IHDR") throw new Error(`cover: ${path} is not a PNG`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

export function renderCover({ site, spec, siteDir, outPath }) {
  const t = TEMPLATES[site];
  if (!t) throw new Error(`cover: unknown site "${site}"`);
  const chrome = findChrome();
  if (!chrome) throw new Error("cover: headless Chrome not found (google-chrome/chromium)");
  const srcDir = join(resolve(siteDir), ".cover-src");
  const src = join(srcDir, `${basename(outPath, extname(outPath))}.${t.ext}`);
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(src, t.render(spec));
  const out = resolve(outPath);
  rmSync(out, { force: true });
  try {
    execFileSync(chrome, [
      "--headless=new", "--hide-scrollbars", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=3000",
      `--window-size=${t.width},${t.height}`, `--force-device-scale-factor=${t.scale}`,
      `--screenshot=${out}`, pathToFileURL(src).href,
    ], { stdio: "pipe", timeout: 60000 });
  } catch (e) {
    throw new Error(`cover: Chrome failed: ${String(e.stderr || e.message).slice(0, 300)}`);
  } finally {
    rmSync(srcDir, { recursive: true, force: true });
  }
  if (!existsSync(out)) throw new Error("cover: Chrome wrote no PNG");
  const [w, h] = pngSize(out);
  if (w !== t.width * t.scale || h !== t.height * t.scale) {
    throw new Error(`cover: expected ${t.width * t.scale}x${t.height * t.scale}, got ${w}x${h}`);
  }
}
