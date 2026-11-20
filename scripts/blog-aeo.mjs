// Shared AEO/GEO prompt builder, deterministic validator, and post-check runner
// for all three automated blog writers (zero-dependency Node 20 ESM).

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

export const RAILSDEV_SERVICE_LINKS = {
  "MVP Build": "/services/saas-mvp-development",
  "Rails Upgrade": "/services/legacy-rails-modernization",
  "Custom Module": "/services/custom-web-application-development",
  "Code Audit": "/services/ruby-on-rails-consulting",
  "AI Integration": "/services/ai-software-development",
};

const DEFAULT_MIN_WORDS = 1500;
const META_ERR_RE =
  /^(missing (?:title|seoTitle|description|slug|keyword)|title length|seoTitle|description|slug format|slug already exists|duplicate keyword)/i;

function escapeRe(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lowercase and fold accents, punctuation, and hyphens so "Node.js" matches "node-js". */
export function foldText(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Same fence rule as validateAeoGeo (the gate): a closer is a bare run of the opener's char.
const FENCE_RE = /^\s*(```+|~~~+)(\S*)/;
function closesFence(line, open) {
  const m = line.match(/^\s*(`{3,}|~{3,})\s*$/);
  return !!m && m[1][0] === open[0];
}

/** Calls fn(line, index, inFence, openMatch) for every line, tracking fences like the validator. */
function scanLines(lines, fn) {
  let open = "";
  lines.forEach((line, i) => {
    if (open) {
      if (closesFence(line, open)) open = "";
      fn(line, i, true, null);
      return;
    }
    const m = line.match(FENCE_RE);
    if (m) open = m[1];
    fn(line, i, !!m, m);
  });
}

/**
 * Adds the links the site requires but the model forgot, deterministically: service page,
 * contact CTA (with its label), the fetched signal page as primary source, a `text` tag on
 * untagged opening fences, and relative paths for absolute self-domain links. Never removes.
 */
