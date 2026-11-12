// Per-site cover skins: normalised cover spec (scripts/cover/spec.mjs) → SVG/HTML source.
// Geometry and colours are copied from each site's oldest hand-made cover:
//   railsdev     railsdev-site/scripts/blog-covers/rails-pgvector.svg
//   inasoft      inasoft-site/scripts/assets/blog/ai-agent-adalah.svg
//   fullstackweb fullstackwebdev-site/design/blog-covers/production-rag-applications.html (+ covers.css)
// The source file is written to <site>/.cover-src/, so fonts resolve from ../node_modules.
import { escapeXml as x } from "./spec.mjs";

const INTER = "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";
const FIRA = "../node_modules/@fontsource/fira-code/files/fira-code-latin-400-normal.woff2";

// Shrinks every text[data-fit] until it fits data-max px, measured with the real font in Chrome.
const FIT_SCRIPT = `<script><![CDATA[
(async () => {
  await document.fonts.ready;
  for (const t of document.querySelectorAll("text[data-fit]")) {
    const max = Number(t.getAttribute("data-max"));
    let size = parseFloat(t.getAttribute("font-size"));
    while (t.getComputedTextLength() > max && size > 20) { size -= 2; t.setAttribute("font-size", size); }
  }
})();
]]></script>`;

const fit = (max) => `data-fit="1" data-max="${max}"`;

// Vertical chain layout for railsdev/inasoft: node boxes stacked top→bottom inside [top, bottom].
// Rows = label + sub + code lines; when everything does not fit, code lines then subs are dropped.
function stack(nodes, { top, bottom, minGap = 40, maxGap = 64 }) {
  const rows = nodes.map((n) => ({ sub: !!n.sub, lines: [...n.lines] }));
  const height = (r) => 36 + 30 * (1 + (r.sub ? 1 : 0) + r.lines.length);
  const total = () => rows.reduce((s, r) => s + height(r), 0) + minGap * (nodes.length - 1);
  for (let i = rows.length - 1; i >= 0 && total() > bottom - top; i--) rows[i].lines = [];
  for (let i = rows.length - 1; i >= 0 && total() > bottom - top; i--) rows[i].sub = false;
  const sum = rows.reduce((s, r) => s + height(r), 0);
  const gap = Math.min(maxGap, (bottom - top - sum) / Math.max(1, nodes.length - 1));
  let y = top + (bottom - top - sum - gap * (nodes.length - 1)) / 2;
  return nodes.map((n, i) => {
    const box = { ...n, sub: rows[i].sub ? n.sub : "", lines: rows[i].lines, y, h: height(rows[i]) };
    y += box.h + gap;
    return box;
  });
}

// Arrows: [i, i+1] straight down the middle; longer edges as elbows on the right side.
function chainArrows(boxes, edges, { cx, right, cls }) {
  let k = 0;
  // ponytail: at most 2 edges may skip a node (parseCoverSpec rejects more); they are drawn as
  // elbows beside the chain. Upgrade path: route long edges inside the gap between boxes.
  const side = new Set(edges.filter(([a, b]) => b !== a + 1).slice(0, 2).map(([a, b]) => `${a}-${b}`));
  return edges.map(([a, b]) => {
    const A = boxes[a], B = boxes[b];
    if (b === a + 1) return `<path class="${cls}" d="M${cx} ${A.y + A.h} V${B.y - 8}"/>`;
    if (!side.has(`${a}-${b}`)) return "";
    const ex = right + 24 + 14 * k++;
    return `<path class="${cls}" d="M${right} ${A.y + A.h / 2} H${ex} V${B.y + B.h / 2} H${right + 8}"/>`;
  }).filter(Boolean).join("\n  ");
}

// Text rows inside a box: label, optional sub, optional mono code lines.
function boxText(b, { cx, w, label, sub, code }) {
  let y = b.y + 44;
  const out = [`<text class="${label}" x="${cx}" y="${y}" text-anchor="middle" font-size="${label === "hublabel" ? 28 : 24}" ${fit(w - 40)}>${x(b.label)}</text>`];
  if (b.sub) out.push(`<text class="${sub}" x="${cx}" y="${(y += 30)}" text-anchor="middle" font-size="19" ${fit(w - 40)}>${x(b.sub)}</text>`);
  for (const l of b.lines) out.push(`<text class="${code}" x="${cx}" y="${(y += 30)}" text-anchor="middle" font-size="19" ${fit(w - 40)}>${x(l)}</text>`);
  return out.join("");
}

