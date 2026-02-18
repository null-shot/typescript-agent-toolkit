/**
 * Cron Expression Matcher
 *
 * Simple 5-field cron parser and matcher for Cloudflare Workers.
 * Fields: minute hour day-of-month month day-of-week
 *
 * Supported syntax per field:
 *   *       — any value
 *   N       — exact value (e.g. 10)
 *   N,M     — list (e.g. 1,4)
 *   N-M     — range (e.g. 1-5)
 *   *\/N     — every N (e.g. *\/6 = every 6)
 *   N-M/S   — range with step
 *
 * Day of week: 0 = Sunday, 6 = Saturday
 */

export interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

/**
 * Parse a single cron field into an array of matching values.
 */
function parseField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const trimmed = part.trim();

    if (trimmed.includes("/")) {
      // Step: */N or N-M/S
      const [range, stepStr] = trimmed.split("/");
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step: ${trimmed}`);
      }

      let start = min;
      let end = max;

      if (range !== "*") {
        if (range.includes("-")) {
          const [a, b] = range.split("-").map(Number);
          start = a;
          end = b;
        } else {
          start = parseInt(range, 10);
        }
      }

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else if (trimmed === "*") {
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
    } else if (trimmed.includes("-")) {
      const [a, b] = trimmed.split("-").map(Number);
      for (let i = a; i <= b; i++) {
        values.add(i);
      }
    } else {
      const val = parseInt(trimmed, 10);
      if (isNaN(val)) {
        throw new Error(`Invalid cron value: ${trimmed}`);
      }
      values.add(val);
    }
  }

  return Array.from(values);
}

/**
 * Parse a 5-field cron expression into structured fields.
 */
export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expression}": expected 5 fields, got ${parts.length}`,
    );
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

/**
 * Get the current time components in a given timezone (or UTC if none).
 */
function getNow(timezone?: string): {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
} {
  const date = new Date();

  if (!timezone) {
    return {
      minute: date.getUTCMinutes(),
      hour: date.getUTCHours(),
      dayOfMonth: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      dayOfWeek: date.getUTCDay(),
    };
  }

  // Use Intl to get time in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value || "0";

  // Map weekday name to number (0=Sun, 6=Sat)
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    minute: parseInt(get("minute"), 10),
    hour: parseInt(get("hour"), 10),
    dayOfMonth: parseInt(get("day"), 10),
    month: parseInt(get("month"), 10),
    dayOfWeek: weekdayMap[get("weekday")] ?? date.getUTCDay(),
  };
}

/**
 * Check if the current minute matches a cron expression.
 *
 * @param expression - 5-field cron (e.g. "0 10 * * 1,4")
 * @param timezone   - IANA timezone (e.g. "Europe/Moscow"). Defaults to UTC.
 * @returns true if the current minute matches the cron pattern
 */
export function cronMatchesNow(expression: string, timezone?: string): boolean {
  const fields = parseCron(expression);
  const now = getNow(timezone);

  return (
    fields.minute.includes(now.minute) &&
    fields.hour.includes(now.hour) &&
    fields.dayOfMonth.includes(now.dayOfMonth) &&
    fields.month.includes(now.month) &&
    fields.dayOfWeek.includes(now.dayOfWeek)
  );
}

/**
 * Check if enough time has passed since lastRunAt to avoid
 * double-execution within the same cron window (1 minute).
 *
 * @param lastRunAt - ISO timestamp of last execution
 * @returns true if safe to run (>= 60s since last run)
 */
export function shouldRunAgain(lastRunAt?: string): boolean {
  if (!lastRunAt) return true;
  const elapsed = Date.now() - new Date(lastRunAt).getTime();
  return elapsed >= 55_000; // 55s guard — cron fires every 60s
}
