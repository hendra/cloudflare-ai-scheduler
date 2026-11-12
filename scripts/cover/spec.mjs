// Cover-spec contract shared by the three blog writers.
// The AI returns one small JSON object describing the cover (text block + diagram);
// scripts/cover/templates.mjs turns it into each site's own cover design.
// Spec: docs/superpowers/specs/2026-11-12-blog-cover-standard-design.md

export const LIMITS = { eyebrow: 28, title: 30, subtitle: 42, bullet: 34, label: 24, sub: 24, line: 32 };
export const KINDS = ["card", "accent", "hub"];
// fullstackweb draws its stages side by side and has room for 4; the vertical skins take 5.
export const MAX_NODES = { railsdev: 5, inasoft: 5, fullstackweb: 4 };
const MAX_SIDE_EDGES = 2; // non-adjacent edges drawn as elbows beside the chain

export const escapeXml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Over-long text is clamped at a word boundary (cosmetic), not rejected.
function clamp(s, max) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at >= Math.floor(max / 2) ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s.,;:!?—–-]+$/u, "");
}

const SITE_NOTES = {
  railsdev: "Site: railsdev.io (senior Rails consultancy). Write all text in English.",
  fullstackweb: "Site: fullstackweb.dev. Write all text in English. This site's cover draws ONLY the diagram (no title text), so make the diagram nodes carry the story; still fill every field.",
  inasoft: "Site: inasoft.id. Write all text in Indonesian (Bahasa Indonesia); code identifiers stay as-is.",
};

export function coverSpecPrompt({ site, title, keyword, body }) {
  const text = String(body || "");
  const h2 = (text.match(/^## .+$/gm) || []).map((l) => l.slice(3).trim()).slice(0, 10);
  const intro = (text.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith("#")) || "").trim().slice(0, 600);
  return `You design the cover illustration for one blog article. ${SITE_NOTES[site] || ""}
Article title: ${title}
Primary keyword: ${keyword}
Sections: ${h2.join(" | ")}
Opening paragraph: ${intro}

The cover has a left text block and a right diagram of the architecture or workflow the article recommends. Keep labels short and technically true to the article. Never show prices.
The 3 bullets are concrete points about the article's subject (what it does, what the reader learns or does). Never describe the cover: no "left", "right", "diagram", "takeaways", "pricing", "image", "shown here".
Reply with ONLY this JSON (no prose, no code fence):
{"eyebrow":"topic in 2-4 words (<= ${LIMITS.eyebrow} chars)","title":"tool or concept name (<= ${LIMITS.title} chars)","subtitle":["line 1 (<= ${LIMITS.subtitle} chars)","line 2 (<= ${LIMITS.subtitle} chars)"],"bullets":["exactly 3 short points (<= ${LIMITS.bullet} chars each), each a fact about the topic","...","..."],"diagram":{"nodes":[{"label":"<= ${LIMITS.label} chars","sub":"optional, <= ${LIMITS.sub} chars","kind":"card|accent|hub","lines":["optional code line, <= ${LIMITS.line} chars"]}],"edges":[[0,1]]}}
Diagram rules: 2-${MAX_NODES[site] || 5} nodes in reading order; kind "accent" highlights the key step, "hub" marks a central component, "card" is a plain box; at most 2 "lines" per node (class names, commands, columns); edges are [from, to] node indexes with from < to; at most ${MAX_SIDE_EDGES} edges may skip a node.`;
}

export function parseCoverSpec(raw, maxNodes = 5) {
  const m = String(raw ?? "").match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, errs: ["no JSON object in reply"] };
  let j;
  try { j = JSON.parse(m[0]); } catch (e) { return { ok: false, errs: [`invalid JSON: ${e.message}`] }; }
  const errs = [];
  const str = (v) => typeof v === "string" && v.trim().length > 0;
  if (!str(j.eyebrow)) errs.push("eyebrow missing");
  if (!str(j.title)) errs.push("title missing");
  if (!Array.isArray(j.subtitle) || j.subtitle.length !== 2 || !j.subtitle.every(str)) errs.push("subtitle must be 2 non-empty lines");
  if (!Array.isArray(j.bullets) || j.bullets.length !== 3 || !j.bullets.every(str)) errs.push("bullets must be exactly 3");
  const nodes = j.diagram?.nodes;
  const edges = j.diagram?.edges ?? [];
  if (!Array.isArray(nodes) || nodes.length < 2 || nodes.length > maxNodes) errs.push(`diagram needs 2-${maxNodes} nodes`);
  else nodes.forEach((n, i) => {
    if (!n || !str(n.label)) errs.push(`node ${i} label missing`);
    if (n?.kind !== undefined && !KINDS.includes(n.kind)) errs.push(`node ${i} kind "${n.kind}" not in ${KINDS.join("|")}`);
    if (n?.lines !== undefined && (!Array.isArray(n.lines) || n.lines.length > 2)) errs.push(`node ${i} lines must be <= 2 items`);
  });
  const nn = Array.isArray(nodes) ? nodes.length : 0;
  if (!Array.isArray(edges) || !edges.every((e) => Array.isArray(e) && e.length === 2 && Number.isInteger(e[0]) && Number.isInteger(e[1]) && e[0] >= 0 && e[0] < e[1] && e[1] < nn)) {
    errs.push("edges must be [from, to] with 0 <= from < to < nodes");
  } else if (new Set(edges.map(String)).size !== edges.length) errs.push("duplicate edges");
  else if (edges.filter(([a, b]) => b !== a + 1).length > MAX_SIDE_EDGES) errs.push(`at most ${MAX_SIDE_EDGES} edges may skip a node`);
  if (errs.length) return { ok: false, errs };
  return {
    ok: true,
    spec: {
      eyebrow: clamp(j.eyebrow, LIMITS.eyebrow).toUpperCase(),
      title: clamp(j.title, LIMITS.title),
      subtitle: j.subtitle.map((s) => clamp(s, LIMITS.subtitle)),
      bullets: j.bullets.map((s) => clamp(s, LIMITS.bullet)),
      diagram: {
        nodes: nodes.map((n) => ({
          label: clamp(n.label, LIMITS.label),
          sub: str(n.sub) ? clamp(n.sub, LIMITS.sub) : "",
          kind: n.kind || "card",
          lines: (n.lines || []).filter(str).map((s) => clamp(s, LIMITS.line)),
        })),
        edges: edges.map(([a, b]) => [a, b]),
      },
    },
  };
}

export const coverAltFromSpec = (spec) => `Diagram: ${spec.diagram.nodes.map((n) => n.label).join(" → ")}`;

// Valid spec for AI_STUB=true offline runs.
export const STUB_SPEC = {
  eyebrow: "PIPELINE STUB",
  title: "Stub cover",
  subtitle: ["Offline pipeline test", "never published"],
  bullets: ["Topic from signals", "Body validated", "Cover rendered"],
  diagram: {
    nodes: [
      { label: "Signals", sub: "HN + Trending", kind: "card", lines: [] },
      { label: "AI writer", sub: "topic + body", kind: "accent", lines: [] },
      { label: "Site build", sub: "astro build", kind: "card", lines: ["npm run build"] },
    ],
    edges: [[0, 1], [1, 2]],
  },
};
