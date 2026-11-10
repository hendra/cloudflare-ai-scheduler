#!/usr/bin/env node
// Generates wrangler.jsonc from wrangler.template.jsonc.
//
// Wrangler does NOT support variable substitution in config files, so the D1
// database_id (read from .dev.vars as D1_DATABASE_ID) is injected here instead.
// wrangler.jsonc is gitignored; wrangler.template.jsonc is the committed source.
//
// If D1_DATABASE_ID is missing, a placeholder is written and a warning is
// printed: local dev (local D1) works either way, but --remote commands will
// fail until the real id is set in .dev.vars.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = join(root, "wrangler.template.jsonc");
const OUTPUT = join(root, "wrangler.jsonc");
const DEV_VARS = join(root, ".dev.vars");

function parseDevVars(text) {
  const vars = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) vars[key] = value;
  }
  return vars;
}

let vars = {};
try {
  vars = parseDevVars(readFileSync(DEV_VARS, "utf8"));
} catch {
  console.warn(`warning: ${DEV_VARS} not found or unreadable; continuing with placeholder database_id`);
}

const id = (vars.D1_DATABASE_ID || "").trim();
if (!id) {
  console.warn(
    "warning: D1_DATABASE_ID is not set in .dev.vars; writing the placeholder.\n" +
      "         Local development works, but --remote commands need the real id (wrangler d1 list, or wrangler d1 create)."
  );
}

const template = readFileSync(TEMPLATE, "utf8");
if (!template.includes("__D1_DATABASE_ID__")) {
  console.error(`error: ${TEMPLATE} does not contain the __D1_DATABASE_ID__ placeholder`);
  process.exit(1);
}

writeFileSync(OUTPUT, template.replaceAll("__D1_DATABASE_ID__", id || "REPLACE_WITH_YOUR_D1_DATABASE_ID"));
console.log(`wrote ${OUTPUT}${id ? "" : " (placeholder database_id)"}`);
