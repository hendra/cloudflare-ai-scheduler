// Assert-based self-check for scripts/blog-aeo.mjs and loadBlogCorpus extensions (no framework, offline).
// Run: node scripts/blog-aeo-selfcheck.mjs
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const {
  foldText,
  isMetaErr,
  servicePathFor,
  buildAeoGeoBodyRules,
  validateAeoGeo,
  runSitePostCheck,
} = await import("./blog-aeo.mjs");
const { loadBlogCorpus } = await import("./published.mjs");

const repeatSentence = (s, n) => Array.from({ length: n }, () => s).join(" ");

function makeEnValidBody({
  lead = "Node.js streams let backend services process large files and network payloads incrementally without buffering the entire payload into memory.",
  extraBody = "",
  table = "| Mode | Memory |\n| --- | --- |\n| Stream | O(1) |\n| Buffer | O(n) |",
  faqExtra = "",
  afterFaq = "",
  links = "See [our AI Integration service](/services/ai-software-development) and [existing post](/blog/rails-8-guide).",
  external = "Read the [Node.js Streams docs](https://nodejs.org/api/stream.html).",
  verification = "> Verification note: tested locally on Node 20 without production load claims.",
  cta = "Ready to ship? [Book a call](/#contact).",
} = {}) {
  return [
    `${lead} ${repeatSentence("Practical engineering context for production backends.", 10)}`,
    "",
    "## Why this pattern matters",
    "",
    `${links} ${external} ${repeatSentence("Backpressure keeps memory flat under concurrent traffic.", 110)}`,
    "",
    "## How to implement it",
    "",
    "```ts",
    "import { pipeline } from 'node:stream/promises';",
    "```",
    "",
    table,
    "",
    extraBody,
    repeatSentence("Step-by-step streaming pipeline setup and error handling.", 110),
    "",
    "## Common production pitfalls",
    "",
    repeatSentence("Avoid unhandled stream errors and missing timeouts in production.", 110),
    "",
    "## Verification",
    "",
    verification,
    "",
    "## Frequently asked questions",
    "",
    "### When should I use streams instead of buffers?",
    "",
    "Use streams whenever payloads exceed a few megabytes or arrive incrementally over HTTP.",
    faqExtra,
    "",
    "### How does backpressure protect memory?",
    "",
    "Backpressure pauses the upstream producer whenever the downstream consumer buffer is full.",
    "",
    "### Do async iterators work with Node.js streams?",
    "",
    "Yes, readable streams implement Symbol.asyncIterator so for-await-of handles chunks cleanly.",
    "",
    "## Conclusion",
    "",
    `${cta} ${repeatSentence("Start with one bottleneck endpoint and measure heap usage.", 60)}`,
    afterFaq,
  ]
    .filter((x) => x !== "")
    .join("\n");
}

function makeIdValidBody({
  lead = "Arsitektur RAG adalah pendekatan yang menggabungkan pencarian dokumen internal dengan model bahasa agar jawaban lebih akurat.",
  extraBody = "",
  blogLink = "/blog/ai-engineering/rag/rag-adalah",
  contactLink = "/#contact",
} = {}) {
  return [
    `${lead} ${repeatSentence("Pendekatan ini membantu tim developer berpengalaman mengurangi halusinasi pada aplikasi bisnis.", 10)}`,
    "",
    "## Mengapa arsitektur RAG relevan untuk bisnis",
    "",
    `Pelajari juga [layanan integrasi AI kami](/layanan/jasa-integrasi-ai-rag) dan baca [panduan dasar RAG](${blogLink}). Rujuk [dokumentasi resmi OpenAI](https://platform.openai.com/docs/guides/retrieval) untuk spesifikasi API. ${repeatSentence("Konteks dokumen perusahaan tetap terkendali tanpa melatih ulang model.", 100)}`,
    "",
    "## Perbandingan pendekatan integrasi",
    "",
    "| Pendekatan | Biaya Awal | Kontrol Data |\n| --- | --- | --- |\n| RAG | Rendah | Tinggi |\n| Fine-tuning | Tinggi | Sedang |",
    "",
    "```typescript",
    "export async function queryDocs(question: string) { return question.trim(); }",
    "```",
    "",
    extraBody,
    repeatSentence("Pastikan pipeline indexing dokumen memiliki kontrol akses berbasis peran.", 100),
    "",
    "## Kesalahan umum saat implementasi",
    "",
    repeatSentence("Jangan mengabaikan evaluasi kualitas retrieval sebelum merilis ke pengguna.", 100),
    "",
    "## Catatan verifikasi",
    "",
    "> Catatan verifikasi: angka dan arsitektur pada artikel ini bergantung pada ukuran korpus dan kebijakan keamanan masing-masing organisasi.",
    "",
    "## Pertanyaan yang sering diajukan",
    "",
    "### Berapa lama membangun sistem RAG produksi?",
    "",
    "Biasanya beberapa minggu tergantung kebersihan dokumen sumber dan kebutuhan otorisasi.",
    "",
    "### Apakah data perusahaan dikirim untuk melatih model?",
    "",
    "Tidak, jika menggunakan API enterprise dengan kebijakan zero data retention.",
    "",
    "### Kapan sebaiknya memilih RAG dibanding fine-tuning?",
    "",
    "Pilih RAG ketika data sering berubah dan setiap jawaban membutuhkan sitasi sumber.",
    "",
    "## Kesimpulan",
    "",
    `Mulai dari satu alur kerja bernilai tinggi dan jadwalkan [Konsultasi Gratis](${contactLink}) bersama tim kami. ${repeatSentence("Evaluasi akurasi secara berkala sebelum memperluas cakupan dokumen.", 60)}`,
  ]
    .filter((x) => x !== "")
    .join("\n");
}

