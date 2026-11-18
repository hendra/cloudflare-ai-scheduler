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
  callModel,
  fetchSourceText = defaultFetch,
}) {
  const { sources, deadSources } = await collectSources(links, fetchSourceText);
  // The signal page is extra material, not a citation: an unfetchable one is dropped silently.
  if (signalUrl) {
    const res = await fetchSourceText(signalUrl);
    if (res && res.ok) sources.push({ url: signalUrl, text: res.text });
  }

  const first = checkGrounding({ body: article.body, sources });
  if (first.ok && deadSources.length === 0) return { ok: true, body: article.body, sources };

  const verdict = (v, body) =>
    v.ok && deadSources.length === 0
      ? { ok: true, body, sources }
      : { ok: false, unverified: v.unverified, deadSources: [...new Set([...deadSources, ...v.deadSources])] };

  const repair = await callModel(repairPrompt({ article, unverified: first.unverified, deadSources, sources }));
  const repairedBody = String(repair || "").trim();
  if (!repairedBody) return verdict(first, article.body);
  const second = checkGrounding({ body: repairedBody, sources });
  return verdict(second, repairedBody);
}
