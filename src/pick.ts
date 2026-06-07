/**
 * Content-rotation helpers: choose one string to post from a fixed string or a
 * pool of strings. Blank entries are skipped; every picker returns null when
 * nothing postable remains, so the caller skips the tick instead of sending an
 * empty message Telegram would reject anyway.
 *
 * Pure by design — `pickContent` takes its randomness from Math.random, and the
 * day-based pickers take `now`/`timezone` as arguments — so they stay easy to
 * test and never read a clock of their own.
 */

/** Random pick from a pool (or a fixed string returned as-is). */
export function pickContent(content: string | readonly string[]): string | null {
  if (typeof content === 'string') return content.trim() ? content : null;
  const usable = content.filter((c) => c.trim().length > 0);
  if (usable.length === 0) return null;
  return usable[Math.floor(Math.random() * usable.length)];
}

/**
 * A date's calendar year/month/day AS SEEN in a given IANA timezone (so
 * "today" means today in the bot's timezone, not on the host clock). Pure: no
 * global Date mutation. Shared by dayOfYearIn / dayNumberIn.
 */
function ymdInTz(date: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

/**
 * Day-of-year (1..366) for a Date in a given IANA timezone. Resets to 1 each
 * January 1 — use this for rotation that should line up with the calendar year.
 */
export function dayOfYearIn(date: Date, timezone: string): number {
  const { year, month, day } = ymdInTz(date, timezone);
  const startOfYear = Date.UTC(year, 0, 1);
  const thisDay = Date.UTC(year, month - 1, day);
  return Math.round((thisDay - startOfYear) / 86_400_000) + 1;
}

/**
 * Whole day number for a Date in a given IANA timezone, counting days since the
 * Unix epoch (1970-01-01). Unlike dayOfYearIn it does NOT reset each year, so
 * its parity (even/odd) flips on every real calendar day with no stutter at the
 * year boundary. Handy for day-by-day alternation (e.g. show A on even days, B
 * on odd) or any cadence keyed to an unbroken day count. Pure.
 */
export function dayNumberIn(date: Date, timezone: string): number {
  const { year, month, day } = ymdInTz(date, timezone);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Deterministic daily pick: rotates through the pool by day-of-year, so the
 * same calendar day always shows the same entry, two consecutive days never
 * repeat (consecutive day numbers differ by one, and the pool has more than one
 * usable entry), and the whole pool is covered before any repeat. No state
 * needed, so it is restart-safe by construction. A fixed string is returned
 * as-is.
 *
 * Useful for a daily reminder so a follower never sees yesterday's tip again
 * today.
 *
 * CADENCE CAVEAT: the "no consecutive repeat / whole pool before a repeat"
 * guarantee assumes a DAILY fire (the day-of-year step is 1). On a coarser
 * schedule the step is larger, so the pool size must be coprime with that step
 * or some entries never show. The classic trap: a WEEKLY cron steps by 7, so a
 * pool whose size is a multiple of 7 freezes on a single entry forever — size a
 * weekly pool to avoid multiples of 7. For day-by-day alternation between two
 * sources, prefer dayNumberIn parity over this helper.
 */
export function pickForDay(
  content: string | readonly string[],
  now: Date,
  timezone: string,
): string | null {
  if (typeof content === 'string') return content.trim() ? content : null;
  const usable = content.filter((c) => c.trim().length > 0);
  if (usable.length === 0) return null;
  const index = (dayOfYearIn(now, timezone) - 1) % usable.length;
  return usable[index];
}
