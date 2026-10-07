// ============================================================================
// KIN CALENDAR CRON PARSER & NEXT OCCURRENCE CALCULATOR
// Exact calendar-time scheduling for 5-part cron expressions:
// minute hour day-of-month month day-of-week
// ============================================================================

export interface CronValidationResult {
  valid: boolean;
  error?: string;
}

export interface ParsedCronField {
  allowedValues: Set<number>;
  isWildcard: boolean;
}

export interface ParsedCronExpression {
  minute: ParsedCronField;
  hour: ParsedCronField;
  dom: ParsedCronField;
  month: ParsedCronField;
  dow: ParsedCronField;
}

/**
 * Validates a standard 5-part cron expression.
 */
export function validateCronExpression(expression: string): CronValidationResult {
  if (!expression || typeof expression !== 'string') {
    return { valid: false, error: 'Cron expression must be a non-empty string' };
  }

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      valid: false,
      error: `Expected 5 fields (minute hour day-of-month month day-of-week), but received ${parts.length}`,
    };
  }

  const fieldDefs: Array<{ name: string; min: number; max: number; isDow?: boolean }> = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'day-of-month', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12 },
    { name: 'day-of-week', min: 0, max: 7, isDow: true },
  ];

  for (let i = 0; i < 5; i++) {
    const part = parts[i];
    const def = fieldDefs[i];
    try {
      parseField(part, def.min, def.max, def.isDow);
    } catch (err: any) {
      return {
        valid: false,
        error: `Field '${def.name}' ('${part}') is invalid: ${err.message}`,
      };
    }
  }

  return { valid: true };
}

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const DOW_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

/**
 * Parses a single cron field into allowed numerical values.
 */
function parseField(
  fieldStr: string,
  min: number,
  max: number,
  isDow: boolean = false
): ParsedCronField {
  const allowed = new Set<number>();
  const isWildcard = fieldStr === '*';

  // Normalize named day or month tokens to numbers (case-insensitive)
  let normalizedField = fieldStr;
  if (isDow) {
    for (const [name, val] of Object.entries(DOW_NAMES)) {
      normalizedField = normalizedField.replace(new RegExp(`\\b${name}\\b`, 'gi'), String(val));
    }
  } else if (min === 1 && max === 12) {
    for (const [name, val] of Object.entries(MONTH_NAMES)) {
      normalizedField = normalizedField.replace(new RegExp(`\\b${name}\\b`, 'gi'), String(val));
    }
  }

  const segments = normalizedField.split(',');
  if (segments.length === 0) {
    throw new Error('Field cannot be empty');
  }

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) {
      throw new Error('Empty segment in list');
    }

    if (trimmed === '*') {
      for (let v = min; v <= (isDow ? 6 : max); v++) {
        allowed.add(v);
      }
      continue;
    }

    // Step expression: */step, range/step, or start/step (e.g. 0/15)
    const stepMatch = trimmed.match(/^(\*|\d+-\d+|\d+)\/(\d+)$/);
    if (stepMatch) {
      const baseRange = stepMatch[1];
      const step = parseInt(stepMatch[2], 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Step must be positive integer: '${trimmed}'`);
      }

      let start = min;
      let end = isDow ? 6 : max;
      if (baseRange !== '*') {
        if (baseRange.includes('-')) {
          const [rStart, rEnd] = baseRange.split('-').map((n) => parseInt(n, 10));
          start = rStart;
          end = rEnd;
        } else {
          start = parseInt(baseRange, 10);
          end = isDow ? 6 : max;
        }
      }

      if (start < min || end > max || start > end) {
        throw new Error(`Range '${baseRange}' out of bounds [${min}, ${max}]`);
      }

      for (let v = start; v <= end; v += step) {
        const normalized = isDow && v === 7 ? 0 : v;
        allowed.add(normalized);
      }
      continue;
    }

    // Range expression: start-end
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
        throw new Error(`Range '${trimmed}' out of bounds [${min}, ${max}]`);
      }
      for (let v = start; v <= end; v++) {
        const normalized = isDow && v === 7 ? 0 : v;
        allowed.add(normalized);
      }
      continue;
    }

    // Exact number
    if (/^\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      if (num < min || num > max) {
        throw new Error(`Value '${num}' out of bounds [${min}, ${max}]`);
      }
      const normalized = isDow && num === 7 ? 0 : num;
      allowed.add(normalized);
      continue;
    }

    throw new Error(`Unsupported token '${trimmed}'`);
  }

  if (allowed.size === 0) {
    throw new Error(`Field '${fieldStr}' yielded no valid values`);
  }

  return { allowedValues: allowed, isWildcard };
}

/**
 * Parses all 5 fields of a validated cron expression.
 */
export function parseCron(expression: string): ParsedCronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression '${expression}': expected 5 fields`);
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dow: parseField(parts[4], 0, 7, true),
  };
}

/**
 * Calculates the next actual calendar occurrence for a 5-part cron expression.
 * Returns a Date object representing the next match after `fromTimestamp`.
 */
export function getNextCronOccurrence(
  expression: string,
  fromTimestamp: number | Date = Date.now()
): Date {
  const validation = validateCronExpression(expression);
  if (!validation.valid) {
    throw new Error(`Invalid cron expression '${expression}': ${validation.error}`);
  }

  const parsed = parseCron(expression);
  const fromMs = typeof fromTimestamp === 'number' ? fromTimestamp : fromTimestamp.getTime();

  // Start evaluating from the beginning of the next minute
  const candidate = new Date(fromMs);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Maximum search horizon: 5 years into the future
  const maxYear = candidate.getFullYear() + 5;

  while (candidate.getFullYear() <= maxYear) {
    // 1. Check Month (1-12)
    const currentMonth = candidate.getMonth() + 1;
    if (!parsed.month.allowedValues.has(currentMonth)) {
      // Advance to 1st of next month at 00:00:00
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    // 2. Check Day of Month and Day of Week
    const currentDom = candidate.getDate();
    const currentDow = candidate.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

    const domMatches = parsed.dom.allowedValues.has(currentDom);
    const dowMatches = parsed.dow.allowedValues.has(currentDow);

    let dayMatches = false;
    if (!parsed.dom.isWildcard && !parsed.dow.isWildcard) {
      // Standard POSIX rule: if both DOM and DOW are specified, match if EITHER matches
      dayMatches = domMatches || dowMatches;
    } else if (!parsed.dom.isWildcard) {
      dayMatches = domMatches;
    } else if (!parsed.dow.isWildcard) {
      dayMatches = dowMatches;
    } else {
      dayMatches = true;
    }

    if (!dayMatches) {
      // Advance to next day at 00:00:00
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    // 3. Check Hour (0-23)
    const currentHour = candidate.getHours();
    if (!parsed.hour.allowedValues.has(currentHour)) {
      // Advance to next hour at 00:00
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }

    // 4. Check Minute (0-59)
    const currentMinute = candidate.getMinutes();
    if (!parsed.minute.allowedValues.has(currentMinute)) {
      // Advance by 1 minute
      candidate.setMinutes(candidate.getMinutes() + 1);
      continue;
    }

    // All fields matched!
    return candidate;
  }

  throw new Error(`No matching occurrence found within 5 years for cron expression '${expression}'`);
}
