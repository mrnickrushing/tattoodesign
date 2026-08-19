// Appointment dates without a native date picker.
//
// The client project form takes dates as text — adding a picker module would
// cost a new binary, and a text field with lenient parsing covers the real
// input ("2026-09-04", "9/4", "sep 4"). Pure functions with `now` injected so
// every path is unit-testable.

export const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

/**
 * Parses a typed date into a local-noon timestamp, or null when it can't.
 *
 * Accepted: "2026-09-04", "9/4/2026", "9/4" and "sep 4" (next occurrence —
 * this year if still ahead, else next year). Noon avoids the date sliding a
 * day across DST or timezone math.
 */
export function parseAppointmentDate(input: string, now = Date.now()): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const build = (year: number, month: number, day: number): number | null => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    // new Date() forgives "February 31" by rolling over; that's a typo, not a date.
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date.getTime();
  };

  const nextOccurrence = (month: number, day: number): number | null => {
    const thisYear = build(new Date(now).getFullYear(), month, day);
    if (thisYear === null) return null;
    return thisYear >= startOfDay(now) ? thisYear : build(new Date(now).getFullYear() + 1, month, day);
  };

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slashFull = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashFull) {
    const year = Number(slashFull[3]);
    return build(year < 100 ? 2000 + year : year, Number(slashFull[1]), Number(slashFull[2]));
  }

  const slashShort = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashShort) return nextOccurrence(Number(slashShort[1]), Number(slashShort[2]));

  const named = text.match(/^([a-z]+)\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
  if (named) {
    const month = MONTHS.findIndex((name) => name.startsWith(named[1])) + 1;
    if (month === 0) return null;
    const day = Number(named[2]);
    return named[3] ? build(Number(named[3]), month, day) : nextOccurrence(month, day);
  }

  return null;
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function formatAppointmentDate(timestamp: number): string {
  const date = new Date(timestamp);
  const month = MONTHS[date.getMonth()];
  return `${month[0].toUpperCase()}${month.slice(1, 3)} ${date.getDate()}, ${date.getFullYear()}`;
}

/** "Today", "Tomorrow", "In 12 days", "3 days ago" — for the project card. */
export function describeAppointment(timestamp: number, now = Date.now()): string {
  const days = Math.round((startOfDay(timestamp) - startOfDay(now)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  if (days === -1) return "Yesterday";
  return `${-days} days ago`;
}

/**
 * Upcoming appointments first (soonest at the top), then undated projects by
 * recency, then past appointments most-recent-first. The shop counter order.
 */
export function sortByAppointment<T extends { appointmentAt?: number; updatedAt: number }>(
  projects: T[],
  now = Date.now()
): T[] {
  const today = startOfDay(now);
  const rank = (project: T) => {
    if (project.appointmentAt === undefined) return 1;
    return project.appointmentAt >= today ? 0 : 2;
  };
  return [...projects].sort((a, b) => {
    const rankDelta = rank(a) - rank(b);
    if (rankDelta) return rankDelta;
    if (rank(a) === 0) return (a.appointmentAt ?? 0) - (b.appointmentAt ?? 0);
    if (rank(a) === 2) return (b.appointmentAt ?? 0) - (a.appointmentAt ?? 0);
    return b.updatedAt - a.updatedAt;
  });
}

/** Parses "3 x 5", "3x5", "3.5 × 5" into inches; null when it isn't a size. */
export function parseSizeIn(input: string): { width: number; height: number } | null {
  const match = input.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0) || width > 60 || height > 60) return null;
  return { width, height };
}
