import type { Bot, Context } from 'grammy';
import { logger } from './logger';
import { autoIsolate, ltrIsolate, rtlIsolate } from './bidi';

/** A Telegram chat id: the numeric "-100…" id (survives a username rename) or
 *  an "@channel" handle. Passed as-is to the Bot API. */
export type ChatId = string | number;

/** Extra options for a post. `silent` maps to Telegram's disable_notification:
 *  the message still appears in the channel, but the reader's device stays
 *  quiet. `name` is a short job id used only in the logs. `parseMode` is an
 *  opt-in escape hatch (see `post`) — leave it unset for the Arabic-safe
 *  plain-text default. */
export interface PostOptions {
  name?: string;
  silent?: boolean;
  /** Opt-in Telegram parse_mode. Omitted by default (plain text). When set, the
   *  CALLER is responsible for escaping the text to that mode's rules; Arabic
   *  du'a/Quran bots must keep it off (the punctuation would 400 a parse). */
  parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown';
  /** Post this message/poll as a reply to an earlier message in the same chat
   *  (its message_id). Used to thread a poll under the context message it
   *  belongs to. Omitted by default (a standalone post). */
  replyToMessageId?: number;
}

/**
 * Send one plain-text message to a chat. No parse_mode by default: Arabic
 * du'a/Quran (and similar) text contains characters Markdown/HTML parsing would
 * reject with a 400, so plain text is the only safe default. A caller that
 * knows its text is safe (already escaped to the mode's rules) can opt in via
 * `opts.parseMode`; the default stays plain text. Returns the message_id, or
 * null on failure (logged, not thrown, so a transient glitch never crashes the
 * cron tick).
 */
export async function post(
  bot: Bot<Context>,
  chatId: ChatId,
  text: string,
  opts: PostOptions = {},
): Promise<number | null> {
  try {
    // Build the "other" options only from the fields the caller actually set,
    // so the common (audible, plain-text) path stays a bare (chat_id, text)
    // call with no parse_mode — unchanged from before parseMode existed.
    const other: {
      disable_notification?: boolean;
      parse_mode?: PostOptions['parseMode'];
      reply_parameters?: { message_id: number };
    } = {};
    if (opts.silent) other.disable_notification = true;
    if (opts.parseMode) other.parse_mode = opts.parseMode;
    if (opts.replyToMessageId) other.reply_parameters = { message_id: opts.replyToMessageId };
    const message =
      Object.keys(other).length > 0
        ? await bot.api.sendMessage(chatId, text, other)
        : await bot.api.sendMessage(chatId, text);
    logger.info('Posted message to channel', {
      name: opts.name,
      messageId: message.message_id,
      silent: opts.silent ?? false,
    });
    return message.message_id;
  } catch (err) {
    logger.error('Failed to post message to channel', {
      name: opts.name,
      error: String(err),
    });
    return null;
  }
}

/**
 * Delete one previously-posted message (the replace-on-next-fire cleanup a
 * ring-buffer scheduler does). Non-fatal by design: the usual failure is "an
 * admin already deleted it by hand" — log and move on. Needs the bot's
 * `can_delete_messages` admin right, which also lifts Telegram's 48h delete cap
 * (matters for a weekly post). Returns true/false.
 */
export async function deleteMessage(
  bot: Bot<Context>,
  chatId: ChatId,
  messageId: number,
  opts: Pick<PostOptions, 'name'> = {},
): Promise<boolean> {
  try {
    await bot.api.deleteMessage(chatId, messageId);
    logger.info('Deleted previous channel message', {
      name: opts.name,
      messageId,
    });
    return true;
  } catch (err) {
    // warn, not error: a missing previous message is routine (an admin tidied
    // the channel by hand).
    logger.warn('Failed to delete previous channel message', {
      name: opts.name,
      messageId,
      error: String(err),
    });
    return false;
  }
}

/** Telegram's allowed poll auto-close window, expressed in hours. */
export const MIN_CLOSE_HOURS = 5 / 3600; // 5 seconds
export const MAX_CLOSE_HOURS = 2_628_000 / 3600; // ~30.4 days

/** A single poll definition. */
export interface PollSpec {
  /** Telegram allows ≤300 chars. */
  question: string;
  /** 2..10 options, each ≤100 chars. Mapped to the InputPollOption objects Bot
   *  API 7.3+ expects. */
  options: readonly string[];
  /** Anonymous by default — nobody (not even the bot) sees who voted, only
   *  aggregate percentages. */
  isAnonymous?: boolean;
  /** Allow ticking several options in one vote. Defaults to true. Ignored for a
   *  quiz poll (Telegram forbids multiple answers on a quiz). */
  allowsMultipleAnswers?: boolean;
  /** Hours until Telegram auto-closes the poll. Clamped to Telegram's
   *  5s..~30d window. Default 22h. */
  closeAfterHours?: number;
  /** `'regular'` (the default when omitted) is the anonymous vote poll; `'quiz'`
   *  is a single-correct-answer quiz. Mirrors the Bot API's `type`. */
  type?: 'regular' | 'quiz';
  /** Quiz only, REQUIRED for a quiz: the 0-based index into `options` of the
   *  correct answer. Maps to the Bot API's `correct_option_id`. */
  correctOptionId?: number;
  /** Quiz only, optional: text shown when a voter picks a wrong answer.
   *  Telegram limit 0–200 chars with ≤2 line breaks. Maps to `explanation`. */
  explanation?: string;
  /** Text direction for the bidi isolate wrapped around the question and every
   *  option. A poll is sent as plain text with no parse_mode, so its base
   *  direction would otherwise be decided by the client/locale, not the text —
   *  which mirrors Latin polls for RTL-locale readers (e.g. "1 sweet" renders
   *  "sweet 1"). The isolate pins it. Defaults to `'rtl'` (this kit's Arabic
   *  origin); pass `'ltr'` for Latin-script content, or `'auto'` to infer the
   *  direction of each string from its first strong character (good for mixed
   *  or user-supplied text). See bidi.ts. */
  direction?: 'rtl' | 'ltr' | 'auto';
}

