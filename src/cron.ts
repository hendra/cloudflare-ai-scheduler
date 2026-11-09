const MONTHS = new Map<string, number>();
const DAYS = new Map<string, number>([
  ["SUN", 0], ["MON", 1], ["TUE", 2], ["WED", 3],
  ["THU", 4], ["FRI", 5], ["SAT", 6]
]);

function parsePart(part: string, min: number, max: number, names?: Map<string, number>): Set<number> {
  const values = new Set<number>();
  const normalize = (value: string) => {
    const upper = value.toUpperCase();
    return names?.has(upper) ? names.get(upper)! : Number(value);
  };

  for (const segment of part.split(",")) {
    const [rangePart, stepPart] = segment.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step: ${segment}`);

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      start = normalize(a);
      end = normalize(b);
    } else {
      start = normalize(rangePart);
      end = stepPart ? max : start;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`Invalid cron field: ${segment}`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
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
  const dow = parsePart(dayOfWeek, 0, 7, DAYS);
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
