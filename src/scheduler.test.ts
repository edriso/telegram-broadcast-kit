import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The scheduler's whole job is containment: one bad tick must never crash the
 * loop, and an invalid cron must never take the whole bot down. node-cron is
 * mocked so this stays a pure, no-network unit test.
 */

const scheduleMock = vi.fn((_cron: string, _handler: () => void, _opts: unknown) => ({
  stop: vi.fn(),
}));
const validateMock = vi.fn((expr: string) => expr !== 'not a cron');

vi.mock('node-cron', () => ({
  default: { schedule: scheduleMock, validate: validateMock },
}));

// Imported after the mock so the mocked module is wired in.
const { runJob, Scheduler } = await import('./scheduler');

beforeEach(() => {
  scheduleMock.mockClear();
  validateMock.mockClear();
});

describe('runJob (error containment)', () => {
  it('runs the job body and resolves', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await runJob('ok', fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('swallows a thrown error instead of letting it escape the tick', async () => {
    const fn = vi.fn(() => {
      throw new Error('boom');
    });
    await expect(runJob('throws', fn)).resolves.toBeUndefined();
  });

  it('swallows a rejected promise (node-cron does not reliably catch these)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('async boom'));
    await expect(runJob('rejects', fn)).resolves.toBeUndefined();
  });

  it('accepts a synchronous (void-returning) job too', async () => {
    let ran = false;
    await runJob('sync', () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

describe('Scheduler registry', () => {
  it('registers a valid-cron job and reports size', () => {
    const s = new Scheduler('Africa/Cairo');
    const ok = s.register({ name: 'a', cron: '0 6 * * *', run: vi.fn() });
    expect(ok).toBe(true);
    expect(s.size).toBe(1);
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    // The configured timezone is passed through to node-cron.
    expect(scheduleMock.mock.calls[0][2]).toEqual({ timezone: 'Africa/Cairo' });
  });

  it('skips an invalid cron (returns false) without throwing', () => {
    const s = new Scheduler();
    const ok = s.register({ name: 'broken', cron: 'not a cron', run: vi.fn() });
    expect(ok).toBe(false);
    expect(s.size).toBe(0);
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('start registers only the valid jobs and returns the count', () => {
    const s = new Scheduler();
    const registered = s.start([
      { name: 'ok_message', cron: '0 6 * * *', run: vi.fn() },
      { name: 'broken', cron: 'not a cron', run: vi.fn() },
      { name: 'ok_poll', cron: '43 21 * * *', run: vi.fn() },
    ]);
    expect(registered).toBe(2);
    expect(s.size).toBe(2);
    const crons = scheduleMock.mock.calls.map((c) => c[0]);
    expect(crons).toEqual(['0 6 * * *', '43 21 * * *']);
    expect(crons).not.toContain('not a cron');
  });

  it('a registered tick runs its job through runJob and contains its error', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('tick boom'));
    const s = new Scheduler();
    s.register({ name: 'risky', cron: '0 0 * * *', run: failing });
    // node-cron is mocked, so fire the handler it was given by hand.
    const handler = scheduleMock.mock.calls[0][1];
    await expect((handler as () => Promise<void>)()).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('stop stops every registered task and clears the registry', () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    scheduleMock.mockImplementation(() => {
      const stop = vi.fn();
      stops.push(stop);
      return { stop };
    });

    const s = new Scheduler();
    s.start([
      { name: 'a', cron: '0 6 * * *', run: vi.fn() },
      { name: 'b', cron: '0 7 * * *', run: vi.fn() },
    ]);
    expect(stops).toHaveLength(2);

    s.stop();
    for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
    expect(s.size).toBe(0);
  });
});
