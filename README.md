# Cloudflare AI Scheduler

A dashboard-free, TypeScript scheduler platform for up to 10 initial mixed-frequency jobs. It uses Cloudflare Workers, Cron Triggers, D1, Queues and Workers AI. It does not use Ollama or an external AI inference provider.

## Important scope and limitations

- This starter dispatches due jobs every minute using one Cron Trigger.
- Job definitions live in D1, so adding jobs does not require another Cron Trigger.
- `rss_ai_digest` fetches public RSS feeds and asks Workers AI to summarize the returned feed material.
- `http_check` checks configured URLs without using AI.
- `ai_prompt` processes the configured prompt and input JSON. It does not have a general web-search capability.
- Workers AI is inference, not a search engine. For current research, supply RSS feeds, public API data, or source material. Do not expect the model to browse the web by itself.
- GitHub and Slack integrations are not included in this first runnable starter. They can be added later using their APIs and securely stored credentials; they are not AI providers.
- The model selector starts with a lightweight model. The starter records model name and character counts, not actual Neurons. Check actual Neuron consumption in the Cloudflare dashboard.
- The seeded jobs are disabled and contain example placeholders. Review prompts and inputs before enabling them.
- This starter intentionally does not auto-publish content, merge PRs, or send Slack messages. Add explicit destination configuration and validation before enabling side effects.

## Architecture

`Cron Trigger (every minute) -> Worker dispatcher -> D1 due-job lookup -> Cloudflare Queue -> Queue consumer -> Workers AI / RSS / HTTP check -> D1 execution history`

The Queue consumer is configured for small batches and retries. Failed messages go to a dead-letter queue.

## Prerequisites

- Cloudflare account with Workers, D1, Queues and Workers AI enabled.
- Node.js 20 or newer.
- Wrangler CLI (installed through npm in this project).

Workers AI Free currently includes 10,000 Neurons/day. If the daily free allocation is exceeded, further inference calls fail on Workers Free. Model availability and eligibility can change; verify the selected model in the current model catalog before deployment.

## Setup

### 1. Install dependencies

```bash
npm install
npx wrangler login
```

### 2. Create D1 database

```bash
npx wrangler d1 create scheduler-db
```

Copy the returned `database_id` into `wrangler.jsonc`.

### 3. Create queues

```bash
npx wrangler queues create scheduler-jobs
npx wrangler queues create scheduler-jobs-dlq
```

### 4. Apply migrations

```bash
npm run db:migrate:local
npm run db:seed:local
```

For production:

```bash
npm run db:migrate:remote
npm run db:seed:remote
```

The seed jobs are disabled. The `next_run_at` values are placeholders far in the future. The included seed file is a template; update the schedule and next-run timestamp for each job before enabling it.

### 5. Configure model

The default model is set in `wrangler.jsonc`:

```json
"DEFAULT_AI_MODEL": "@cf/google/gemma-4-26b-a4b-it"
```

This is the lightweight default. The model catalog can change. Confirm that this exact model is currently available to your account. If it is unavailable, replace it with a currently available, free-eligible text-generation model. Do not select models marked as requiring a paid billing method.

The automatic strategy is budget-first: operational tasks use `DEFAULT_AI_MODEL`; tasks whose names indicate article/research/engineering/SEO/report/digest use `QUALITY_AI_MODEL` only if you configure one. It defaults to an empty value, so all tasks use the lightweight default and preserve the free quota. Per-job overrides can be supplied in `input_json` as `"model": "@cf/..."`; only do this after verifying that model's availability and price eligibility.

### 6. Test locally

```bash
npm run dev
```

In another terminal, test:

```bash
curl http://localhost:8787/health
curl http://localhost:8787/api/schedulers
curl http://localhost:8787/api/executions
curl http://localhost:8787/api/usage
```

Run migrations and seed locally before testing. For a quick manual dispatch test, temporarily set one scheduler's `next_run_at` to a past UTC timestamp and enable it. Use Wrangler's scheduled-event testing support or wait for the next minute tick.

### 7. Deploy

```bash
npm run typecheck
npm run deploy
```

After deployment, check:

```bash
curl https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/health
```

## Managing jobs without a dashboard

Use D1 SQL through Wrangler. Example:

Enable a scheduler:

```bash
npx wrangler d1 execute scheduler-db --remote --command \
"UPDATE schedulers SET enabled = 1, next_run_at = '2026-11-10T01:00:00.000Z' WHERE id = 'rails-trends'"
```

Disable a scheduler:

```bash
npx wrangler d1 execute scheduler-db --remote --command \
"UPDATE schedulers SET enabled = 0 WHERE id = 'rails-trends'"
```

