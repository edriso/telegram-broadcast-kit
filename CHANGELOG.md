# Changelog

Notable changes to telegram-broadcast-kit. A consuming bot pins a tag, e.g.
`github:edriso/telegram-broadcast-kit#v0.1.0`, so each entry below is a tag a bot
can move to.

## v0.1.0

- Initial shared kernel for scheduled Telegram channel-poster bots, seeded from
  the plumbing the zaaduna and aamin bots share: the console `logger`, the root
  `.env` loader (`env`), Unicode bidi isolates for plain-text RTL (`bidi`:
  `rtlIsolate`/`ltrIsolate`/`autoIsolate`), content-rotation pickers (`pick`:
  `pickContent`/`pickForDay`/`dayOfYearIn`), atomic JSON pointer state (`state`),
  the bidi-safe plain-text poster (`post`: `post`/`deleteMessage`/`sendPoll`),
  the cron error-containment wrapper and task registry (`scheduler`:
  `runJob`/`Scheduler`), and the tiny `/health` server (`health`). Shipped as
  TypeScript source; no build step. `grammy` and `node-cron` are peer
  dependencies. Not yet wired into any bot — seeded for future bots of this type.
