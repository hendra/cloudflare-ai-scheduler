// Minimal 5-field UTC cron parser.
// Supports: `*`, numbers, ranges `a-b`, lists `a,b`, steps `*/n` and `a-b/n` and `a/n`,
// month names JAN-DEC and day names SUN-SAT (case-insensitive), and day-of-week 7 = Sunday.
// Non-standard DOM/DOW semantics (documented in AGENTS.md): if either DOM or DOW is
// the literal `*`, both must match; otherwise a date matches if DOM OR DOW matches.

const MONTHS = new Map<string, number>([
  ["JAN", 1], ["FEB", 2], ["MAR", 3], ["APR", 4], ["MAY", 5], ["JUN", 6],
  ["JUL", 7], ["AUG", 8], ["SEP", 9], ["OCT", 10], ["NOV", 11], ["DEC", 12]
]);
const DAYS = new Map<string, number>([
  ["SUN", 0], ["MON", 1], ["TUE", 2], ["WED", 3],
  ["THU", 4], ["FRI", 5], ["SAT", 6]
]);

function parsePart(part: string, min: number, max: number, names?: Map<string, number>): Set<number> {
  const values = new Set<number>();
  const normalize = (value: string, segment: string): number => {
    const upper = value.toUpperCase();
    if (names?.has(upper)) return names.get(upper)!;
    if (!/^\d+$/.test(value)) throw new Error(`Invalid cron field: ${segment}`);
    return Number(value);
  };

  for (const segment of part.split(",")) {
    const pieces = segment.split("/");
    if (pieces.length > 2) throw new Error(`Invalid cron step: ${segment}`);
    const [rangePart, stepPart] = pieces;
    if (stepPart !== undefined && !/^\d+$/.test(stepPart)) throw new Error(`Invalid cron step: ${segment}`);
    const step = stepPart !== undefined ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step: ${segment}`);

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const bounds = rangePart.split("-");
      if (bounds.length !== 2) throw new Error(`Invalid cron field: ${segment}`);
      start = normalize(bounds[0], segment);
      end = normalize(bounds[1], segment);
    } else {
      start = normalize(rangePart, segment);
      end = stepPart !== undefined ? max : start;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`Invalid cron field: ${segment}`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

function parseDayOfWeek(part: string): Set<number> {
  // Accept 0-7; 7 is an alias for Sunday (0), including inside ranges/steps like `1-7`.
  const raw = parsePart(part, 0, 7, DAYS);
  const values = new Set<number>();
  for (const v of raw) values.add(v === 7 ? 0 : v);
  return values;
}

export function matchesCron(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Cron expression must have exactly five fields.");
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  const m = parsePart(minute, 0, 59);
  const h = parsePart(hour, 0, 23);
  const dom = parsePart(dayOfMonth, 1, 31);
  const mon = parsePart(month, 1, 12, MONTHS);
  const dow = parseDayOfWeek(dayOfWeek);
  const weekday = date.getUTCDay();

  const dayMatch = dayOfMonth === "*" || dayOfWeek === "*"
    ? (dom.has(date.getUTCDate()) && dow.has(weekday))
    : (dom.has(date.getUTCDate()) || dow.has(weekday));

  return m.has(date.getUTCMinutes()) &&
    h.has(date.getUTCHours()) &&
    mon.has(date.getUTCMonth() + 1) &&
    dayMatch;
}

export function nextCronOccurrence(expression: string, after: Date): Date {
  // Validate once up front so an invalid expression fails fast instead of per-minute.
  matchesCron(expression, after);

  const candidate = new Date(after);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  // Search up to one year ahead. This avoids a heavyweight cron dependency.
  for (let i = 0; i < 527040; i++) {
    if (matchesCron(expression, candidate)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error(`Could not find next occurrence for cron expression: ${expression}`);
}
