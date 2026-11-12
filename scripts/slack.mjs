// Shared Slack helpers for the pipeline scripts (zero dependencies, Node 20).
//
// API (keep it small — other scripts import it):
//   safeMrkdwn(s)                 Escape text we don't control (AI output, scraped
//                                 titles, README-derived prose) for Slack mrkdwn:
//                                 & → &amp;, < → &lt;, > → &gt;. Prevents `<!channel>`,
//                                 `<@U…>` mentions and spoofed `<url|label>` links.
//   slackLink(url, label)         Build a safe `<url|label>` link. Label is escaped and
//                                 `|` is replaced (it would end the URL part early);
//                                 the URL must be http(s) and gets `<>|` and whitespace
//                                 percent-encoded. Non-http(s) URLs → plain escaped label.
//   splitForSlack(text, limit)    Lossless split into ≤ limit-char parts, preferring
//                                 line boundaries; lines longer than limit are hard-split.
//                                 parts.join("") === text.
//   postSlack({token, channel, text})
//                                 chat.postMessage. Never throws; resolves to
//                                 { ok: true, ts } or { ok: false, error }.
//   postSlackParts({token, channel, parts})
//                                 Posts parts in order, stops at the first failure.
//                                 Resolves to { ok, posted, error } where `posted` is the
//                                 number of parts Slack accepted (for partial-post notes).

export function safeMrkdwn(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();
}

export function slackLink(url, label) {
  const safeLabel = safeMrkdwn(label).replace(/\|/g, "¦") || "link";
  const u = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return safeLabel;
  const safeUrl = u.replace(/[<>|\s]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
  return `<${safeUrl}|${safeLabel}>`;
}

export function splitForSlack(text, limit = 3400) {
  const s = String(text ?? "");
  if (s.length <= limit) return [s];
  const parts = [];
  let cur = "";
  // Keep the newline attached to each line so concatenation is lossless.
  for (const line of s.match(/[^\n]*\n|[^\n]+$/g) || []) {
    if (cur.length + line.length <= limit) { cur += line; continue; }
    if (cur) { parts.push(cur); cur = ""; }
    let rest = line;
    while (rest.length > limit) { parts.push(rest.slice(0, limit)); rest = rest.slice(limit); }
    cur = rest;
  }
  if (cur) parts.push(cur);
  return parts;
}

export async function postSlack({ token, channel, text }) {
  if (!token || !channel) return { ok: false, error: "missing Slack token or channel" };
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({}));
    return body.ok ? { ok: true, ts: body.ts } : { ok: false, error: String(body.error || `HTTP ${res.status}`) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}

export async function postSlackParts({ token, channel, parts }) {
  let posted = 0;
  for (const text of parts) {
    const r = await postSlack({ token, channel, text });
    if (!r.ok) return { ok: false, posted, error: r.error };
    posted++;
  }
  return { ok: true, posted, error: "" };
}
