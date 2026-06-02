import { describe, it, expect } from 'vitest';
import { resolvePort } from './health';

/**
 * Regression: a `.env.example` often ships PORT="" and `??` does not substitute
 * empty strings, so a bot can crash with ERR_SOCKET_BAD_PORT. resolvePort must
 * fall back cleanly for every malformed value.
 */
describe('resolvePort', () => {
  it('falls back to 8080 for the .env.example empty string', () => {
    expect(resolvePort('')).toBe(8080);
  });

  it('falls back to 8080 for undefined or whitespace', () => {
    expect(resolvePort(undefined)).toBe(8080);
    expect(resolvePort('   ')).toBe(8080);
  });

  it('parses a valid numeric port', () => {
    expect(resolvePort('3000')).toBe(3000);
    expect(resolvePort(' 8080 ')).toBe(8080);
    expect(resolvePort('65535')).toBe(65535);
  });

  it('rejects non-numeric, zero, negative, and out-of-range values', () => {
    expect(resolvePort('abc')).toBe(8080);
    expect(resolvePort('0')).toBe(8080);
    expect(resolvePort('-1')).toBe(8080);
    expect(resolvePort('70000')).toBe(8080);
  });

  it('rejects partly-numeric values instead of guessing', () => {
    // Must be all digits; "3000abc" is malformed config, not port 3000.
    expect(resolvePort('3000abc')).toBe(8080);
    expect(resolvePort('3000.5')).toBe(8080);
    expect(resolvePort('0x1f90')).toBe(8080);
    expect(resolvePort('+8080')).toBe(8080);
  });

  it('honours a caller-supplied fallback for a blank/invalid value', () => {
    expect(resolvePort('', 9000)).toBe(9000);
    expect(resolvePort('nope', 9000)).toBe(9000);
    // A valid value still wins over the fallback.
    expect(resolvePort('3000', 9000)).toBe(3000);
  });
});
