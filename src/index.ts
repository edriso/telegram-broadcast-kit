// Public surface of telegram-broadcast-kit: the shared kernel for scheduled
// Telegram channel-poster bots (rotating reminders, azkar, polls posted to a
// channel/group on a cron schedule, with no per-user state and no database).
//
// Pure utilities (no network, no clock of their own): bidi, pick. Side-effecting
// helpers: env (.env loader), logger (console), state (a small JSON file), post
// (grammy plain-text wrapper), scheduler (node-cron error containment), health
// (a tiny HTTP server). Bots consume this as TypeScript source through tsx,
// exactly like their own code.

export * from './logger';
export * from './env';
export * from './bidi';
export * from './pick';
export * from './state';
export * from './post';
export * from './scheduler';
export * from './health';
