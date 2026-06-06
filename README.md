# telegram-broadcast-kit

The shared kernel for **scheduled Telegram channel-poster bots** — bots that post rotating
scheduled content (reminders, azkar, polls) to a channel or group on a cron schedule, with **no
per-user state and no database**. It exists so a fix to this plumbing can land in every such bot
from one place, instead of drifting between byte-identical copies.

> **Consumed by [zaaduna], [aamin], [fluent-owls], and [numninjas]** — four scheduled
> channel-poster bots. Each pins a tag and takes its logger, env, bidi, pick, JSON-pointer state,
> post/poll/delete, cron `Scheduler`, and `/health` server from here, keeping only its own schedule
> table, content, and dispatch. The two quiz bots (fluent-owls, numninjas) use the kit's quiz-poll
> mode. Renovate opens a bump PR in each when a new tag ships, so a fix here reaches every bot.

[zaaduna]: https://github.com/edriso/zaaduna
[aamin]: https://github.com/edriso/aamin
[fluent-owls]: https://github.com/edriso/fluent-owls
[numninjas]: https://github.com/edriso/numninjas

## What's in it

| Module      | Exports                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logger`    | `logger` (timestamped JSON-ish console logger)                                                                                                                                    |
| `env`       | `loadEnv` (finds the consuming bot's root `.env`)                                                                                                                                 |
| `bidi`      | `rtlIsolate`, `ltrIsolate`, `autoIsolate` (Unicode bidi isolates for plain-text RTL)                                                                                              |
| `pick`      | `pickContent`, `pickForDay`, `dayOfYearIn` (content rotation: random or daily-rotating)                                                                                           |
| `state`     | `initState`, `getMessageIds`, `setMessageIds`, `getLastMessageId`, `setLastMessageId`                                                                                             |
| `post`      | `post` (opt-in `parseMode`, reply threading), `deleteMessage`, `sendPoll` (regular + quiz, reply threading), `PollSpec`, `ChatId`, `MIN/MAX_CLOSE_HOURS`, `MAX_EXPLANATION_CHARS` |
| `scheduler` | `runJob`, `Scheduler`, `Job`, `CronJob` (cron error containment + a tiny task registry)                                                                                           |
| `health`    | `startHealthServer`, `resolvePort` (a minimal `/health` HTTP server)                                                                                                              |

Everything is pure except `env` (reads a `.env`), `logger` (writes the console), `state` (reads/writes
a small JSON file), `post` (calls grammY), `scheduler` (calls node-cron), and `health` (binds a port).
`grammy` and `node-cron` are **peer dependencies** so the kit uses the bot's own versions.

### Design notes

- **Plain text by default, parse_mode is opt-in.** `post`/`sendPoll` set no parse_mode unless asked:
  Arabic du'a/Quran punctuation contains characters Markdown/HTML parsing would reject with a 400.
  The bidi isolates in `bidi.ts` are how a plain-text RTL line stays right-to-left and walls itself
  off from the vote %/count Telegram appends to poll options. A bot whose text is safe (and escaped
  to that mode's rules) can pass `post(..., { parseMode: 'HTML' })` to opt in; Arabic content bots
  keep it off. `sendPoll` stays plain-text either way (no `explanation_parse_mode`).
- **Regular and quiz polls.** `sendPoll`'s `PollSpec` defaults to an anonymous `'regular'` poll
  (unchanged). Set `type: 'quiz'` with a 0-based `correctOptionId` (and an optional `explanation`,
  ≤200 chars, shown on a wrong answer) for a quiz. A quiz is always single-answer, so the kit forces
  `allows_multiple_answers:false` for it. Bad quiz config (missing/out-of-range `correctOptionId`,
  over-long `explanation`) throws synchronously before the network call, not an opaque Telegram 400.
  Set `direction: 'ltr'` (or `'auto'`) on the `PollSpec` for Latin-script polls; it defaults to
  `'rtl'`, so a Latin option like "1 sweet" would otherwise mirror to "sweet 1" for an RTL reader.
- **The state file is not a database.** It is one small JSON file (atomic tmp-file + rename), the
  same weight as `.env`. It holds the message ids a ring-buffer scheduler keeps live, so
  replace-on-next-fire survives a restart. Lose it and a job just leaks a few stale messages.
- **The scheduler is decoupled.** It does **not** know your schedule table or what a fire posts.
  `runJob(name, fn)` is the error-containment wrapper (one bad tick never kills the loop);
  `Scheduler` is a thin registry that validates each cron, wraps each fire in `runJob`, and lets you
  stop every task on shutdown. Your bot keeps its own schedule list and its own per-fire logic.

## How it's consumed

The bots run from TypeScript source via `tsx` (no build step), so this package ships **`.ts`
source** too — `exports` points at `src/index.ts`, and the consuming bot's `tsx` (runtime) and
`tsc` (`moduleResolution: bundler`, typecheck) handle it like their own files. No `dist/`, no build.

A bot depends on a pinned tag:

```jsonc
// a poster bot's package.json (e.g. zaaduna / numninjas)
"dependencies": {
  "telegram-broadcast-kit": "github:edriso/telegram-broadcast-kit#v0.2.1"
}
```

> The repo must be **public** so the bots' CI and Docker builds can fetch the tarball without auth.

## Release

```bash
pnpm install
pnpm check   # typecheck + lint + test (all green before you tag)
```

Then bump `version` in `package.json`, add a `CHANGELOG.md` entry, commit, and push a new tag
(`git tag vX.Y.Z && git push origin vX.Y.Z`). A consuming bot moves to the new tag (by hand, or via
Renovate watching this repo's tags), its CI runs `pnpm check`, and merging deploys.

## Develop

```bash
pnpm install
pnpm check         # typecheck + lint + test
pnpm test:watch    # tests in watch mode
pnpm format        # prettier --write
```
