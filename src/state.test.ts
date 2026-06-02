import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  initState,
  getLastMessageId,
  setLastMessageId,
  getMessageIds,
  setMessageIds,
  _resetForTests,
} from './state';

/**
 * The pointer store is a deliberate carve-out from the "no database" rule — so
 * it must behave defensively: a missing file is the routine first-boot case, a
 * corrupt file must not poison memory, and a write failure must not throw out of
 * the cron tick.
 *
 * Each test gets its own temp file so they cannot bleed into each other.
 */

let tmpDir: string;
let tmpFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tbk-state-'));
  tmpFile = path.join(tmpDir, 'last-message-ids.json');
  _resetForTests();
});

afterEach(async () => {
  _resetForTests();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('initState', () => {
  it('starts empty when the file does not exist', async () => {
    await initState(tmpFile);
    expect(getLastMessageId('morning')).toBeUndefined();
  });

  it('loads positive-integer ids from an existing file', async () => {
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, JSON.stringify({ morning: [101], evening: [202] }), 'utf8');
    await initState(tmpFile);
    expect(getLastMessageId('morning')).toBe(101);
    expect(getLastMessageId('evening')).toBe(202);
  });

  it('migrates legacy single-number values to length-1 arrays', async () => {
    // Pre-ring-buffer state files stored `{ name: number }`. The reader must
    // accept that shape so deploys do not need a flag day.
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, JSON.stringify({ morning: 101 }), 'utf8');
    await initState(tmpFile);
    expect(getMessageIds('morning')).toEqual([101]);
    expect(getLastMessageId('morning')).toBe(101);
  });

  it('loads ring-buffer arrays as-is and drops bad entries inside them', async () => {
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(
      tmpFile,
      JSON.stringify({
        good: [10, 20, 30],
        mixed: [1, 0, -2, 3.5, 'four', null, 5],
        empty: [],
      }),
      'utf8',
    );
    await initState(tmpFile);
    expect(getMessageIds('good')).toEqual([10, 20, 30]);
    // Only the two valid positive integers survive.
    expect(getMessageIds('mixed')).toEqual([1, 5]);
    // An empty array yields no entry at all.
    expect(getMessageIds('empty')).toEqual([]);
  });

  it('drops non-integer / non-positive values defensively', async () => {
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(
      tmpFile,
      JSON.stringify({
        ok: 5,
        zero: 0,
        negative: -3,
        floating: 1.5,
        stringy: '7',
        nully: null,
      }),
      'utf8',
    );
    await initState(tmpFile);
    expect(getLastMessageId('ok')).toBe(5);
    expect(getLastMessageId('zero')).toBeUndefined();
    expect(getLastMessageId('negative')).toBeUndefined();
    expect(getLastMessageId('floating')).toBeUndefined();
    expect(getLastMessageId('stringy')).toBeUndefined();
    expect(getLastMessageId('nully')).toBeUndefined();
  });

  it('starts empty when the file is unparseable JSON (does not throw)', async () => {
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, '{ this is not json', 'utf8');
    await expect(initState(tmpFile)).resolves.toBeUndefined();
    expect(getLastMessageId('morning')).toBeUndefined();
  });

  it('starts empty when the file is a JSON array, not an object', async () => {
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, JSON.stringify([1, 2, 3]), 'utf8');
    await initState(tmpFile);
    expect(getLastMessageId('morning')).toBeUndefined();
  });
});

describe('setLastMessageId', () => {
  it('round-trips a value through memory', async () => {
    await initState(tmpFile);
    await setLastMessageId('morning', 42);
    expect(getLastMessageId('morning')).toBe(42);
  });

  it('persists changes to disk so a fresh init recovers them', async () => {
    await initState(tmpFile);
    await setLastMessageId('morning', 7);
    await setLastMessageId('evening', 8);

    _resetForTests();
    await initState(tmpFile);

    expect(getLastMessageId('morning')).toBe(7);
    expect(getLastMessageId('evening')).toBe(8);
  });

  it('overwriting a value keeps only the newest', async () => {
    await initState(tmpFile);
    await setLastMessageId('friday', 100);
    await setLastMessageId('friday', 200);

    _resetForTests();
    await initState(tmpFile);

    expect(getLastMessageId('friday')).toBe(200);
  });

  it('creates the parent directory if it does not exist', async () => {
    const nested = path.join(tmpDir, 'nested', 'deep', 'state.json');
    await initState(nested);
    await setLastMessageId('x', 1);

    const raw = await fs.readFile(nested, 'utf8');
    expect(JSON.parse(raw)).toEqual({ x: [1] });
  });

  it('setMessageIds round-trips ring-buffer arrays through disk', async () => {
    await initState(tmpFile);
    await setMessageIds('poll', [501, 502]);
    expect(getMessageIds('poll')).toEqual([501, 502]);

    _resetForTests();
    await initState(tmpFile);
    expect(getMessageIds('poll')).toEqual([501, 502]);
  });

  it('setMessageIds with an empty array clears the entry', async () => {
    await initState(tmpFile);
    await setMessageIds('foo', [1, 2, 3]);
    expect(getMessageIds('foo')).toEqual([1, 2, 3]);
    await setMessageIds('foo', []);
    expect(getMessageIds('foo')).toEqual([]);
    expect(getLastMessageId('foo')).toBeUndefined();
  });

  it('without initState (pure in-memory) set/get still works and never touches disk', async () => {
    // No initState call. Sets must not throw even though there is no path.
    await setLastMessageId('in_memory_only', 99);
    expect(getLastMessageId('in_memory_only')).toBe(99);

    // No file should have been created at the (default-ish) path.
    await expect(fs.access(tmpFile)).rejects.toThrow();
  });
});