Inspect scheduler definitions:

```bash
npx wrangler d1 execute scheduler-db --remote --command \
"SELECT id, name, enabled, cron_expression, timezone, next_run_at FROM schedulers ORDER BY priority"
```

Inspect recent executions:

```bash
npx wrangler d1 execute scheduler-db --remote --command \
"SELECT scheduler_id, scheduled_for, status, model, error_text FROM scheduler_executions ORDER BY created_at DESC LIMIT 50"
```

Inspect daily usage counters:

```bash
npx wrangler d1 execute scheduler-db --remote --command \
"SELECT * FROM daily_usage ORDER BY usage_date DESC LIMIT 14"
```

## Manual API endpoints

All manual endpoints require `Authorization: Bearer $MANUAL_RUN_TOKEN`.

Queue a single scheduler:

```bash
curl -X POST "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/run" \\
  -H "Authorization: Bearer YOUR_MANUAL_RUN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"schedulerId":"rails-trends"}'
```

Queue every enabled scheduler:

```bash
curl -X POST "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/run-all" \\
  -H "Authorization: Bearer YOUR_MANUAL_RUN_TOKEN"
```

Retrieve execution details:

```bash
curl -X GET "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/executions/EXECUTION_ID" \\
  -H "Authorization: Bearer YOUR_MANUAL_RUN_TOKEN"
```

`POST /api/run-all` returns `202 Accepted` when at least one scheduler is queued, `200 OK` when there are no enabled schedulers, and `500` if all queue submissions fail. `GET /api/executions/:id` returns `404 Not Found` for unknown execution IDs.

## Scheduling and timezone notes

Cron expressions use five fields: minute, hour, day-of-month, month, day-of-week. The scheduler stores `next_run_at` in UTC. The current starter includes a small cron parser. It evaluates cron matches in UTC; convert each desired local schedule to UTC before storing the expression. The `timezone` column is retained for configuration/documentation but is not yet used for timezone conversion by the parser. The example seed expressions are converted from Asia/Jakarta to UTC.

For Asia/Jakarta (UTC+7), examples:
- 07:50 WIB -> `50 0 * * *` UTC
- 11:50 WIB -> `50 4 * * *` UTC
- 16:50 WIB -> `50 9 * * *` UTC

Do not use a local-time cron expression directly unless you add timezone-aware conversion.

## Free-tier budgeting

- Workers Free: 100,000 requests/day; 5 Cron Triggers/account; 10 ms CPU per invocation.
- Workers AI: 10,000 Neurons/day free allocation. Inference calls fail after the daily free allocation is exhausted on Workers Free.
- Queue and D1 quotas are separate. Check the current Cloudflare pricing/limits pages before production use.
- A single every-minute dispatcher is 1,440 Cron invocations/day. This is below the documented 100,000 Workers request allowance, but cron CPU time is constrained to 10 ms on Free.
- Do not run 10 heavy AI jobs simultaneously. Keep batches small and stagger the schedules.
- `MAX_AI_RUNS_PER_DAY` is an application-level cap on attempted AI inferences, reserved before calling the model. It is not a direct Neuron meter; one inference may consume very different Neurons from another. The default is 30 attempts/day.

## Security

- Do not expose management endpoints publicly. The included endpoints are read-only, but still consider protecting them with Cloudflare Access.
- Store secrets with `wrangler secret put SECRET_NAME`; never commit API tokens.
- Validate and constrain all feed URLs and configured destinations before production.
- Treat RSS and external source text as untrusted input.
- Do not automatically execute code generated by the model.
- Keep article publication, PR creation, auto-merge and Slack notification as separate explicit integrations with their own safeguards.

## Known starter limitations to address before production

1. The basic cron parser evaluates UTC only. It does not implement full timezone/DST semantics.
2. The starter seeds are examples and disabled. Replace placeholder URLs, inputs and prompts.
3. The lightweight model name is configurable; verify current availability and free eligibility.
4. Character counts are not Neuron counts. Monitor Neurons in Cloudflare.
5. The scheduler uses D1 uniqueness to reduce duplicate dispatches, but queue delivery is at-least-once. Make every job handler idempotent before adding side effects.
6. `MAX_AI_RUNS_PER_DAY` is reserved for a future quota guard. Add a hard reservation counter before enabling high-volume AI tasks.
7. The sample dispatcher advances due schedules after queue send. For stronger transactional guarantees, use an outbox table and a reconciliation cron.
8. The queue dead-letter queue needs manual inspection and replay procedures.

## Official documentation

- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Workers AI models: https://developers.cloudflare.com/workers-ai/models/
- Queues limits: https://developers.cloudflare.com/queues/platform/limits/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/

