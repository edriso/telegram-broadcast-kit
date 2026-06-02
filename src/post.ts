import type { Bot, Context } from 'grammy';
import { logger } from './logger';
import { rtlIsolate } from './bidi';

/** A Telegram chat id: the numeric "-100…" id (survives a username rename) or
 *  an "@channel" handle. Passed as-is to the Bot API. */
export type ChatId = string | number;

/** Extra options for a post. `silent` maps to Telegram's disable_notification:
 *  the message still appears in the channel, but the reader's device stays
 *  quiet. `name` is a short job id used only in the logs. */
export interface PostOptions {
  name?: string;
  silent?: boolean;
}

/**
 * Send one plain-text message to a chat. No parse_mode on purpose: Arabic
 * du'a/Quran (and similar) text contains characters Markdown/HTML parsing would
 * reject with a 400, so plain text is the only safe choice. Returns the
 * message_id, or null on failure (logged, not thrown, so a transient glitch
 * never crashes the cron tick).
 */
export async function post(
  bot: Bot<Context>,
  chatId: ChatId,
  text: string,
  opts: PostOptions = {},
): Promise<number | null> {
  try {
    // Only pass an options object when posting silently, so the common
    // (audible) path stays a bare (chat_id, text) call with no parse_mode.
    const message = opts.silent
      ? await bot.api.sendMessage(chatId, text, { disable_notification: true })
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
  /** Allow ticking several options in one vote. Defaults to true. */
  allowsMultipleAnswers?: boolean;
  /** Hours until Telegram auto-closes the poll. Clamped to Telegram's
   *  5s..~30d window. Default 22h. */
  closeAfterHours?: number;
}

/**
 * Send one anonymous poll to a chat. Anonymous + multi-answer by default:
 * members tick the options that apply, everyone sees aggregate percentages,
 * nobody (not even the bot) learns who voted — no DB. The question and every
 * option are bidi-isolated so the vote %/count Telegram appends does not render
 * over a leading emoji (see bidi.ts; keep emoji at the END of each string).
 * close_date is clamped to Telegram's accepted range so bad config can't 400
 * the API. Returns the poll message_id, or null on failure.
 */
export async function sendPoll(
  bot: Bot<Context>,
  chatId: ChatId,
  spec: PollSpec,
  opts: PostOptions = {},
): Promise<number | null> {
  const isAnonymous = spec.isAnonymous ?? true;
  const allowsMultiple = spec.allowsMultipleAnswers ?? true;

  const requestedHours = spec.closeAfterHours ?? 22;
  const clampedHours = Math.min(Math.max(requestedHours, MIN_CLOSE_HOURS), MAX_CLOSE_HOURS);
  const closeDate = Math.floor(Date.now() / 1000) + Math.round(clampedHours * 3600);

  // Bot API 7.3+ wants InputPollOption objects, not strings. Each option and
  // the question is bidi-isolated (see rtlIsolate).
  const options = spec.options.map((text) => ({ text: rtlIsolate(text) }));

  try {
    const message = await bot.api.sendPoll(chatId, rtlIsolate(spec.question), options, {
      is_anonymous: isAnonymous,
      allows_multiple_answers: allowsMultiple,
      close_date: closeDate,
      disable_notification: opts.silent ?? false,
    });
    logger.info('Posted poll to channel', {
      name: opts.name,
      messageId: message.message_id,
      options: spec.options.length,
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
