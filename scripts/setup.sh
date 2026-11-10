#!/usr/bin/env bash
set -euo pipefail

echo "Cloudflare AI Scheduler - setup helper"
echo
echo "This script creates the required Cloudflare resources and prints the values"
echo "to put in .dev.vars. It does not modify files automatically."
echo

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required. Install Node.js 20+ first." >&2
  exit 1
fi

echo "1) Create D1 database:"
echo "   npx wrangler d1 create scheduler-db"
echo "   -> copy the returned database_id into .dev.vars as D1_DATABASE_ID"
echo "   -> wrangler.jsonc is generated from wrangler.template.jsonc via"
echo "      npm run gen:config (runs automatically before dev/deploy/migrate commands)"
echo

echo "2) Create queues:"
echo "   npx wrangler queues create scheduler-jobs"
echo "   npx wrangler queues create scheduler-jobs-dlq"
echo

echo "3) Apply migrations (local):"
echo "   npm run db:migrate:local"
echo


echo "4) Set secrets (optional, for manual run / GitHub triggers):"
echo "   npx wrangler secret put MANUAL_RUN_TOKEN"
echo "   npx wrangler secret put GITHUB_PAT"
echo

echo "5) Configure vars in wrangler.template.jsonc (vars section) as needed."
echo "   DEFAULT_AI_MODEL, MAX_AI_RUNS_PER_DAY, etc."
echo

echo "6) Typecheck and deploy:"
echo "   npm run typecheck && npm run deploy"