export function ensureRequiredLinks(body, cfg = {}) {
  const isId = cfg.lang === "id";
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const selfRe = cfg.domain
    ? new RegExp(`\\]\\(https?://(?:www\\.)?${escapeRe(cfg.domain)}(?=[/)#?])/?`, "gi")
    : null;
  let conclusionAt = -1;
  let insertAt = -1;
  const proseIdx = [];
  scanLines(lines, (line, i, inFence, m) => {
    if (m && !m[2]) lines[i] = line.replace(m[1], `${m[1]}text`);
    if (inFence) return;
    proseIdx.push(i);
    if (selfRe) lines[i] = lines[i].replace(selfRe, "](/");
    if (/^##\s/.test(line)) {
      if (conclusionAt !== -1 && insertAt === -1) insertAt = i;
      if (new RegExp(`^## ${escapeRe(cfg.conclusionHeading || "")}\\b`, "i").test(line)) conclusionAt = i;
    }
  });
  const prose = proseIdx.map((i) => lines[i]).join("\n");
  const internal = [...prose.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
  const ownRe = cfg.domain ? new RegExp(`^https?://(?:www\\.)?${escapeRe(cfg.domain)}`, "i") : null;
  const external = [...prose.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].filter((m) => !ownRe || !ownRe.test(m[1]));
  const servicePrefix = String(cfg.serviceHref || "").match(/^\/[^/]+\//)?.[0];

  const parts = [];
  if (cfg.serviceHref && servicePrefix && !internal.some((h) => h.startsWith(servicePrefix))) {
    parts.push(isId ? `Lihat [layanan terkait](${cfg.serviceHref}) untuk implementasinya.` : `See [the related service](${cfg.serviceHref}) for hands-on help.`);
  }
  const label = cfg.contactLabel || (isId ? "Konsultasi Gratis" : "get in touch");
  if (cfg.contactHref && (!internal.includes(cfg.contactHref) || (cfg.contactLabel && !prose.includes(cfg.contactLabel)))) {
    parts.push(isId ? `Butuh bantuan? [${label}](${cfg.contactHref}).` : `Questions about your setup? [${label}](${cfg.contactHref}).`);
  }
  if (cfg.sourceUrl && external.length === 0) {
    parts.push(isId ? `Sumber utama: [halaman resmi proyek](${cfg.sourceUrl}).` : `Primary source: [the official project page](${cfg.sourceUrl}).`);
  }
  // Number-free boilerplate, so it can never fail grounding; only added when the model left it out.
  const verifRe = isId ? /^>\s*(?:\*\*|__)?(?:catatan verifikasi|verification note)\b/im : /^>\s*(?:\*\*|__)?verification note\b/im;
  if (!verifRe.test(prose)) {
    parts.push(isId
      ? "\n\n> Catatan verifikasi: hasil dan performa bergantung pada versi, konfigurasi, dan lingkungan masing-masing; uji di lingkungan Anda sendiri sebelum dipakai di produksi."
      : "\n\n> Verification note: results depend on your versions, configuration and environment; test in your own setup before relying on them in production.");
  }
  const out = parts.length === 0 ? lines : (() => {
    const para = ["", parts.join(" ").replace(/ \n\n/g, "\n\n").trimStart(), ""];
    if (insertAt !== -1) return [...lines.slice(0, insertAt), ...(lines[insertAt - 1]?.trim() ? para : para.slice(1)), ...lines.slice(insertAt)];
    return [...lines.join("\n").trimEnd().split("\n"), ...para.slice(0, 2)];
  })();
  return out.join("\n");
}

const countWords = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;
const stripMdWrap = (t) => String(t || "").trim().replace(/^```(?:markdown|md)?\n/, "").replace(/\n```$/, "").trim();

/**
 * Body generation that expands a short draft instead of discarding it: free models stop at
 * ~1000-1400 words, and a from-scratch retry lands short again. Keeps the longest draft.
 * Returns { body: null } when no attempt reaches minWords (caller skips the article);
 * throws the last error when every call failed.
 */
export async function generateBody({ callModel, prompt, minWords, attempts = 3 }) {
  let best = "";
  let lastErr = null;
  let answered = false;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const p = best
      ? `${prompt}\n\nYour draft below has only ${countWords(best)} words; it needs at least ${minWords}. Expand it to ${minWords + 300}+ words: deepen every section with concrete steps, examples and trade-offs, and keep every heading, link, table, code block, FAQ and the verification note. Return ONLY the full expanded markdown body.\n\nDraft:\n${best}`
      : prompt;
    try {
      const text = stripMdWrap(await callModel(p));
      answered = true;
      const n = countWords(text);
      if (n >= minWords) return { body: text, words: n };
      console.error(`body attempt ${attempt}: too short (${n} words, need >= ${minWords})`);
      if (n > countWords(best)) best = text;
    } catch (e) {
      lastErr = e;
      console.error(`body attempt ${attempt}:`, e.message);
    }
  }
  // No model answered at all: an outage, not a short article — let the caller fail red.
  if (!answered && lastErr) throw lastErr;
  return { body: null, words: countWords(best) };
}

export function isMetaErr(err) {
  return META_ERR_RE.test(String(err || ""));
}

export function servicePathFor(site, article) {
  if (site === "railsdev") {
    return (
      RAILSDEV_SERVICE_LINKS[article?.service] ||
      "/services/ruby-on-rails-development"
    );
  }
  if (site === "fullstackweb") {
    const slug = Array.isArray(article?.services)
      ? article.services[0]
      : article?.service;
    return slug ? `/services/${slug}/` : "/services/full-stack-development/";
  }
  if (site === "hendranicholas") {
    const slug = Array.isArray(article?.services)
      ? article.services[0]
      : article?.service;
    return slug ? `/services/${slug}/` : "/services/nodejs-nextjs-development/";
  }
  if (site === "inasoft") {
    return article?.service
      ? `/layanan/${article.service}`
      : "/layanan/jasa-pembuatan-aplikasi-web";
  }
  return "";
}

export function buildAeoGeoBodyRules(cfg = {}) {
  const isId = cfg.lang === "id";
  const conclusionHeading = cfg.conclusionHeading || (isId ? "Kesimpulan" : "Conclusion");
  const faqHeading =
    cfg.faqHeading ||
    (isId ? "Pertanyaan yang sering diajukan" : "Frequently asked questions");
  const verifLabel = isId ? "Catatan verifikasi" : "Verification note";
  const postLinks = Array.isArray(cfg.validPostLinks)
    ? cfg.validPostLinks
    : cfg.validPostLinks
      ? [cfg.validPostLinks]
      : [];
  const extra = Array.isArray(cfg.extraRules)
    ? cfg.extraRules.filter(Boolean)
    : cfg.extraRules
      ? [cfg.extraRules]
      : [];

  const lines = [
    `Site: ${cfg.siteName || cfg.domain || "Blog"} (${cfg.domain || ""})`,
    `Language: ${isId ? "Bahasa Indonesia (KBBI, natural and clear)" : "English"}`,
    cfg.voiceRule ? `Voice: ${cfg.voiceRule}` : "",
    "Requirements:",
    "- 1800-2400 words (hard minimum 1500 words). Use `##` and `###` headings only — NEVER emit a `# ` H1 line, and NEVER skip heading levels (no `##` straight to `####`).",
    `- Answer-first opening paragraph (before the first \`##\` heading): 40-65 words that directly answer/define the topic and include the exact keyword "${cfg.keyword || ""}" naturally.`,
    "- Structure for AEO/GEO extractability: include >= 5 `##` sections (at least 2 phrased as clear questions or decision topics), open each `##` section with a 1-2 sentence direct answer, use short 2-4 sentence paragraphs, and include at least one Markdown comparison or decision table (`| ... | ... |` with `| --- | --- |`).",
    "- Code blocks: at least one fenced code block tagged with a language (e.g. ```ts, ```ruby, ```bash). Never use `mermaid` fences, and never leave a fence untagged or unclosed.",
    `- Factual grounding & citations: cite at least 1-2 real external primary sources (\`https://...\` official docs, GitHub repo, release notes, RFC/spec). Never invent benchmarks, percentages, client results, dates, or pricing. Include an explicit blockquote \`> ${verifLabel}: ...\` noting any unverified or environment-dependent claims.`,
    `- Internal links (2-4 distinct relative paths ONLY — NEVER use \`https://${cfg.domain || "example.com"}/...\`):`,
  ];

  if (cfg.serviceHref) {
    lines.push(`  - Link to the matching service page: \`${cfg.serviceHref}\``);
  }
  if (cfg.contactHref) {
    lines.push(
      `  - Link to \`${cfg.contactHref}\` in \`## ${conclusionHeading}\`${cfg.ctaInstruction ? ` (${cfg.ctaInstruction})` : ""}`,
    );
  } else if (cfg.ctaInstruction) {
    lines.push(`  - CTA in \`## ${conclusionHeading}\`: ${cfg.ctaInstruction}`);
  }
  if (postLinks.length > 0) {
    lines.push("  - Link 1-2 of these existing canonical posts (exact paths only):");
    for (const p of postLinks) lines.push(`    - ${p}`);
  }

  lines.push(
    `- Required closing sections:`,
    `  - \`## ${faqHeading}\` with 4-6 \`### Question?\` subheadings (at least 3 required) and concise 2-4 sentence answer-first replies.`,
    `  - \`## ${conclusionHeading}\` wrapping up with next steps${cfg.contactHref ? ` and the \`${cfg.contactHref}\` CTA` : ""}.`,
  );

  for (const r of extra) lines.push(`- ${r}`);

  return lines.filter(Boolean).join("\n");
}

export function validateAeoGeo(article = {}, cfg = {}) {
  const metaErrs = [];
  const bodyErrs = [];

  const title = String(article.title || "");
  const titleMin = cfg.titleMin ?? 20;
  const titleMax = cfg.titleMax ?? 120;
  if (!title || title.length < titleMin || title.length > titleMax) {
    metaErrs.push("title length");
  }

  if (cfg.seoTitleMax != null) {
    const seoTitle = String(article.seoTitle || "");
    if (!seoTitle) metaErrs.push("missing seoTitle");
    else if (seoTitle.length > cfg.seoTitleMax) {
      metaErrs.push(`seoTitle ${seoTitle.length} > ${cfg.seoTitleMax}`);
    }
  }

  const descMin = cfg.descMin ?? 120;
  const descMax = cfg.descMax ?? 160;
  const desc = String(article.description || "");
  if (!desc || desc.length < descMin || desc.length > descMax) {
    metaErrs.push(`description ${desc.length} not in ${descMin}-${descMax}`);
  }

  const slug = String(article.slug || "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    metaErrs.push("slug format");
  } else if (cfg.existingSlugs) {
    const slugSet =
      cfg.existingSlugs instanceof Set
        ? cfg.existingSlugs
        : new Set(cfg.existingSlugs);
    if (slugSet.has(slug)) metaErrs.push("slug already exists");
  }

  const kwFolded = foldText(article.keyword);
  if (!kwFolded) {
    metaErrs.push("missing keyword");
  } else if (cfg.existingKeywords) {
    const foldedExisting = new Set();
    for (const k of cfg.existingKeywords) {
      const fk = foldText(k);
      if (fk) foldedExisting.add(fk);
    }
    if (foldedExisting.has(kwFolded)) {
      metaErrs.push(`duplicate keyword "${article.keyword}"`);
    }
  }

  const rawBody = String(article.body || "").replace(/\r\n/g, "\n");
  const wordCount = rawBody.trim().split(/\s+/).filter(Boolean).length;
  const minWords = cfg.minWords ?? DEFAULT_MIN_WORDS;
  if (wordCount < minWords) {
    bodyErrs.push(`only ${wordCount} words (need >= ${minWords})`);
  }

  // Fence-aware heading & prose scan
  let level = 1;
  let inFence = false;
  let fenceChar = "";
  let hasH1 = false;
  let h2Count = 0;
  const fenceLangs = [];
  const proseLines = [];

  for (const line of rawBody.split("\n")) {
    const fence = line.match(/^\s*(```+|~~~+)(\S*)/);
    if (!inFence && fence) {
      fenceLangs.push(fence[2]);
      inFence = true;
      fenceChar = fence[1][0];
      continue;
    }
    if (inFence) {
      if (
        fence &&
        fence[1][0] === fenceChar &&
        line.trim().replace(new RegExp(`^${fenceChar}+`), "") === ""
      ) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    proseLines.push(line);
    const heading = line.match(/^(#{1,6})\s/);
    if (!heading) continue;
    const next = heading[1].length;
    if (next === 1) hasH1 = true;
    else if (next > level + 1) bodyErrs.push(`skipped heading level: "${line}"`);
    if (next === 2) h2Count++;
    level = next;
  }

  if (hasH1) bodyErrs.push("body contains H1 (#)");
  if (inFence) bodyErrs.push("unbalanced code fences");
  const untagged = fenceLangs.filter((l) => !l).length;
  if (untagged > 0) bodyErrs.push(`${untagged} code fence(s) without a language`);
  if (fenceLangs.includes("mermaid")) bodyErrs.push("mermaid blocks are not supported");
  if (h2Count < 4) bodyErrs.push(`only ${h2Count} H2 sections (need >= 4)`);

  const prose = proseLines.join("\n");
  if (/lorem(?:\s|_)ipsum|\{placeholder\}|\[insert/i.test(prose)) {
    bodyErrs.push("placeholder token in body");
  }

  // Answer-first opening paragraph before first ## heading
  const firstH2Idx = prose.search(/^##\s/m);
  const leadRegion = (firstH2Idx === -1 ? prose : prose.slice(0, firstH2Idx)).trim();
  const firstParagraph =
    leadRegion
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .find((b) => b && !/^#{1,6}\s|^(-{3,}|\*{3,}|_{3,})$/.test(b)) || "";

  if (!firstParagraph) {
    bodyErrs.push("missing opening paragraph before first ## heading");
  } else if (kwFolded && !foldText(firstParagraph).includes(kwFolded)) {
    bodyErrs.push("keyword missing from first paragraph");
  }

  // Markdown comparison/decision table
  if (!/^\|.+\|[ \t]*\n\|(?:\s*:?-{1,}:?\s*\|)+[ \t]*$/m.test(prose)) {
    bodyErrs.push("missing Markdown comparison/decision table");
  }

  // Conclusion heading
  const conclusionHeading = String(cfg.conclusionHeading || "Conclusion")
    .replace(/^#+\s*/, "")
    .trim();
  if (!new RegExp(`^## ${escapeRe(conclusionHeading)}\\b`, "im").test(prose)) {
    bodyErrs.push(`missing "## ${conclusionHeading}" section`);
  }

  // FAQ section: >= 3 ### Q&As strictly inside FAQ section (ignoring code fences)
  const faqHeading = String(cfg.faqHeading || "Frequently asked questions")
    .replace(/^#+\s*/, "")
    .trim();
  const faqHeadingRe = new RegExp(`^## ${escapeRe(faqHeading)}\\s*$`, "i");
  let faqFound = false;
  let faqInFence = false;
  let faqFenceChar = "";
  const faqItems = [];

  for (const line of rawBody.split("\n")) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (!faqInFence && fence) {
      faqInFence = true;
      faqFenceChar = fence[1][0];
      if (faqFound && faqItems.length > 0) faqItems[faqItems.length - 1].lines.push(line);
      continue;
    }
    if (faqInFence) {
      if (faqFound && faqItems.length > 0) faqItems[faqItems.length - 1].lines.push(line);
      if (
        fence &&
        fence[1][0] === faqFenceChar &&
        line.trim().replace(new RegExp(`^${faqFenceChar}+`), "") === ""
      ) {
        faqInFence = false;
        faqFenceChar = "";
      }
      continue;
    }
    if (!faqFound) {
      if (faqHeadingRe.test(line.trim())) faqFound = true;
      continue;
    }
    if (/^##\s/.test(line)) break;
    if (/^###(?:\s|$)/.test(line)) {
      faqItems.push({ q: line.slice(3).trim(), lines: [] });
    } else if (faqItems.length > 0) {
      faqItems[faqItems.length - 1].lines.push(line);
    }
  }

  if (!faqFound) {
    bodyErrs.push(`missing "## ${faqHeading}" FAQ section`);
  } else {
    if (faqItems.length < 3) {
      bodyErrs.push(
        `FAQ section has only ${faqItems.length} question(s) (need >= 3 ### items)`,
      );
    }
    if (faqItems.some((item) => !item.q || !item.lines.join("\n").trim())) {
      bodyErrs.push("FAQ section has an empty question or answer");
    }
  }

  // Verification blockquote
  const verifRe =
    cfg.verificationPattern instanceof RegExp
      ? cfg.verificationPattern
      : cfg.lang === "id"
        ? /^>\s*(?:\*\*|__)?(?:catatan verifikasi|verification note)\b/im
        : /^>\s*(?:\*\*|__)?verification note\b/im;
  if (!verifRe.test(prose)) {
    bodyErrs.push("missing verification note blockquote");
  }

  // Internal & external links (prose only)
  if (cfg.domain) {
    const selfDomainLinkRe = new RegExp(
      `\\]\\(https?://(?:www\\.)?${escapeRe(cfg.domain)}(?=[/)#?\\s]|$)`,
      "i",
    );
    if (selfDomainLinkRe.test(prose)) {
      bodyErrs.push(`use relative links (/...) instead of https://${cfg.domain}`);
    }
  }

  const internal = [...prose.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
  const distinctInternal = new Set(internal);
  if (distinctInternal.size < 2) {
    bodyErrs.push(`only ${distinctInternal.size} distinct internal links (need >= 2)`);
  }
  if (cfg.servicePrefix && !internal.some((h) => h.startsWith(cfg.servicePrefix))) {
    bodyErrs.push(`missing ${cfg.servicePrefix}... service link`);
  }
  if (cfg.contactHref && !internal.some((h) => h === cfg.contactHref)) {
    bodyErrs.push(`missing ${cfg.contactHref} CTA link`);
  }
  if (cfg.requiredText && !prose.includes(cfg.requiredText)) {
    bodyErrs.push(`missing required CTA text "${cfg.requiredText}"`);
  }

  if (cfg.trailingSlash === true || cfg.trailingSlash === false) {
    for (const href of internal) {
      const target = href.split("#")[0].split("?")[0] || "/";
      if (target === "/") continue;
      if (cfg.trailingSlash && !target.endsWith("/")) {
        bodyErrs.push(`internal link missing trailing slash: ${href}`);
      } else if (!cfg.trailingSlash && target.endsWith("/")) {
        bodyErrs.push(`internal link must not have trailing slash: ${href}`);
      }
    }
  }

  if (cfg.validBlogPaths != null) {
    const validBlogSet =
      cfg.validBlogPaths instanceof Set
        ? cfg.validBlogPaths
        : new Set(cfg.validBlogPaths);
    for (const href of internal) {
      const target = href.split("#")[0].split("?")[0] || "/";
      if (target.startsWith("/blog/") && target !== "/blog/") {
        if (!validBlogSet.has(target)) {
          bodyErrs.push(`invalid or unknown blog link: ${href}`);
        }
      }
    }
  }

  const ownDomainRe = cfg.domain
    ? new RegExp(`^https?://(?:www\\.)?${escapeRe(cfg.domain)}(?=[/:?#]|$)`, "i")
    : null;
  const externalLinks = [
    ...new Set(
      [...prose.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)]
        .map((m) => m[1])
        .filter((u) => !ownDomainRe || !ownDomainRe.test(u)),
    ),
  ];
  if (externalLinks.length < 1) {
    bodyErrs.push("missing external primary-source citation (need >= 1)");
  }

  // Site-specific banned phrases & language checks
  for (const entry of cfg.bannedPatterns || []) {
    const [re, reason] = Array.isArray(entry) ? entry : [entry.re, entry.reason];
    if (!(re instanceof RegExp)) continue;
    const hit = prose.match(re);
    if (hit) bodyErrs.push(`banned phrase "${hit[0]}": ${reason}`);
  }

  if (cfg.indonesianGuard) {
    const indonesian = prose.match(
      /\b(adalah|yang|dengan|untuk|tidak|kami|anda|bisa|juga|dari)\b/gi,
    );
    if ((indonesian?.length ?? 0) >= 3) {
      bodyErrs.push(
        `${indonesian.length} Indonesian words (e.g. "${indonesian[0]}"): posts must be in English`,
      );
    }
  }

  const errs = [...metaErrs, ...bodyErrs];
  return {
    ok: errs.length === 0,
    errs,
    metaErrs,
    bodyErrs,
    links: externalLinks,
    wordCount,
  };
}

export function runSitePostCheck({ siteDir, relMdPath }) {
  const candidates = [
    join(siteDir, ".claude/skills/write-blog-article/scripts/check_post.mjs"),
    join(siteDir, "scripts/check-post.mjs"),
  ];
  const checkScript = candidates.find((p) => existsSync(p));
  if (!checkScript) return { skipped: true, script: null };

  try {
    execFileSync("node", [resolve(checkScript), relMdPath], {
      cwd: siteDir,
      stdio: "pipe",
    });
    return { skipped: false, script: checkScript };
  } catch (e) {
    const out = (String(e.stdout || "") + "\n" + String(e.stderr || "")).trim();
    throw new Error(
      `site post check (${checkScript}) failed:\n${out.slice(-800) || e.message}`,
    );
  }
}
