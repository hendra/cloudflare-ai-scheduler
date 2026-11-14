// Squash-merges a just-opened site PR. Never throws: a failed merge leaves the PR open
// as a usable deliverable, and the caller reports the reason to Slack.
import { execFileSync } from "node:child_process";

export function mergePr(prUrl, { cwd, env }) {
  try {
    execFileSync("gh", ["pr", "merge", prUrl, "--squash", "--delete-branch"], { cwd, env, stdio: "pipe", timeout: 120000 });
    return { merged: true };
  } catch (e) {
    const detail = String(e.stderr || "").trim() || String(e.message || e);
    return { merged: false, error: detail.slice(0, 200) };
  }
}
