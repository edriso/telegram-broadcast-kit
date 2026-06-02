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
 * Day-of-year (1..366) for a Date in a given IANA timezone, computed by
 * formatting the date in that timezone (so "today" means today in the bot's
 * timezone, not on the host clock). Pure: no global Date mutation.
 */
export function dayOfYearIn(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const startOfYear = Date.UTC(year, 0, 1);
  const thisDay = Date.UTC(year, month - 1, day);
  return Math.round((thisDay - startOfYear) / 86_400_000) + 1;
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
