import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logger';

/**
 * Per-job pointer store: `name → message_ids[]` (oldest → newest), the ids a
 * scheduled job keeps live so its replace / ring-buffer delete survives a
 * restart. One small JSON file, written atomically (tmp file + rename).
 *
 * The deliberate carve-out from the "no database" rule — but not a database: no
 * schema, no queries, one small file, the same weight as .env. The bot never
 * depends on it for correctness; lose it and each job just leaks a few stale
 * messages until they age out.
 *
 * Resilient by design (log + continue): a missing/corrupt file starts empty, a
 * malformed entry is dropped, a failed write keeps the in-memory copy. The
 * legacy `{name: number}` shape is still read (coerced to a length-1 array). If
 * initState is never called the store is in-memory only — which is what lets
 * unit tests run with no filesystem.
 */

let state: Record<string, number[]> = {};
let filePath: string | null = null;

/**
 * Load the store from disk. Call once at startup, before the scheduler (safe to
 * call again). Never throws — a missing/unreadable file just means "start
 * empty"; the bot must keep posting without the file.
 */
export async function initState(p: string): Promise<void> {
  filePath = p;
  state = {};
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const ids = coerceToIdArray(v);
        if (ids.length > 0) state[k] = ids;
      }
    }
    logger.info('Loaded message-id state', {
      path: p,
      tracked: Object.keys(state).length,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      logger.info('No state file yet, starting empty', { path: p });
    } else {
      logger.warn('Could not read state file, starting empty', {
        path: p,
        error: String(err),
      });
    }
  }
}

/**
 * Accept both the legacy `number` and current `number[]` shapes; drop anything
 * that isn't a positive integer so a bad value can't be sent to Telegram as a
 * delete id.
 */
function coerceToIdArray(v: unknown): number[] {
  if (typeof v === 'number') {
    return isValidId(v) ? [v] : [];
  }
  if (Array.isArray(v)) {
    return v.filter(isValidId);
  }
  return [];
}

function isValidId(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

/** The tracked message_ids for this job (oldest first), or `[]`. */
export function getMessageIds(name: string): number[] {
  return state[name] ? [...state[name]] : [];
}

/** Replace the tracked ids and persist (best-effort). Empty array clears. */
export async function setMessageIds(name: string, ids: number[]): Promise<void> {
  if (ids.length === 0) {
    delete state[name];
  } else {
    state[name] = [...ids];
  }
  await persist();
}

/** Newest tracked id for this job, or undefined (pre-ring-buffer). */
export function getLastMessageId(name: string): number | undefined {
  const arr = state[name];
  return arr && arr.length > 0 ? arr[arr.length - 1] : undefined;
}

/** Replace tracked ids with a single id. Pre-ring-buffer callers / tests only;
 *  prefer setMessageIds. */
export async function setLastMessageId(name: string, id: number): Promise<void> {
  await setMessageIds(name, [id]);
}

/**
 * Write atomically (tmp file + rename) so a crash mid-write never leaves
 * half-written JSON. Best-effort: a write failure is logged, not thrown — only
 * the cross-restart guarantee degrades.
 */
async function persist(): Promise<void> {
  if (!filePath) return; // initState was never called (e.g. tests).
  const target = filePath;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(tmp, target);
  } catch (err) {
    logger.error('Failed to persist state file', {
      path: target,
      error: String(err),
    });
  }
}

/** Reset module state. Tests only. */
export function _resetForTests(): void {
  state = {};
  filePath = null;
}
