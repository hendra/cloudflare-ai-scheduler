// Blog-side grounding gate: fetch every cited page, check the body against them, and give
// the model one repair call that carries the source texts so it can substitute real figures.
// A run that cannot be grounded returns ok:false; the caller skips the article (exit 0).
import { checkGrounding, fetchSourceText as defaultFetch } from "./grounding.mjs";

const REPAIR_SOURCE_CAP = 6000;

export async function collectSources(links, fetcher = defaultFetch) {
  const sources = [];
  const deadSources = [];
  for (const url of links || []) {
    const res = await fetcher(url);
    if (res && res.ok) sources.push({ url, text: res.text });
    else deadSources.push(url);
  }
  return { sources, deadSources };
}

function repairPrompt({ article, unverified, deadSources, sources }) {
  const sourceBlock = sources
    .map((s) => `### ${s.url}\n${s.text.slice(0, REPAIR_SOURCE_CAP)}`)
    .join("\n\n");
  return `Your article body below states facts that are not supported by its cited sources.

Unsupported numbers: ${unverified.join(", ") || "(none)"}
Unreadable citations: ${deadSources.join(", ") || "(none)"}

Rewrite the body so every number is either the value a source below actually states, or removed.
Do not add new numbers. Do not drop required sections. Return ONLY the corrected markdown body.

Sources:
${sourceBlock}

Current body:
${article.body}`;
}

export async function groundArticle({
  article,
  links = [],
  signalUrl = null,
  signalText = "",   // already fetched for the prompt; reused instead of a second round trip
  callModel,
  fetchSourceText = defaultFetch,
}) {
  const { sources, deadSources } = await collectSources(links, fetchSourceText);
  // The signal page is extra material, not a citation: an unfetchable one is dropped silently.
  if (signalText) {
    sources.push({ url: signalUrl || "signal", text: signalText });
  } else if (signalUrl) {
    const res = await fetchSourceText(signalUrl);
    if (res && res.ok) sources.push({ url: signalUrl, text: res.text });
  }

  const first = checkGrounding({ body: article.body, sources });
  if (first.ok && deadSources.length === 0) return { ok: true, body: article.body, sources };

  const verdict = (v, body, srcs = sources, dead = deadSources) =>
    v.ok && dead.length === 0
      ? { ok: true, body, sources: srcs }
      : { ok: false, unverified: v.unverified, deadSources: [...new Set([...dead, ...v.deadSources])] };

  // A provider failure here must not crash the run: the article is simply ungrounded → skip.
  let repair = "";
  try {
    repair = await callModel(repairPrompt({ article, unverified: first.unverified, deadSources, sources }));
  } catch (e) {
    console.error("grounding repair call failed:", e.message);
  }
  const repairedBody = String(repair || "").trim();
  if (!repairedBody) return verdict(first, article.body);

  // The repair may cite new pages: fetch them, or a dead link ships past the gate.
  const cited = [...repairedBody.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
  const known = new Set(sources.map((s) => s.url));
  const { sources: extra, deadSources: extraDead } = await collectSources(
    cited.filter((u) => !known.has(u)),
    fetchSourceText,
  );
  const allSources = [...sources, ...extra];
  const allDead = [...new Set([...deadSources, ...extraDead])];
  const second = checkGrounding({ body: repairedBody, sources: allSources });
  return verdict(second, repairedBody, allSources, allDead);
}
