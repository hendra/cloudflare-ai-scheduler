// Blog-side grounding gate: fetch every cited page, check the body against them, and give
// the model one repair call that carries the source texts so it can substitute real figures.
// A run that cannot be grounded returns ok:false; the caller skips the article (exit 0).
import { checkGrounding, fetchSourceText as defaultFetch, isCitationUrl } from "./grounding.mjs";

const REPAIR_SOURCE_CAP = 6000;

// Non-citations (container names, nginx variables, localhost) are examples, not sources:
// fetching them always fails, and a failed fetch used to discard a grounded article.
const citationsOnly = (links) => (links || []).filter((u) => isCitationUrl(u));

// A citation the server refused (401/403/429/5xx) or served as something unreadable is not a
// bad citation: it is a source this run could not read. Only a 404/410 or a network failure
// means the URL itself is wrong.
const DEAD_REASONS = new Set(["status", "network"]);

export async function collectSources(links, fetcher = defaultFetch) {
  const sources = [];
  const deadSources = [];
  const unreadable = [];
  for (const url of citationsOnly(links)) {
    const res = await fetcher(url);
    if (res && res.ok) sources.push({ url, text: res.text });
    else if (DEAD_REASONS.has(res?.reason)) deadSources.push(url);
    else unreadable.push(url);
  }
  return { sources, deadSources, unreadable };
}

function repairPrompt({ article, unverified, deadSources, unreadable, sources }) {
  const sourceBlock = sources
    .map((s) => `### ${s.url}\n${s.text.slice(0, REPAIR_SOURCE_CAP)}`)
    .join("\n\n");
  return `Your article body below states facts that are not supported by its cited sources.

Unsupported numbers: ${unverified.join(", ") || "(none)"}
Citations that could not be fetched: ${deadSources.join(", ") || "(none)"}
Citations that could not be read: ${unreadable.join(", ") || "(none)"}

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
  const { sources, deadSources, unreadable } = await collectSources(links, fetchSourceText);
  // The signal page is extra material, not a citation: an unfetchable one is dropped silently.
  if (signalText) {
    sources.push({ url: signalUrl || "signal", text: signalText });
  } else if (signalUrl) {
    const res = await fetchSourceText(signalUrl);
    if (res && res.ok) sources.push({ url: signalUrl, text: res.text });
    // A signal page this run could not read is why nothing was verified: say so, or the
    // skip note reports an empty list and the failure looks like a bug.
    else unreadable.push(signalUrl);
  }

  // "Nothing was verified" is a failure too: an article whose only citation could not be read
  // must not publish just because its prose happens to hold no risky number.
  const citedSomething = citationsOnly(links).length > 0 || Boolean(signalUrl);
  const grounded = (v, srcs, dead) => v.ok && dead.length === 0 && (!citedSomething || srcs.length > 0);

  const first = checkGrounding({ body: article.body, sources });
  if (grounded(first, sources, deadSources)) {
    return { ok: true, body: article.body, sources, unreadable };
  }

  const verdict = (v, body, srcs = sources, dead = deadSources, unread = unreadable) =>
    grounded(v, srcs, dead)
      ? { ok: true, body, sources: srcs, unreadable: unread }
      : {
        ok: false,
        unverified: v.unverified,
        deadSources: [...new Set([...dead, ...v.deadSources])],
        unreadable: [...new Set(unread)],
      };

  // A provider failure here must not crash the run: the article is simply ungrounded → skip.
  let repair = "";
  try {
    repair = await callModel(repairPrompt({ article, unverified: first.unverified, deadSources, unreadable, sources }));
  } catch (e) {
    console.error("grounding repair call failed:", e.message);
  }
  const repairedBody = String(repair || "").trim();
  if (!repairedBody) return verdict(first, article.body);

  // The repair may cite new pages (http or https): fetch them, or a dead link ships past the
  // gate. A citation the repair removed is no longer dead, so it stops blocking.
  // Markdown links and bare URLs both count as citations, so neither can slip past unread.
  const cited = [
    ...[...repairedBody.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]),
    ...[...repairedBody.matchAll(/(?<![("\[])(https?:\/\/[^\s>)\]]+)/g)].map((m) => m[1].replace(/[.,;:!?]+$/, "")),
  ];
  const known = new Set(sources.map((s) => s.url));
  const { sources: extra, deadSources: extraDead, unreadable: extraUnreadable } = await collectSources(
    cited.filter((u) => !known.has(u)),
    fetchSourceText,
  );
  const citedSet = new Set(cited);
  const allSources = [...sources, ...extra];
  const allDead = [
    ...new Set([
      ...deadSources.filter((u) => citedSet.has(u)),
      ...extraDead.filter((u) => citedSet.has(u)),
    ]),
  ];
  const allUnreadable = [
    ...new Set([
      ...unreadable.filter((u) => citedSet.has(u)),
      ...extraUnreadable.filter((u) => citedSet.has(u)),
    ]),
  ];
  const second = checkGrounding({ body: repairedBody, sources: allSources });
  return verdict(second, repairedBody, allSources, allDead, allUnreadable);
}
