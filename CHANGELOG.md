# Changelog

Notable changes to telegram-broadcast-kit. A consuming bot pins a tag, e.g.
`github:edriso/telegram-broadcast-kit#v0.1.0`, so each entry below is a tag a bot
can move to.

## v0.2.1

- **Reply threading on `post` and `sendPoll`.** New optional
  `replyToMessageId?: number` on the post options sends the message/poll as a
  reply to an earlier message in the same chat (Bot API `reply_parameters`).
  Used to thread an answer poll under the context message it belongs to.
  Omitted by default (a standalone post), so existing callers are unaffected.

## v0.2.0

Two backward-compatible additions to the `post` module so the quiz-poster bots
(fluent-owls, numninjas) can adopt the kit. Existing zaaduna/aamin callers are
unaffected — the regular-poll and plain-text paths send byte-for-byte the same
request as before.

- **Quiz polls in `sendPoll`/`PollSpec`.** New optional `type?: 'regular' |
'quiz'` (default `'regular'`), `correctOptionId?: number` (0-based, REQUIRED
  for a quiz), and `explanation?: string` (quiz only, shown on a wrong answer).
  A quiz sends `type:'quiz'` + `correct_option_id` (+ `explanation` if given)
  and is forced single-answer (`allows_multiple_answers:false`), mirroring the
  Bot API. Quiz config is validated synchronously and THROWS on bad input
  (missing/out-of-range/non-integer `correctOptionId`, or an `explanation` over
  Telegram's 200-char limit — no silent truncation) instead of letting it 400 at
  send time. Stays plain-text (no `explanation_parse_mode`). New export:
  `MAX_EXPLANATION_CHARS`.
- **Opt-in `parseMode` on `post`.** New optional `parseMode?: 'HTML' |
'MarkdownV2' | 'Markdown'` on `post`'s options passes `parse_mode` through to
  `sendMessage`. Omitted by default, so the Arabic-safe plain-text behaviour is
  unchanged; callers that opt in are responsible for escaping their text (Arabic
  du'a/Quran bots keep it off).

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
