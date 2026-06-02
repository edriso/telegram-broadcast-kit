import cron, { type ScheduledTask } from 'node-cron';
import { logger } from './logger';

// Generic cron plumbing: error containment plus a thin registry around
// node-cron. The bot keeps its own schedule table and its own per-fire logic
// (what to post, the ring-buffer cleanup) — this only makes sure one bad tick
// never kills the loop, an invalid cron never takes the whole bot down, and
// every task can be stopped cleanly on shutdown.

/** A bound, ready-to-run job: its body already knows what to do on a fire. */
export type Job = () => void | Promise<void>;

/**
 * Run a named job with logging + error containment. A throw or a rejected
 * promise inside `fn` is caught and logged, never re-thrown — node-cron does not
 * reliably catch rejected promises across versions, so one failing tick must not
 * be allowed to crash the process or stop later ticks. Returns nothing; the job
 * owns its own result handling.
 *
 * Use this to wrap any function you hand to a cron tick (or call by hand from an
 * `/admin_run` command, so the manual path is the exact same path).
 */
export async function runJob(name: string, fn: Job): Promise<void> {
  logger.info('Job firing', { name });
  try {
    await fn();
  } catch (err) {
    logger.error('Job failed', { name, error: String(err) });
  }
}

/** One cron registration: a name (for logs), a 5-field cron expression, and the
 *  job to run when it fires. */
export interface CronJob {
  name: string;
  /** Standard 5-field cron, interpreted in `timezone`. */
  cron: string;
  run: Job;
}

/**
 * A small registry over node-cron. Holds the live tasks so they can all be
 * stopped on shutdown, validates each cron (an invalid one is logged and
 * skipped so a single typo never takes the whole bot down), and wraps every
 * fire in runJob for error containment. One Scheduler per bot.
 */
export class Scheduler {
  private readonly tasks: ScheduledTask[] = [];

  /** @param timezone IANA timezone every cron is interpreted in (e.g.
   *  'Africa/Cairo'). Defaults to UTC. */
  constructor(private readonly timezone: string = 'UTC') {}

  /**
   * Register one job. The cron is validated first; an invalid expression is
   * logged and skipped (returns false) so the rest still run. Returns true when
   * the task was scheduled.
   */
  register(job: CronJob): boolean {
    if (!cron.validate(job.cron)) {
      logger.error('Invalid cron expression, skipping job', {
        name: job.name,
        cron: job.cron,
      });
      return false;
    }
    const task = cron.schedule(job.cron, () => runJob(job.name, job.run), {
      timezone: this.timezone,
    });
    this.tasks.push(task);
    return true;
  }

  /** Register many jobs. Returns the count successfully scheduled. */
  start(jobs: readonly CronJob[]): number {
    let registered = 0;
    for (const job of jobs) {
      if (this.register(job)) registered++;
    }
    logger.info('Scheduler started', { registered, timezone: this.timezone });
    return registered;
  }

  /** Stop every registered task and clear the registry. */
  stop(): void {
    for (const task of this.tasks) task.stop();
    this.tasks.length = 0;
    logger.info('Scheduler stopped');
  }

  /** How many tasks are currently registered. */
  get size(): number {
    return this.tasks.length;
  }
}