function railsdev(spec) {
  const L = 760, R = 1500, W = R - L, CX = (L + R) / 2;
  const boxes = stack(spec.diagram.nodes, { top: 96, bottom: 780 });
  const nodeSvg = boxes.map((b) => {
    const shape = b.kind === "card"
      ? `<rect class="box" x="${L}" y="${b.y}" width="${W}" height="${b.h}" rx="18"/>`
      : `<rect x="${L}" y="${b.y}" width="${W}" height="${b.h}" rx="18" fill="#fbedec" stroke="#cc0000" stroke-opacity="${b.kind === "hub" ? 0.9 : 0.55}" stroke-width="${b.kind === "hub" ? 3 : 2}"/>`;
    return shape + boxText(b, { cx: CX, w: W, label: "label", sub: "sub", code: "mono code" });
  }).join("\n  ");
  const dots = ["#ffffff", "#ffd2d2", "#8f8f8f"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <style>
      @font-face { font-family: 'Inter'; font-weight: 100 900; src: url('${INTER}') format('woff2'); }
      @font-face { font-family: 'Fira Code'; font-weight: 400; src: url('${FIRA}') format('woff2'); }
      text { font-family: 'Inter', sans-serif; }
      .mono { font-family: 'Fira Code', monospace; }
      .box { fill: #ffffff; stroke: #d8d5d2; stroke-width: 2; }
      .label { fill: #1c1a19; font-weight: 700; }
      .sub { fill: #57534e; }
      .code { fill: #1c1a19; }
      .arrow { stroke: #c9c9c9; stroke-width: 2.5; fill: none; marker-end: url(#arrowhead); }
    </style>
    <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#c9c9c9"/></marker>
    <linearGradient id="bggrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d40000"/><stop offset="0.45" stop-color="#990000"/><stop offset="1" stop-color="#050505"/></linearGradient>
    <radialGradient id="whiteglow" cx="0.18" cy="0.12" r="0.75"><stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="130"/></filter>
  </defs>
  <rect width="1600" height="900" fill="url(#bggrad)"/>
  <rect width="1600" height="900" fill="url(#whiteglow)"/>
  <ellipse cx="1450" cy="820" rx="420" ry="260" fill="#000000" opacity="0.55" filter="url(#blur)"/>
  <text x="96" y="250" fill="#ffffff" fill-opacity="0.72" font-size="22" font-weight="600" letter-spacing="4" ${fit(620)}>${x(spec.eyebrow)}</text>
  <text x="96" y="352" fill="#ffffff" font-size="92" font-weight="800" ${fit(620)}>${x(spec.title)}</text>
  <rect x="98" y="384" width="180" height="8" rx="4" fill="#ffffff"/>
  ${spec.subtitle.map((s, i) => `<text x="96" y="${458 + 42 * i}" fill="#ffffff" fill-opacity="0.92" font-size="30" ${fit(620)}>${x(s)}</text>`).join("\n  ")}
  ${spec.bullets.map((s, i) => `<circle cx="108" cy="${582 + 52 * i}" r="8" fill="${dots[i]}"/><text x="132" y="${590 + 52 * i}" fill="#ffffff" fill-opacity="0.92" font-size="24" ${fit(580)}>${x(s)}</text>`).join("\n  ")}
  ${nodeSvg}
  ${chainArrows(boxes, spec.diagram.edges, { cx: CX, right: R, cls: "arrow" })}
  <text x="1372" y="838" text-anchor="end" font-family="Fira Code, monospace" font-size="22" fill="#ffffff" fill-opacity="0.75">railsdev.io</text>
  <rect x="1392" y="800" width="72" height="72" rx="4" fill="#ffffff"/>
  <text x="1428" y="848" text-anchor="middle" font-family="Inter, sans-serif" font-weight="800" font-size="46" fill="#cc0000">R</text>
  ${FIT_SCRIPT}
</svg>
`;
}

// inasoft palette per node kind (rounded box colours of ai-agent-adalah.svg).
const INA = {
  card: { fill: "#EFEBFC", stroke: "#8B5CF6", text: "#6D3BD1", sw: 2 },
  accent: { fill: "#E5F7FA", stroke: "#0E9BB8", text: "#0E7490", sw: 2 },
  hub: { fill: "#E7F0FB", stroke: "#2383E2", text: "#1F66BE", sw: 2.5 },
};

function inasoft(spec) {
  const L = 880, W = 520, CX = L + W / 2;
  const boxes = stack(spec.diagram.nodes, { top: 110, bottom: 790 });
  const nodeSvg = boxes.map((b) => {
    const c = INA[b.kind];
    // ponytail: "hub" is a pill (rx = h/2) instead of the reference's free-standing circle; a circle
    // does not fit a vertical chain. Upgrade path: a radial layout when a hub node is present.
    const rx = b.kind === "hub" ? b.h / 2 : 16;
    return `<rect x="${L}" y="${b.y}" width="${W}" height="${b.h}" rx="${rx}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${c.sw}"/>`
      + boxText(b, { cx: CX, w: W, label: b.kind === "hub" ? "hublabel" : "label", sub: "sub", code: "code" }).replace(/class="(label|hublabel)"/, `class="$1" fill="${c.text}"`);
  }).join("\n    ");
  const dots = ["#2383E2", "#8B5CF6", "#0E9BB8"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <style>
      @font-face { font-family: 'Inter'; font-weight: 100 900; src: url('${INTER}') format('woff2'); }
      text { font-family: Inter, 'DejaVu Sans', Arial, sans-serif; }
      .label, .hublabel { font-weight: 700; }
      .sub { fill: #5B5A56; }
      .code { fill: #37352F; font-family: 'DejaVu Sans Mono', monospace; }
      .arrow { stroke: #5B5A56; stroke-width: 3; fill: none; marker-end: url(#arrow); }
    </style>
    <pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" fill="#37352F" opacity="0.05"/></pattern>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#5B5A56"/></marker>
  </defs>
  <rect width="1600" height="900" fill="#FFFFFF"/>
  <rect width="1600" height="900" fill="url(#dots)"/>
  <g>
    <text x="130" y="250" font-size="22" fill="#5B5A56" letter-spacing="5" ${fit(640)}>${x(spec.eyebrow)}</text>
    <text x="126" y="350" font-size="88" font-weight="700" fill="#37352F" letter-spacing="-3" ${fit(660)}>${x(spec.title)}</text>
    <rect x="132" y="380" width="200" height="8" rx="4" fill="#2383E2"/>
    ${spec.subtitle.map((s, i) => `<text x="130" y="${452 + 44 * i}" font-size="32" fill="#4A4844" ${fit(660)}>${x(s)}</text>`).join("\n    ")}
    ${spec.bullets.map((s, i) => `<circle cx="144" cy="${583 + 60 * i}" r="8" fill="${dots[i]}"/><text x="170" y="${592 + 60 * i}" font-size="25" fill="#37352F" ${fit(620)}>${x(s)}</text>`).join("\n    ")}
    ${nodeSvg}
    ${chainArrows(boxes, spec.diagram.edges, { cx: CX, right: L + W, cls: "arrow" })}
  </g>
  ${FIT_SCRIPT}
</svg>
`;
}

// Deterministic PRNG so the same spec always draws the same dot cloud.
function rng(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bars = (x0, y0, w, fill, n = 3) =>
  Array.from({ length: n }, (_, i) => `<rect x="${x0}" y="${y0 + 18 * i}" width="${Math.round(w * [1, 0.86, 0.94][i % 3])}" height="7" rx="3.5" fill="${fill}"/>`).join("");

// fullstackweb stages: a tile drawing per node kind, centred on (cx, 290), at most w wide.
function stage(n, cx, w, last) {
  const top = 177, h = 226;
  if (n.kind === "hub") {
    const r = Math.min(150, w / 2), rand = rng(n.label);
    const dots = Array.from({ length: 48 }, () => {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (r - 14);
      return `<circle cx="${(cx + Math.cos(a) * d).toFixed(0)}" cy="${(290 + Math.sin(a) * d).toFixed(0)}" r="4.5" fill="#475569"/>`;
    }).join("");
    const spokes = [0.3, 1.5, 2.4, 3.9, 5.1].map((a) => {
      const sx = (cx + Math.cos(a) * r * 0.45).toFixed(0), sy = (290 + Math.sin(a) * r * 0.45).toFixed(0);
      return `<path d="M${cx} 290 L${sx} ${sy}" stroke="#c084fc" stroke-width="2"/><circle cx="${sx}" cy="${sy}" r="9" fill="#c084fc"/>`;
    }).join("");
    return { half: r, svg: `<circle cx="${cx}" cy="290" r="${r}" fill="none" stroke="${last ? "url(#brand)" : "#1e293b"}" stroke-width="${last ? 2.5 : 1.5}"/>${dots}<circle cx="${cx}" cy="290" r="26" fill="#a855f7" fill-opacity=".18"/>${spokes}<circle cx="${cx}" cy="290" r="13" fill="#f8fafc"/>` };
  }
  const tw = Math.min(200, w), x0 = cx - tw / 2;
  if (last) {
    return { half: tw / 2, svg: `<rect x="${x0}" y="${top - 18}" width="${tw}" height="${h + 36}" rx="16" fill="#0f172a" stroke="url(#brand)" stroke-width="2.5"/><circle cx="${x0 + 28}" cy="${top + 14}" r="9" fill="#c084fc"/><rect x="${x0 + 46}" y="${top + 10}" width="${tw * 0.48}" height="8" rx="4" fill="#64748b"/>${bars(x0 + 22, top + 44, tw - 44, "#334155", 5)}<rect x="${x0 + 22}" y="${top + 154}" width="${tw - 44}" height="40" rx="10" fill="#0c4a6e" stroke="#38bdf8" stroke-width="1.5"/>${bars(x0 + 38, top + 166, tw * 0.4, "#7dd3fc", 1)}` };
  }
  if (n.kind === "accent") {
    // 2 × 4 grid of small chunk tiles, every other one highlighted (the "Chunks" stage).
    const cw = 64, ch = 56, gx = 16, gy = 16, gx0 = cx - cw - gx / 2;
    const cells = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
      const on = (r + c * 3) % 3 === 1, X = gx0 + c * (cw + gx), Y = top - 17 + r * (ch + gy);
      cells.push(`<rect x="${X}" y="${Y}" width="${cw}" height="${ch}" rx="10" ${on ? 'fill="#0c4a6e" stroke="#38bdf8" stroke-width="2"' : 'class="tile"'}/><rect x="${X + 12}" y="${Y + 16}" width="40" height="6" rx="3" fill="${on ? "#7dd3fc" : "#334155"}"/><rect x="${X + 12}" y="${Y + 32}" width="28" height="6" rx="3" fill="${on ? "#7dd3fc" : "#334155"}"/>`);
    }
    return { half: cw + gx / 2, svg: cells.join("") };
  }
  // card: stacked document tiles.
  const fw = tw - 44, fx = x0 + 44;
  return { half: tw / 2, svg: `<rect class="tile" x="${x0}" y="${top + 36}" width="${fw}" height="${h}" rx="14"/><rect class="tile" x="${x0 + 22}" y="${top + 18}" width="${fw}" height="${h}" rx="14"/><rect class="tile" x="${fx}" y="${top}" width="${fw}" height="${h}" rx="14"/>${bars(fx + 22, top + 32, fw - 44, "#334155")}<rect x="${fx + 22}" y="${top + 96}" width="${fw - 44}" height="66" rx="6" fill="#1e293b"/>${bars(fx + 22, top + 178, fw - 44, "#334155")}` };
}

function fullstackweb(spec) {
  // ponytail: this skin draws at most 4 stages (the site's covers never show more); a 5th node and
  // its edges are dropped. Non-adjacent edges are not drawn — the stages read left → right.
  const nodes = spec.diagram.nodes.slice(0, 4);
  const edges = spec.diagram.edges.filter(([a, b]) => b === a + 1 && b < nodes.length);
  const slot = 1080 / nodes.length;
  const centers = nodes.map((_, i) => Math.round(60 + slot * (i + 0.5)));
  const stages = nodes.map((n, i) => stage(n, centers[i], slot - 90, i === nodes.length - 1));
  const arrows = edges.map(([a, b]) => {
    const x1 = centers[a] + stages[a].half + 12, x2 = centers[b] - stages[b].half - 12;
    return `<path class="link" d="M${x1} 290 H${x2}"/><path d="M${x2} 290l-11-7v14z" fill="#475569"/>`;
  }).join("");
  const captions = nodes.map((n, i) => `<text class="label" x="${centers[i]}" y="490" font-size="21" ${fit(slot - 20)}>${x(n.label)}</text>`).join("");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<style>
@font-face { font-family: 'Inter Variable'; src: url('${INTER}') format('woff2'); font-weight: 100 900; }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #090d16; }
svg { display: block; font-family: 'Inter Variable', sans-serif; }
.label { font-weight: 600; fill: #cbd5e1; text-anchor: middle; }
.tile { fill: #0f172a; stroke: #334155; stroke-width: 1.5; }
.link { fill: none; stroke: #475569; stroke-width: 2; }
</style>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <radialGradient id="glowA" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#38bdf8" stop-opacity=".30"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient>
  <radialGradient id="glowB" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#a855f7" stop-opacity=".26"/><stop offset="1" stop-color="#a855f7" stop-opacity="0"/></radialGradient>
  <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#38bdf8"/><stop offset=".5" stop-color="#818cf8"/><stop offset="1" stop-color="#c084fc"/></linearGradient>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#1e293b" stroke-opacity=".45"/></pattern>
</defs>
<rect width="1200" height="630" fill="#090d16"/><rect width="1200" height="630" fill="url(#grid)"/>
<ellipse cx="200" cy="300" rx="320" ry="280" fill="url(#glowA)"/><ellipse cx="1000" cy="300" rx="340" ry="300" fill="url(#glowB)"/>
${stages.map((s) => s.svg).join("\n")}
${arrows}
${captions}
</svg>
${FIT_SCRIPT.replace("<![CDATA[", "").replace("]]>", "")}
</body>
</html>
`;
}

export const TEMPLATES = {
  railsdev: { ext: "svg", width: 1600, height: 900, scale: 1, render: railsdev },
  inasoft: { ext: "svg", width: 1600, height: 900, scale: 1, render: inasoft },
  fullstackweb: { ext: "html", width: 1200, height: 630, scale: 2, render: fullstackweb },
};
