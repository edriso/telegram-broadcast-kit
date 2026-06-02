import { createServer } from 'node:http';
import { logger } from './logger';

const DEFAULT_PORT = 8080;

/**
 * Resolve a health-server port from a raw env value, falling back to the
 * default for anything blank, non-numeric, or out of 1..65535. The digits-only
 * check (not parseInt) rejects "3000abc"; the blank check matters because a
 * `.env.example` often ships PORT="". Exported for tests.
 */
export function resolvePort(raw: string | undefined, fallback: number = DEFAULT_PORT): number {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
  return n;
}

/** Options for the health server. Omit `port` to resolve it from
 *  process.env.PORT (falling back to 8080). */
export interface HealthServerOptions {
  /** An explicit port, or undefined to read process.env.PORT. */
  port?: number;
  /** Default used when neither `port` nor a valid process.env.PORT is set. */
  fallbackPort?: number;
}

/**
 * Minimal /health endpoint for PaaS uptime checks. Returns 200 while the
 * process is alive. A bad port or a bind failure is logged but never crashes
 * the bot — the bot must keep posting even if the health server can't start.
 */
export function startHealthServer(opts: HealthServerOptions = {}): void {
  const port = opts.port ?? resolvePort(process.env.PORT, opts.fallbackPort ?? DEFAULT_PORT);

  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
      }),
    );
  });

  server.on('error', (err) => {
    logger.warn('Health server failed to bind, continuing without it', {
      port,
      error: String(err),
    });
  });

  try {
    server.listen(port, () => {
      logger.info('Health server listening', { port });
    });
  } catch (err) {
    // The bot must keep running even if the health server can't start.
    logger.warn('Health server could not start, continuing without it', {
      port,
      error: String(err),
    });
  }
}