// 1. Valid EN (railsdev, fullstackweb) and valid ID (inasoft) articles pass validateAeoGeo
{
  const railsdevCfg = {
    lang: "en",
    domain: "railsdev.io",
    seoTitleMax: 49,
    descMin: 120,
    descMax: 160,
    servicePrefix: "/services/",
    contactHref: "/#contact",
    conclusionHeading: "Conclusion",
    faqHeading: "Frequently asked questions",
    validBlogPaths: new Set(["/blog/rails-8-guide"]),
    existingSlugs: new Set(["rails-8-guide"]),
    existingKeywords: new Set(["rails 8 guide"]),
    indonesianGuard: true,
    bannedPatterns: [
      [/\b(our team|our developers|our engineers)\b/i, 'write "I"'],
    ],
  };

  const railsArticle = {
    title: "Node.js Streams in Production: Patterns for Reliable Backends",
    seoTitle: "Node.js Streams in Production Guide",
    description: "Practical guide to Node.js streams in production: backpressure, async iterators, error handling, and memory-safe pipelines for backend services.",
    keyword: "node.js streams",
    slug: "nodejs-streams-production-guide",
    service: "AI Integration",
    body: makeEnValidBody(),
  };

  const resRails = validateAeoGeo(railsArticle, railsdevCfg);
  assert.equal(resRails.ok, true, `expected railsdev valid, got: ${resRails.errs.join("; ")}`);
  assert.equal(resRails.metaErrs.length, 0);
  assert.equal(resRails.bodyErrs.length, 0);
  assert.ok(resRails.wordCount >= 1500);
  assert.ok(resRails.links.includes("https://nodejs.org/api/stream.html"));

  const fswCfg = {
    lang: "en",
    domain: "fullstackweb.dev",
    descMin: 100,
    descMax: 180,
    servicePrefix: "/services/",
    contactHref: "/contact/",
    trailingSlash: true,
    conclusionHeading: "Conclusion",
    faqHeading: "Frequently asked questions",
    validBlogPaths: new Set(["/blog/ts-guide/"]),
    existingSlugs: new Set(["ts-guide"]),
    existingKeywords: new Set(["typescript guide"]),
    indonesianGuard: true,
    bannedPatterns: [
      [/\b(our team|our developers|our engineers)\b/i, 'write "I"'],
    ],
  };

  const fswArticle = {
    title: "Node.js Streams in Production: TypeScript Pipeline Patterns",
    description: "Practical guide to Node.js streams in TypeScript backends: backpressure, error propagation, and clean resource cleanup without memory spikes.",
    keyword: "node.js streams",
    slug: "nodejs-streams-typescript-guide",
    services: ["nodejs-typescript-development"],
    body: makeEnValidBody({
      links: "See [my Node.js service](/services/nodejs-typescript-development/) and [TypeScript guide](/blog/ts-guide/).",
      cta: "Need architecture help? [Get in touch](/contact/).",
    }),
  };

  const resFsw = validateAeoGeo(fswArticle, fswCfg);
  assert.equal(resFsw.ok, true, `expected fullstackweb valid, got: ${resFsw.errs.join("; ")}`);

  const inasoftCfg = {
    lang: "id",
    domain: "inasoft.id",
    seoTitleMax: 50,
    descMin: 100,
    descMax: 160,
    servicePrefix: "/layanan/",
    contactHref: "/#contact",
    trailingSlash: false,
    conclusionHeading: "Kesimpulan",
    faqHeading: "Pertanyaan yang sering diajukan",
    verificationPattern: /^>\s*catatan verifikasi\b/im,
    validBlogPaths: new Set(["/blog/ai-engineering/rag/rag-adalah"]),
    existingSlugs: new Set(["rag-adalah"]),
    existingKeywords: new Set(["rag adalah"]),
    bannedPatterns: [
      [/engineer senior/i, 'say "tim developer berpengalaman"'],
      [/\bSeries A\b|\brunway\b|\bpendanaan\b/i, "startup-only framing"],
      [/\bRp ?\d/, "prices are never published"],
    ],
  };

  const inasoftArticle = {
    title: "Arsitektur RAG untuk Aplikasi Perusahaan di Indonesia",
    seoTitle: "Arsitektur RAG untuk Aplikasi Perusahaan",
    description: "Panduan praktis membangun arsitektur RAG yang aman untuk dokumen perusahaan: kontrol akses, evaluasi retrieval, dan integrasi API.",
    keyword: "arsitektur RAG",
    slug: "arsitektur-rag-aplikasi-perusahaan",
    service: "jasa-integrasi-ai-rag",
    body: makeIdValidBody(),
  };

  const resId = validateAeoGeo(inasoftArticle, inasoftCfg);
  assert.equal(resId.ok, true, `expected inasoft valid, got: ${resId.errs.join("; ")}`);
}

