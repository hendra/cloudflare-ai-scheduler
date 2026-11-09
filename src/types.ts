export interface Env {
  DB: D1Database;
  AI: Ai;
  JOB_QUEUE: Queue<JobMessage>;
  DEFAULT_TIMEZONE: string;
  DEFAULT_AI_MODEL: string;
  MAX_AI_RUNS_PER_DAY: string;
  MAX_JOBS_PER_DISPATCH: string;
  AI_OUTPUT_TOKEN_LIMIT: string;
}

export interface SchedulerRow {
  id: string;
  name: string;
  description: string | null;
  enabled: number;
  job_type: string;
  cron_expression: string;
  timezone: string;
  prompt: string;
  input_json: string;
  model_preference: string;
  priority: number;
  max_retries: number;
  next_run_at: string;
}

export interface JobMessage {
  executionId: string;
  schedulerId: string;
  scheduledFor: string;
  attempt: number;
}

export interface AiTextResponse {
  response?: string;
  [key: string]: unknown;
}
