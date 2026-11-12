// Assert-based self-check for the blog cover pipeline (no framework).
// Run: npm run cover:selfcheck
import assert from "node:assert/strict";
import { escapeXml, parseCoverSpec, coverAltFromSpec, coverSpecPrompt, STUB_SPEC } from "./spec.mjs";
import { TEMPLATES } from "./templates.mjs";
import { renderCover, pngSize, findChrome } from "./render.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const good = {
  eyebrow: "rails pgvector",
  title: "pgvector",
  subtitle: ["Vector search in PostgreSQL", "with Rails"],
  bullets: ["a", "b", "c"],
  diagram: {
    nodes: [{ label: "Document", sub: "title + body" }, { label: "Embed job", kind: "accent" }, { label: "Chunks", lines: ["embedding vector(768)"] }],
    edges: [[0, 1], [1, 2]],
  },
};

// ---- spec contract ----
assert.equal(escapeXml(`R&D <x> "q"`), "R&amp;D &lt;x&gt; &quot;q&quot;");
let r = parseCoverSpec("Sure!\n```json\n" + JSON.stringify(good) + "\n```");
assert.equal(r.ok, true);
assert.equal(r.spec.diagram.nodes[0].kind, "card");
assert.deepEqual(r.spec.diagram.nodes[0].lines, []);
const longTitle = parseCoverSpec(JSON.stringify({ ...good, title: "A very long cover title that is way past thirty" }));
assert.equal(longTitle.ok, true);
assert.ok(longTitle.spec.title.length <= 30);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, bullets: ["a", "b"] })).ok, false);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, diagram: { ...good.diagram, edges: [[2, 1]] } })).ok, false);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, diagram: { nodes: [good.diagram.nodes[0]], edges: [] } })).ok, false);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, diagram: { ...good.diagram, nodes: [{ label: "x", kind: "blob" }, good.diagram.nodes[1]] } })).ok, false);
assert.equal(parseCoverSpec("no json here").ok, false);
assert.equal(coverAltFromSpec(r.spec), "Diagram: Document → Embed job → Chunks");
assert.match(coverSpecPrompt({ site: "inasoft", title: "T", keyword: "k", body: "Intro.\n\n## Satu\n\n## Dua" }), /Indonesia[n]?/i);
assert.match(coverSpecPrompt({ site: "railsdev", title: "T", keyword: "k", body: "Intro.\n\n## One\n\n## Two" }), /One[\s\S]*Two/);
assert.equal(parseCoverSpec(JSON.stringify(STUB_SPEC)).ok, true);

// ---- templates ----
const amp = parseCoverSpec(JSON.stringify({ ...good, title: "R&D Ops" })).spec;
for (const [site, t] of Object.entries(TEMPLATES)) {
  const out = t.render(amp);
  assert.ok(out.includes("Document"), `${site}: node label`);
  assert.ok(!/R&D/.test(out), `${site}: raw ampersand leaked`);
}
assert.match(TEMPLATES.railsdev.render(amp), /#d40000[\s\S]*R&amp;D Ops[\s\S]*railsdev\.io[\s\S]*>R</);
assert.match(TEMPLATES.inasoft.render(amp), /R&amp;D Ops[\s\S]*#2383E2/);
assert.match(TEMPLATES.fullstackweb.render(amp), /#090d16/);
assert.ok(!TEMPLATES.fullstackweb.render(amp).includes("R&amp;D Ops"), "fullstackweb is title-less");
assert.deepEqual([TEMPLATES.fullstackweb.width, TEMPLATES.fullstackweb.scale], [1200, 2]);
const five = parseCoverSpec(JSON.stringify({ ...good, diagram: { nodes: "ABCDE".split("").map((label) => ({ label, lines: ["x = 1", "y = 2"] })), edges: [[0, 1], [1, 2], [2, 3], [3, 4], [0, 4]] } })).spec;
// fullstackweb draws 4 stages: a 5th node must be rejected, not silently dropped.
const fiveNodes = { ...good, diagram: { nodes: "ABCDE".split("").map((label) => ({ label })), edges: [[0, 1], [1, 2], [2, 3], [3, 4]] } };
assert.equal(parseCoverSpec(JSON.stringify(fiveNodes), 4).ok, false);
assert.equal(parseCoverSpec(JSON.stringify({ ...fiveNodes, diagram: { nodes: "ABCD".split("").map((label) => ({ label })), edges: [[0, 1], [1, 2], [2, 3]] } }), 4).ok, true);
// duplicate edges and more than 2 edges that skip a node are rejected (they overflow the canvas).
assert.equal(parseCoverSpec(JSON.stringify({ ...good, diagram: { ...good.diagram, edges: [[0, 1], [0, 1]] } })).ok, false);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, diagram: { nodes: "ABCDE".split("").map((label) => ({ label })), edges: [[0, 1], [1, 2], [0, 2], [0, 3], [0, 4]] } })).ok, false);
for (const t of Object.values(TEMPLATES)) assert.ok(!/NaN|undefined/.test(t.render(five)), "no NaN/undefined in output");

// ---- renderer ----
const ihdr = Buffer.alloc(24);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(ihdr);
ihdr.write("IHDR", 12, "ascii"); ihdr.writeUInt32BE(1600, 16); ihdr.writeUInt32BE(900, 20);
const fake = join(tmpdir(), "cover-selfcheck-ihdr.png");
writeFileSync(fake, ihdr);
assert.deepEqual(pngSize(fake), [1600, 900]);

if (findChrome()) {
  const outDir = process.env.COVER_SAMPLES || join(tmpdir(), "cover-samples");
  const siteDir = process.env.COVER_SITE_DIR || mkdtempSync(join(tmpdir(), "cover-site-"));
  mkdirSync(outDir, { recursive: true });
  const ina = parseCoverSpec(JSON.stringify({
    eyebrow: "AI agents", title: "AI Agent", subtitle: ["Bukan sekadar menjawab,", "tetapi menyelesaikan tugas"],
    bullets: ["Merencanakan langkah", "Memanggil tool lewat API", "Minta bantuan manusia"],
    diagram: { nodes: [{ label: "Tujuan", sub: "apa yang diminta" }, { label: "AI agent", sub: "LLM + memori", kind: "hub" }, { label: "Panggil tool", sub: "CRM · email · database", kind: "accent" }, { label: "Hasil diperiksa", sub: "atau tanya manusia" }], edges: [[0, 1], [1, 2], [2, 3], [1, 3]] },
  })).spec;
  const longRd = parseCoverSpec(JSON.stringify({ ...good, eyebrow: "rails security", title: "Active Record Encryption Keys" })).spec;
  const cases = [["railsdev", r.spec, 1600, 900], ["railsdev-long", longRd, 1600, 900], ["inasoft", ina, 1600, 900], ["fullstackweb", r.spec, 2400, 1260], ["fullstackweb-hub", { ...r.spec, diagram: { nodes: [...r.spec.diagram.nodes, { label: "Cited answer", sub: "", kind: "card", lines: [] }].map((n, i) => (i === 2 ? { ...n, kind: "hub" } : n)), edges: [[0, 1], [1, 2], [2, 3]] } }, 2400, 1260]];
  for (const [name, spec, w, h] of cases) {
    const outPath = join(outDir, `${name}.png`);
    renderCover({ site: name.split("-")[0], spec, siteDir, outPath });
    assert.deepEqual(pngSize(outPath), [w, h], name);
  }
  console.log(`rendered ${cases.length} samples into ${outDir}`);
} else {
  console.log("chrome not found: render skipped");
}

console.log("cover self-check: ok");