// 2. Punctuated/hyphenated keywords pass when folded; missing from first paragraph or missing lead fails
{
  assert.equal(foldText("Node.js streams"), "node js streams");
  assert.equal(foldText("next-js caching"), "next js caching");

  const cfg = {
    lang: "en",
    domain: "railsdev.io",
    seoTitleMax: 49,
    servicePrefix: "/services/",
    contactHref: "/#contact",
    conclusionHeading: "Conclusion",
    faqHeading: "Frequently asked questions",
    validBlogPaths: new Set(["/blog/rails-8-guide"]),
  };

  const hyphenPass = validateAeoGeo(
    {
      title: "Next-js Caching Strategies for Dynamic Apps",
      seoTitle: "Next.js Caching Strategies Guide",
      description: "Practical guide to Next.js caching layers in production web applications: request memoization, data cache layers, and safe revalidation.",
      keyword: "next-js caching",
      slug: "nextjs-caching-guide",
      body: makeEnValidBody({
        lead: "Next.js caching coordinates request memoization and data revalidation across server renders.",
      }),
    },
    cfg,
  );
  assert.equal(hyphenPass.ok, true, `expected hyphenated keyword match, got: ${hyphenPass.errs.join("; ")}`);

  const missingLeadKw = validateAeoGeo(
    {
      title: "Node.js Streams in Production Backends",
      seoTitle: "Node.js Streams Guide",
      description: "Practical guide to Node.js streams in production backends: backpressure, async iteration, error handling, and predictable memory usage.",
      keyword: "node.js streams",
      slug: "nodejs-streams-missing-kw",
      body: makeEnValidBody({
        lead: "Processing large files incrementally keeps server heap usage stable under load.",
      }),
    },
    cfg,
  );
  assert.equal(missingLeadKw.ok, false);
  assert.equal(missingLeadKw.metaErrs.length, 0, `unexpected metaErrs: ${missingLeadKw.metaErrs.join("; ")}`);
  assert.ok(missingLeadKw.bodyErrs.some((e) => /first paragraph/i.test(e)));

  const noOpeningPara = validateAeoGeo(
    {
      title: "Node.js Streams in Production Backends",
      seoTitle: "Node.js Streams Guide",
      description: "Practical guide to Node.js streams in production backends: backpressure, async iteration, error handling, and predictable memory usage.",
      keyword: "node.js streams",
      slug: "nodejs-streams-no-lead",
      body: makeEnValidBody().replace(/^[\s\S]*?(?=## Why this pattern matters)/, ""),
    },
    cfg,
  );
  assert.equal(noOpeningPara.ok, false);
  assert.ok(noOpeningPara.bodyErrs.some((e) => /opening paragraph/i.test(e)));
}

// 3. ### inside fenced bash/python block ignored; <3 FAQ items or empty answer fails; ## Conclusion stops FAQ parsing
{
  const cfg = {
    lang: "en",
    domain: "railsdev.io",
    seoTitleMax: 49,
    servicePrefix: "/services/",
    contactHref: "/#contact",
    conclusionHeading: "Conclusion",
    faqHeading: "Frequently asked questions",
    validBlogPaths: new Set(["/blog/rails-8-guide"]),
  };

  // Valid: 3 real ### items + a ### inside bash fence + a ### inside ## Conclusion
  const fencedFaqValid = validateAeoGeo(
    {
      title: "Node.js Streams in Production Backends",
      seoTitle: "Node.js Streams Guide",
      description: "Practical guide to Node.js streams in production backends: backpressure, async iteration, error handling, and predictable memory usage.",
      keyword: "node.js streams",
      slug: "nodejs-streams-fenced-faq",
      body: makeEnValidBody({
        faqExtra: "\n```bash\n### Fake FAQ heading inside bash fence\necho ok\n```",
        afterFaq: "\n### Post-conclusion subheading should not count as FAQ\n\nExtra wrap-up note.",
      }),
    },
    cfg,
  );
  assert.equal(fencedFaqValid.ok, true, `expected fenced ### + post-Conclusion ### to pass cleanly, got: ${fencedFaqValid.errs.join("; ")}`);

  // Invalid: only 2 real ### items, even though bash fence has ### and Conclusion has ###
  const twoFaqBody = makeEnValidBody({
    faqExtra: "\n```python\n### Fake FAQ inside python fence\nprint('ok')\n```",
    afterFaq: "\n### Not an FAQ item\n\nAfter conclusion.",
  }).replace(/\n### Do async iterators work with Node\.js streams\?[\s\S]*?(?=\n## Conclusion)/, "");

  const twoFaqRes = validateAeoGeo(
    {
      title: "Node.js Streams in Production Backends",
      seoTitle: "Node.js Streams Guide",
      description: "Practical guide to Node.js streams in production backends: backpressure, async iteration, error handling, and predictable memory usage.",
      keyword: "node.js streams",
      slug: "nodejs-streams-two-faq",
      body: twoFaqBody,
    },
    cfg,
  );
  assert.equal(twoFaqRes.ok, false);
  assert.ok(twoFaqRes.bodyErrs.some((e) => /only 2 question/i.test(e)), `expected 2-question FAQ error, got: ${twoFaqRes.bodyErrs.join("; ")}`);

  // Invalid: 3 ### items where the second has an empty answer
  const emptyAnswerBody = makeEnValidBody().replace(
    "Backpressure pauses the upstream producer whenever the downstream consumer buffer is full.",
    "",
  );
  const emptyAnswerRes = validateAeoGeo(
    {
      title: "Node.js Streams in Production Backends",
      seoTitle: "Node.js Streams Guide",
      description: "Practical guide to Node.js streams in production backends: backpressure, async iteration, error handling, and predictable memory usage.",
      keyword: "node.js streams",
      slug: "nodejs-streams-empty-faq",
      body: emptyAnswerBody,
    },
    cfg,
  );
  assert.equal(emptyAnswerRes.ok, false);
  assert.ok(emptyAnswerRes.bodyErrs.some((e) => /empty question or answer/i.test(e)));
}

// 4. Self-domain link or legacy flat /blog/rag-adalah link fails; corpus handles category/subcategory/draft
{
  const inasoftCfg = {
    lang: "id",
    domain: "inasoft.id",
    seoTitleMax: 50,
    descMin: 100,
    descMax: 160,
    servicePrefix: "/layanan/",
    contactHref: "/#contact",
    conclusionHeading: "Kesimpulan",
    faqHeading: "Pertanyaan yang sering diajukan",
    verificationPattern: /^>\s*catatan verifikasi\b/im,
    validBlogPaths: new Set(["/blog/ai-engineering/rag/rag-adalah"]),
  };

  const selfDomainRes = validateAeoGeo(
    {
      title: "Arsitektur RAG untuk Aplikasi Perusahaan di Indonesia",
      seoTitle: "Arsitektur RAG untuk Aplikasi Perusahaan",
      description: "Panduan praktis membangun arsitektur RAG yang aman untuk dokumen perusahaan: kontrol akses, evaluasi retrieval, dan integrasi API.",
      keyword: "arsitektur RAG",
      slug: "arsitektur-rag-self-domain",
      body: makeIdValidBody({
        blogLink: "https://inasoft.id/blog/ai-engineering/rag/rag-adalah",
      }),
    },
    inasoftCfg,
  );
  assert.equal(selfDomainRes.ok, false);
  assert.ok(selfDomainRes.bodyErrs.some((e) => /relative links/i.test(e)));

  const legacyFlatRes = validateAeoGeo(
    {
      title: "Arsitektur RAG untuk Aplikasi Perusahaan di Indonesia",
      seoTitle: "Arsitektur RAG untuk Aplikasi Perusahaan",
      description: "Panduan praktis membangun arsitektur RAG yang aman untuk dokumen perusahaan: kontrol akses, evaluasi retrieval, dan integrasi API.",
      keyword: "arsitektur RAG",
      slug: "arsitektur-rag-flat-link",
      body: makeIdValidBody({
        blogLink: "/blog/rag-adalah",
      }),
    },
    inasoftCfg,
  );
  assert.equal(legacyFlatRes.ok, false);
  assert.ok(legacyFlatRes.bodyErrs.some((e) => /\/blog\/rag-adalah/.test(e)));

  // Also test loadBlogCorpus reads category, subcategory, draft (flat & nested)
  const tmpSite = mkdtempSync(join(tmpdir(), "corpus-aeo-"));
  try {
    mkdirSync(join(tmpSite, "src/content/blog/nested"), { recursive: true });
    writeFileSync(
      join(tmpSite, "src/content/blog/rag-adalah.md"),
      `---\ntitle: "RAG Adalah"\nkeyword: "rag adalah"\ncategory: ai-engineering\nsubcategory: rag\ndraft: false\n---\n\nBody\n`,
    );
    writeFileSync(
      join(tmpSite, "src/content/blog/nested/draft-post.md"),
      `---\ntitle: "Draft Post"\ncategory: cloud-devops\nsubcategory: devops\ndraft: true\n---\n\nBody\n`,
    );
    const corpus = loadBlogCorpus(tmpSite);
    assert.equal(corpus.length, 2);
    const rag = corpus.find((c) => c.slug === "rag-adalah");
    assert.equal(rag.category, "ai-engineering");
    assert.equal(rag.subcategory, "rag");
    assert.equal(rag.draft, false);
    const dr = corpus.find((c) => c.slug === "draft-post");
    assert.equal(dr.category, "cloud-devops");
    assert.equal(dr.subcategory, "devops");
    assert.equal(dr.draft, true);
  } finally {
    rmSync(tmpSite, { recursive: true, force: true });
  }
}

// 5. Duplicate keyword returns metaErrs separately from bodyErrs (table, skipped heading, banned voice/phrases)
{
  const soloCfg = {
    lang: "en",
    domain: "railsdev.io",
    seoTitleMax: 49,
    descMin: 120,
    descMax: 160,
    servicePrefix: "/services/",
    contactHref: "/#contact",
    conclusionHeading: "Conclusion",
    faqHeading: "Frequently asked questions",
    validBlogPaths: new Set(["/blog/rails-8-guide"]),
    existingKeywords: new Set(["node-js streams"]),
    indonesianGuard: true,
    bannedPatterns: [
      [/\b(our team|our developers|our engineers)\b/i, 'RailsDev is one developer: write "I"'],
    ],
  };

  const multiErrRes = validateAeoGeo(
    {
      title: "Node.js Streams in Production Backends",
      seoTitle: "Node.js Streams Guide",
      description: "Practical guide to Node.js streams in production backends: backpressure, async iteration, error handling, and predictable memory usage.",
      keyword: "Node.js Streams",
      slug: "nodejs-streams-dup-and-body-errs",
      body: makeEnValidBody({
        table: "No table here, just prose.",
        extraBody: "\n#### Skipped from H2 straight to H4\n\nHere our team ships pipelines. Also adalah yang dengan.",
      }),
    },
    soloCfg,
  );
  assert.equal(multiErrRes.ok, false);
  assert.equal(multiErrRes.metaErrs.length, 1);
  assert.match(multiErrRes.metaErrs[0], /duplicate keyword/i);
  assert.ok(multiErrRes.metaErrs.every(isMetaErr));
  assert.ok(multiErrRes.bodyErrs.every((e) => !isMetaErr(e)), `bodyErr matched isMetaErr: ${multiErrRes.bodyErrs.join("; ")}`);
  assert.ok(multiErrRes.bodyErrs.some((e) => /table/i.test(e)));
  assert.ok(multiErrRes.bodyErrs.some((e) => /skipped heading/i.test(e)));
  assert.ok(multiErrRes.bodyErrs.some((e) => /our team/i.test(e)));
  assert.ok(multiErrRes.bodyErrs.some((e) => /Indonesian words/i.test(e)));

  // INASOFT banned phrase: "engineer senior"
  const idBannedRes = validateAeoGeo(
    {
      title: "Arsitektur RAG untuk Aplikasi Perusahaan di Indonesia",
      seoTitle: "Arsitektur RAG untuk Aplikasi Perusahaan",
      description: "Panduan praktis membangun arsitektur RAG yang aman untuk dokumen perusahaan: kontrol akses, evaluasi retrieval, dan integrasi API.",
      keyword: "arsitektur RAG",
      slug: "arsitektur-rag-banned",
      body: makeIdValidBody({
        extraBody: "\nKami menugaskan engineer senior untuk meninjau arsitektur.",
      }),
    },
    {
      lang: "id",
      domain: "inasoft.id",
      seoTitleMax: 50,
      descMin: 100,
      descMax: 160,
      servicePrefix: "/layanan/",
      contactHref: "/#contact",
      conclusionHeading: "Kesimpulan",
      faqHeading: "Pertanyaan yang sering diajukan",
      verificationPattern: /^>\s*catatan verifikasi\b/im,
      validBlogPaths: new Set(["/blog/ai-engineering/rag/rag-adalah"]),
      bannedPatterns: [
        [/engineer senior/i, 'say "tim developer berpengalaman"'],
      ],
    },
  );
  assert.equal(idBannedRes.ok, false);
  assert.ok(idBannedRes.bodyErrs.some((e) => /engineer senior/i.test(e)));
}

// 6. servicePathFor, buildAeoGeoBodyRules, runSitePostCheck
{
  assert.equal(servicePathFor("railsdev", { service: "Custom Module" }), "/services/custom-web-application-development");
  assert.equal(servicePathFor("railsdev", { service: "AI Integration" }), "/services/ai-software-development");
  assert.equal(servicePathFor("fullstackweb", { services: ["ai-engineering", "rag-llm-development"] }), "/services/ai-engineering/");
  assert.equal(servicePathFor("inasoft", { service: "jasa-pembuatan-ai-agent" }), "/layanan/jasa-pembuatan-ai-agent");

  const promptBlock = buildAeoGeoBodyRules({
    siteName: "RailsDev.io",
    lang: "en",
    domain: "railsdev.io",
    voiceRule: 'first person ("I", never "our team")',
    keyword: "node.js streams",
    serviceHref: "/services/ai-software-development",
    contactHref: "/#contact",
    ctaInstruction: "End Conclusion with [book a discovery call](/#contact).",
    validPostLinks: ["/blog/rails-8-guide — Rails 8 Guide"],
    extraRules: ["Keep examples practical."],
  });
  assert.match(promptBlock, /node\.js streams/);
  assert.match(promptBlock, /\/services\/ai-software-development/);
  assert.match(promptBlock, /## Frequently asked questions/);
  assert.match(promptBlock, /Verification note/);
  assert.match(promptBlock, /Keep examples practical/);

  const tmpSite = mkdtempSync(join(tmpdir(), "postcheck-test-"));
  try {
    // Missing check script -> skipped cleanly
    const skipped = runSitePostCheck({ siteDir: tmpSite, relMdPath: "src/content/blog/x.md" });
    assert.equal(skipped.skipped, true);

    // Passing script with relative siteDir (matches GitHub Actions SITE_DIR="../site")
    mkdirSync(join(tmpSite, "scripts"), { recursive: true });
    mkdirSync(join(tmpSite, "src/content/blog"), { recursive: true });
    writeFileSync(join(tmpSite, "src/content/blog/x.md"), "# placeholder\n");
    writeFileSync(
      join(tmpSite, "scripts/check-post.mjs"),
      'import { existsSync } from "node:fs"; if (!existsSync(process.argv[2])) process.exit(2);\n',
    );
    const relSiteDir = relative(process.cwd(), tmpSite) || ".";
    const passedRel = runSitePostCheck({ siteDir: relSiteDir, relMdPath: "src/content/blog/x.md" });
    assert.equal(passedRel.skipped, false);

    // Failing check_post.mjs -> throws descriptive error
    mkdirSync(join(tmpSite, ".claude/skills/write-blog-article/scripts"), { recursive: true });
    writeFileSync(
      join(tmpSite, ".claude/skills/write-blog-article/scripts/check_post.mjs"),
      'console.error("ERROR missing FAQ"); process.exit(1);\n',
    );
    assert.throws(
      () => runSitePostCheck({ siteDir: tmpSite, relMdPath: "src/content/blog/x.md" }),
      /ERROR missing FAQ/,
    );
  } finally {
    rmSync(tmpSite, { recursive: true, force: true });
  }
}

// ---------- ensureRequiredLinks ----------
{
  const { ensureRequiredLinks } = await import("./blog-aeo.mjs");
  const enCfg = {
    lang: "en", domain: "railsdev.io", trailingSlash: false, servicePrefix: "/services/",
    contactHref: "/#contact", conclusionHeading: "Conclusion", faqHeading: "Frequently asked questions",
  };
  const linkCfg = { domain: "railsdev.io", lang: "en", serviceHref: "/services/ai-software-development", contactHref: "/#contact", sourceUrl: "https://github.com/acme/tool", conclusionHeading: "Conclusion" };
  const meta = { title: "A valid article title here", description: "d".repeat(130), slug: "fresh-slug", keyword: "Node.js streams" };

  // Missing all links + untagged fence + absolute self link → fixed in place, closing fence stays bare.
  const bare = makeEnValidBody({ links: "See [an old post](https://railsdev.io/blog/x).", external: "", cta: "Ready to ship?" })
    .replace("```ts", "```");
  const before = validateAeoGeo({ ...meta, body: bare }, enCfg);
  assert.ok(before.errs.some((e) => e.includes("service link")), before.errs.join("; "));
  const fixed = ensureRequiredLinks(bare, linkCfg);
  const after = validateAeoGeo({ ...meta, body: fixed }, enCfg);
  assert.deepEqual(after.errs, [], after.errs.join("; "));
  assert.match(fixed, /^```text$/m);
  assert.match(fixed, /\]\(\/blog\/x\)/);
  assert.doesNotMatch(fixed, /https:\/\/railsdev\.io/);
  const concl = fixed.slice(fixed.indexOf("## Conclusion"));
  for (const href of ["/services/ai-software-development", "/#contact", "https://github.com/acme/tool"]) {
    assert.ok(concl.includes(`](${href})`), `${href} not in Conclusion`);
  }

  // Missing verification note → a fixed, number-free blockquote is added (site language).
  const noNote = makeEnValidBody({ verification: "" });
  assert.ok(validateAeoGeo({ ...meta, body: noNote }, enCfg).errs.includes("missing verification note blockquote"));
  const noteOut = ensureRequiredLinks(noNote, linkCfg);
  assert.deepEqual(validateAeoGeo({ ...meta, body: noteOut }, enCfg).errs, []);
  assert.doesNotMatch(noteOut.match(/^> Verification note:.*$/m)[0], /\d/);
  const idNote = ensureRequiredLinks("Pembuka.\n\n## Kesimpulan\n\nRingkasan.", { lang: "id", conclusionHeading: "Kesimpulan" });
  assert.match(idNote, /^> Catatan verifikasi: /m);

  // Already complete → byte-identical.
  const full = makeEnValidBody();
  assert.equal(ensureRequiredLinks(full, linkCfg), full);

  // No source page fetched → no external link invented.
  assert.doesNotMatch(ensureRequiredLinks(bare, { ...linkCfg, sourceUrl: null }), /github\.com\/acme/);

  // Indonesian: label + language; links go before a section that follows Kesimpulan.
  const idBody = "Pembuka.\n\n## Kesimpulan\n\nRingkasan.\n\n## Lampiran\n\nIsi.";
  const idOut = ensureRequiredLinks(idBody, { domain: "inasoft.id", lang: "id", serviceHref: "/layanan/x", contactHref: "/#contact", contactLabel: "Konsultasi Gratis", sourceUrl: null, conclusionHeading: "Kesimpulan" });
  assert.match(idOut, /\[Konsultasi Gratis\]\(\/#contact\)/);
  assert.ok(idOut.indexOf("/layanan/x") < idOut.indexOf("## Lampiran"));

  // No conclusion heading → appended at the end; closing fences never get a tag;
  // fence handling matches the validator, so its output has no untagged fence left.
  const tilde = "Intro.\n\n~~~\ncode\n~~~\n\n```\nmore\n```\n\nEnd.";
  const tildeOut = ensureRequiredLinks(tilde, { ...linkCfg, sourceUrl: null });
  assert.ok(tildeOut.startsWith("Intro.\n\n~~~text\ncode\n~~~\n\n```text\nmore\n```\n\nEnd."), tildeOut);
  assert.match(tildeOut, /\]\(\/#contact\)\.\n\n> Verification note: /);
  // A lone backtick inside code (template literal end) is not a fence closer, same as the validator.
  const tpl = makeEnValidBody({ extraBody: "```ts\nconst q = gql`\n  query { a }\n`\n```" });
  assert.equal(ensureRequiredLinks(tpl, linkCfg), tpl);
  // Inserted links never glue onto a table/list that ends the Conclusion.
  const tableEnd = "Intro.\n\n## Conclusion\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n## Next\n\nx";
  assert.match(ensureRequiredLinks(tableEnd, { ...linkCfg, sourceUrl: null }), /\| 1 \| 2 \|\n\nSee \[/);
  const nested = makeEnValidBody({ extraBody: "````md\n```\ninner\n```\n````" });
  const nestedV = validateAeoGeo({ ...meta, body: ensureRequiredLinks(nested, linkCfg) }, enCfg);
  assert.ok(!nestedV.errs.some((e) => /fence/.test(e)), nestedV.errs.join("; "));
}

// ---------- generateBody ----------
{
  const { generateBody } = await import("./blog-aeo.mjs");
  const words = (n, w = "word") => Array.from({ length: n }, () => w).join(" ");
  const stub = (replies) => {
    const prompts = [];
    return { prompts, call: async (p) => { prompts.push(p); const r = replies.shift(); if (r instanceof Error) throw r; return r; } };
  };

  // Short draft is expanded, not discarded: the 2nd prompt carries the 1st draft.
  const s1 = stub([words(800, "alpha"), "```markdown\n" + words(1600) + "\n```"]);
  const r1 = await generateBody({ callModel: s1.call, prompt: "PROMPT", minWords: 1500 });
  assert.equal(r1.body, words(1600));
  assert.equal(r1.words, 1600);
  assert.ok(s1.prompts[1].startsWith("PROMPT") && s1.prompts[1].includes(words(800, "alpha")) && /1500/.test(s1.prompts[1]));

  // Always short → null body, longest word count reported; a shorter expansion never replaces a longer draft.
  const s2 = stub([words(800, "a"), words(700, "b"), words(900, "c")]);
  const r2 = await generateBody({ callModel: s2.call, prompt: "P", minWords: 1500 });
  assert.deepEqual(r2, { body: null, words: 900 });
  assert.ok(s2.prompts[2].includes(words(800, "a")), "expands the longest draft so far");

  // A throwing call counts as an attempt.
  const s3 = stub([new Error("429"), words(1600)]);
  assert.equal((await generateBody({ callModel: s3.call, prompt: "P", minWords: 1500 })).words, 1600);
  // Every call failed (provider outage) → throws, so the run fails red instead of a quiet "too short" skip.
  const s4 = stub([new Error("x"), new Error("y"), new Error("z")]);
  await assert.rejects(generateBody({ callModel: s4.call, prompt: "P", minWords: 1500 }), /z/);
  // A draft arrived, later calls threw → still a short result, not an outage.
  const s5 = stub([words(700), new Error("y"), new Error("z")]);
  assert.deepEqual(await generateBody({ callModel: s5.call, prompt: "P", minWords: 1500 }), { body: null, words: 700 });
}

console.log("blog-aeo self-check: ok");
