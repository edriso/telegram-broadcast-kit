# CLAUDE.md

Notes for anyone (human or AI) working in this repo. See `README.md` for the
full picture; this is the short "how to work here" version.

## What this is

The shared kernel for **scheduled Telegram channel-poster bots** — bots that
post rotating scheduled content (reminders, azkar, polls) to a channel/group on
a cron schedule, with no per-user state and no database. Code that such bots use
verbatim lives here once, so a fix lands in all of them from one place. It is
consumed as **TypeScript source** (the bots run it through `tsx` like their own
code, and `tsc` resolves it via `moduleResolution: bundler`) — there is **no
build step** and no `dist/`.

It is seeded from the plumbing the `zaaduna` and `aamin` bots share, for future
bots of this type; it is **not yet used by any bot** (those two stay standalone
for now). Do not add bot-specific content, config, or domain data here.

## Rules

1. **Keep it generic and leaf-level.** Only put code here that any scheduled
   channel-poster bot would use verbatim: the logger, bidi isolates, the
   plain-text poster, the JSON pointer state, the content pickers, the cron
   error-containment wrapper, the `/health` server, the `.env` loader. No per-bot
   schedule tables, content, copy, or domain logic — that legitimately differs
   and stays in each bot.
2. **`grammy` and `node-cron` are peer dependencies**, never direct ones, so the
   kit uses the bot's own versions (one version, matching types). They are also
   devDependencies purely so this repo's own typecheck/tests run.
3. **Pure by default.** Pure: `bidi`, `pick`. Side-effecting (keep these the only
   exceptions): `env` (reads a file), `logger` (console), `state` (a JSON file),
   `post` (grammY), `scheduler` (node-cron), `health` (binds a port). New pure
   code must stay clock-free and testable (take `now`/`timezone` as arguments,
   never call `new Date()` deep inside a pure function).
4. **Plain text, no parse_mode.** `post`/`sendPoll` never set a parse_mode —
   Arabic du'a/Quran punctuation would 400. That is why `bidi.ts` exists; do not
   "fix" RTL with HTML `dir="rtl"`.
5. **Every export is tested.** Add a vitest test next to new code.

## Release flow

```bash
pnpm install
pnpm check          # typecheck + lint + test (all green before you tag)
```

Then bump `version` in `package.json`, add a `CHANGELOG.md` entry, commit, and
tag (`git tag vX.Y.Z && git push origin vX.Y.Z`). A consuming bot pins a tag
(`github:edriso/telegram-broadcast-kit#vX.Y.Z`); its CI runs `pnpm check` and
merging deploys. **Keep the repo public** so the bots' CI and Docker builds can
fetch the tarball without auth.
