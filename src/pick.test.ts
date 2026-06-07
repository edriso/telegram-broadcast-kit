import { describe, it, expect } from 'vitest';
import { pickContent, pickForDay, dayOfYearIn, dayNumberIn } from './pick';

describe('pickContent', () => {
  it('returns the string as-is when input is a non-empty string', () => {
    expect(pickContent('hello')).toBe('hello');
  });

  it('returns null for an empty string (whitespace-only counts as empty)', () => {
    expect(pickContent('')).toBe(null);
    expect(pickContent('   ')).toBe(null);
  });

  it('returns null for an empty array', () => {
    expect(pickContent([])).toBe(null);
  });

  it('returns null for an array of only blank strings', () => {
    expect(pickContent(['', '   ', '\n\t'])).toBe(null);
  });

  it('never picks a blank entry from a mixed array', () => {
    const arr = ['', '  ', 'real'];
    for (let i = 0; i < 100; i++) {
      expect(pickContent(arr)).toBe('real');
    }
  });

  it('returns the single element when the array has one item', () => {
    expect(pickContent(['only'])).toBe('only');
  });

  it('returns an element that exists in the array', () => {
    const arr = ['a', 'b', 'c'];
    const result = pickContent(arr);
    expect(arr).toContain(result);
  });

  it('eventually picks each element from a multi-item array (probabilistic sanity check)', () => {
    const arr = ['a', 'b', 'c'];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const picked = pickContent(arr);
      if (picked) seen.add(picked);
    }
    expect(seen.size).toBe(3);
  });

  it('accepts readonly arrays', () => {
    const arr = ['a', 'b'] as const;
    expect(['a', 'b']).toContain(pickContent(arr));
  });
});

describe('dayOfYearIn', () => {
  it('is 1 on the first day of the year', () => {
    expect(dayOfYearIn(new Date('2026-01-01T12:00:00Z'), 'UTC')).toBe(1);
  });

  it('is 365 on the last day of a non-leap year', () => {
    expect(dayOfYearIn(new Date('2025-12-31T12:00:00Z'), 'UTC')).toBe(365);
  });

  it('counts the leap day so 2024 reaches 366', () => {
    expect(dayOfYearIn(new Date('2024-12-31T12:00:00Z'), 'UTC')).toBe(366);
  });

  it('uses the given timezone, not the host clock', () => {
    // 23:30 UTC on Jan 1 is already Jan 2 in Cairo (UTC+2): day 2, not 1.
    const instant = new Date('2026-01-01T23:30:00Z');
    expect(dayOfYearIn(instant, 'UTC')).toBe(1);
    expect(dayOfYearIn(instant, 'Africa/Cairo')).toBe(2);
  });
});

describe('dayNumberIn', () => {
  it('increments by exactly 1 each calendar day', () => {
    const d1 = dayNumberIn(new Date('2026-03-03T12:00:00Z'), 'UTC');
    const d2 = dayNumberIn(new Date('2026-03-04T12:00:00Z'), 'UTC');
    expect(d2 - d1).toBe(1);
  });

  it('flips parity every day, including across the year boundary (unlike day-of-year)', () => {
    // Dec 31 -> Jan 1: day-of-year jumps 365 -> 1 (both odd, parity stutters);
    // the epoch day number keeps incrementing, so parity keeps alternating.
    const dec31 = dayNumberIn(new Date('2025-12-31T12:00:00Z'), 'UTC');
    const jan01 = dayNumberIn(new Date('2026-01-01T12:00:00Z'), 'UTC');
    expect(jan01 - dec31).toBe(1);
    expect(dec31 % 2).not.toBe(jan01 % 2);
  });

  it('uses the given timezone, not the host clock', () => {
    // 23:30 UTC on Jan 1 is already Jan 2 in Cairo (UTC+2): one day later there.
    const instant = new Date('2026-01-01T23:30:00Z');
    expect(dayNumberIn(instant, 'Africa/Cairo') - dayNumberIn(instant, 'UTC')).toBe(1);
  });

  it('is a stable absolute count (1970-01-01 UTC is day 0)', () => {
    expect(dayNumberIn(new Date('1970-01-01T00:00:00Z'), 'UTC')).toBe(0);
    expect(dayNumberIn(new Date('1970-01-02T00:00:00Z'), 'UTC')).toBe(1);
  });
});

describe('pickForDay', () => {
  const tz = 'UTC';

  it('returns the string as-is for a fixed string', () => {
    expect(pickForDay('fixed', new Date('2026-03-03T00:00:00Z'), tz)).toBe('fixed');
  });

  it('returns null for an empty or all-blank pool', () => {
    expect(pickForDay([], new Date(), tz)).toBe(null);
    expect(pickForDay(['', '  '], new Date(), tz)).toBe(null);
  });

  it('is deterministic: the same calendar day yields the same entry', () => {
    const pool = ['a', 'b', 'c', 'd'];
    const a = pickForDay(pool, new Date('2026-03-03T01:00:00Z'), tz);
    const b = pickForDay(pool, new Date('2026-03-03T22:00:00Z'), tz);
    expect(a).toBe(b);
  });

  it('two consecutive days never repeat', () => {
    const pool = ['a', 'b', 'c'];
    const d1 = pickForDay(pool, new Date('2026-03-03T12:00:00Z'), tz);
    const d2 = pickForDay(pool, new Date('2026-03-04T12:00:00Z'), tz);
    expect(d1).not.toBe(d2);
  });

  it('covers the whole pool before repeating', () => {
    const pool = ['a', 'b', 'c'];
    const seen = new Set<string>();
    // Three consecutive days starting from day 1 of the year.
    for (const day of ['2026-01-01', '2026-01-02', '2026-01-03']) {
      const picked = pickForDay(pool, new Date(`${day}T12:00:00Z`), tz);
      if (picked) seen.add(picked);
    }
    expect(seen.size).toBe(3);
  });

  it('skips blanks when rotating', () => {
    const pool = ['a', '', 'b'];
    const picked = pickForDay(pool, new Date('2026-01-01T12:00:00Z'), tz);
    expect(['a', 'b']).toContain(picked);
  });
});
