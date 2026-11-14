// Squash-merges a just-opened site PR. Never throws: a failed merge leaves the PR open
// as a usable deliverable, and the caller reports the reason to Slack.
//
// gh runs from tmpdir, not the site checkout: inside a checkout `--delete-branch` also
// switches/pulls/deletes the local branch, and a failure there exits non-zero after the
// merge already succeeded. The URL alone identifies the repo. On any error (including
// the timeout firing after GitHub merged), the PR's real state decides the result.
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

export function mergePr(prUrl, { env }) {
  const gh = (args, timeout) => execFileSync("gh", args, { cwd: tmpdir(), env, stdio: "pipe", timeout }).toString().trim();
  try {
    gh(["pr", "merge", prUrl, "--squash", "--delete-branch"], 120000);
    return { merged: true };
  } catch (e) {
    try { if (gh(["pr", "view", prUrl, "--json", "state", "-q", ".state"], 30000) === "MERGED") return { merged: true }; } catch {}
    const detail = String(e.stderr || "").trim() || String(e.message || e);
    return { merged: false, error: detail.slice(0, 200) };
  }
}