/** Telegram's hard cap on a quiz explanation. */
export const MAX_EXPLANATION_CHARS = 200;

/**
 * Send one poll to a chat. Two shapes, mirroring the Bot API's `type`:
 *
 * - `'regular'` (the default): anonymous + multi-answer by default — members
 *   tick the options that apply, everyone sees aggregate percentages, nobody
 *   (not even the bot) learns who voted, no DB.
 * - `'quiz'`: a single-correct-answer quiz; `correctOptionId` is required and
 *   `explanation` is shown on a wrong answer. A quiz can never be multi-answer,
 *   so we force allows_multiple_answers:false regardless of the spec.
 *
 * The question and every option are bidi-isolated so the vote %/count Telegram
 * appends does not render over a leading emoji, and so the text does not mirror
 * for a reader whose client base direction differs from the content (see
 * bidi.ts; keep emoji at the END of each string). The isolate direction follows
 * `spec.direction` — `'rtl'` by default (Arabic content), `'ltr'` for
 * Latin-script content, `'auto'` to infer per string. Like `post`, the poll
 * stays plain-text (no
 * explanation_parse_mode). close_date is clamped to Telegram's accepted range
 * so bad config can't 400 the API. Quiz config is validated synchronously and
 * THROWS on bad input (a programming error, surfaced loudly — unlike a network
 * failure, which is logged and returns null). Returns the poll message_id, or
 * null on a send failure.
 */
export async function sendPoll(
  bot: Bot<Context>,
  chatId: ChatId,
  spec: PollSpec,
  opts: PostOptions = {},
): Promise<number | null> {
  const isQuiz = spec.type === 'quiz';
  const isAnonymous = spec.isAnonymous ?? true;
  // A quiz poll cannot be multiple-answer (Telegram rejects it), so force it
  // off for a quiz regardless of the spec; a regular poll keeps its default.
  const allowsMultiple = isQuiz ? false : (spec.allowsMultipleAnswers ?? true);

  // Validate quiz config up front and fail fast with a clear Error, so a bad
  // correctOptionId / over-long explanation surfaces here as a programming bug
  // rather than as an opaque Telegram 400 at send time.
  if (isQuiz) {
    const { correctOptionId, explanation } = spec;
    if (
      correctOptionId === undefined ||
      !Number.isInteger(correctOptionId) ||
      correctOptionId < 0 ||
      correctOptionId > spec.options.length - 1
    ) {
      throw new Error(
        `sendPoll: a quiz poll requires correctOptionId to be an integer in [0, ${
          spec.options.length - 1
        }], got ${String(correctOptionId)}`,
      );
    }
    if (explanation !== undefined && explanation.length > MAX_EXPLANATION_CHARS) {
      throw new Error(
        `sendPoll: quiz explanation is ${explanation.length} chars, over Telegram's ${MAX_EXPLANATION_CHARS}-char limit`,
      );
    }
  }

  const requestedHours = spec.closeAfterHours ?? 22;
  const clampedHours = Math.min(Math.max(requestedHours, MIN_CLOSE_HOURS), MAX_CLOSE_HOURS);
  const closeDate = Math.floor(Date.now() / 1000) + Math.round(clampedHours * 3600);

  // Bot API 7.3+ wants InputPollOption objects, not strings. Each option and
  // the question is bidi-isolated in the requested direction (default RTL; see
  // bidi.ts and spec.direction).
  const isolate =
    spec.direction === 'ltr' ? ltrIsolate : spec.direction === 'auto' ? autoIsolate : rtlIsolate;
  const options = spec.options.map((text) => ({ text: isolate(text) }));

  // Start from the exact regular-poll request shape (unchanged for non-quiz
  // callers), then layer the quiz fields on only for a quiz.
  const other: {
    is_anonymous: boolean;
    allows_multiple_answers: boolean;
    close_date: number;
    disable_notification: boolean;
    type?: 'quiz';
    correct_option_id?: number;
    explanation?: string;
    reply_parameters?: { message_id: number };
  } = {
    is_anonymous: isAnonymous,
    allows_multiple_answers: allowsMultiple,
    close_date: closeDate,
    disable_notification: opts.silent ?? false,
  };
  if (isQuiz) {
    other.type = 'quiz';
    other.correct_option_id = spec.correctOptionId;
    if (spec.explanation !== undefined) other.explanation = spec.explanation;
  }
  // Thread the poll under an earlier message (e.g. the context message it
  // answers) when the caller asks; a standalone poll otherwise.
  if (opts.replyToMessageId) other.reply_parameters = { message_id: opts.replyToMessageId };

  try {
    const message = await bot.api.sendPoll(chatId, isolate(spec.question), options, other);
    logger.info('Posted poll to channel', {
      name: opts.name,
      messageId: message.message_id,
      options: spec.options.length,
      type: spec.type ?? 'regular',
      isAnonymous,
      closeInHours: clampedHours,
      silent: opts.silent ?? false,
    });
    return message.message_id;
  } catch (err) {
    logger.error('Failed to post poll to channel', {
      name: opts.name,
      error: String(err),
    });
    return null;
  }
}
