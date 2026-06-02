import { describe, it, expect, vi } from 'vitest';
import type { Bot, Context } from 'grammy';
import {
  post,
  deleteMessage,
  sendPoll,
  MIN_CLOSE_HOURS,
  MAX_CLOSE_HOURS,
  type PollSpec,
} from './post';
import { rtlIsolate } from './bidi';

/**
 * No network. We pass a fake bot whose `api` is spied, and assert what we send
 * to Telegram and how failures are contained. The chat id is a plain argument
 * (the kit is decoupled from any per-bot config).
 */

const CHAT = '@test_channel';

function fakeBot(overrides: {
  sendMessage?: ReturnType<typeof vi.fn>;
  sendPoll?: ReturnType<typeof vi.fn>;
  deleteMessage?: ReturnType<typeof vi.fn>;
}) {
  return {
    api: {
      sendMessage: overrides.sendMessage ?? vi.fn().mockResolvedValue({ message_id: 1 }),
      sendPoll: overrides.sendPoll ?? vi.fn().mockResolvedValue({ message_id: 2 }),
      deleteMessage: overrides.deleteMessage ?? vi.fn().mockResolvedValue(true),
    },
  } as unknown as Bot<Context>;
}

describe('post', () => {
  it('returns the message_id on success and targets the given chat id', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });
    const bot = fakeBot({ sendMessage });
    const id = await post(bot, CHAT, 'سلام', { name: 'x' });
    expect(id).toBe(42);
    expect(sendMessage.mock.calls[0][0]).toBe(CHAT);
  });

  it('sends plain text with NO parse_mode on the audible path', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendMessage });
    await post(bot, CHAT, 'نص فيه * و _ و ( ) ولن يكسر');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const args = sendMessage.mock.calls[0];
    // (chat_id, text) only — no third "other" argument, so no parse_mode.
    expect(args.length).toBe(2);
    expect(args[1]).toContain('لن يكسر');
  });

  it('returns null (does not throw) when Telegram fails', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('403 forbidden'));
    const bot = fakeBot({ sendMessage });
    await expect(post(bot, CHAT, 'hi', { name: 'x' })).resolves.toBeNull();
  });

  it('posts silently when asked: disable_notification true, still no parse_mode', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 7 });
    const bot = fakeBot({ sendMessage });
    await post(bot, CHAT, 'ذكر صامت', { name: 'friday', silent: true });
    const args = sendMessage.mock.calls[0];
    expect(args.length).toBe(3); // (chat_id, text, other)
    expect(args[2]).toEqual({ disable_notification: true });
    expect(args[2].parse_mode).toBeUndefined();
  });
});

describe('deleteMessage', () => {
  it('calls deleteMessage with the chat id and the message id', async () => {
    const del = vi.fn().mockResolvedValue(true);
    const bot = fakeBot({ deleteMessage: del });
    const ok = await deleteMessage(bot, CHAT, 555, { name: 'morning' });
    expect(ok).toBe(true);
    const [chatId, messageId] = del.mock.calls[0];
    expect(chatId).toBe(CHAT);
    expect(messageId).toBe(555);
  });

  it('returns false (does not throw) when the delete fails', async () => {
    const del = vi.fn().mockRejectedValue(new Error('message to delete not found'));
    const bot = fakeBot({ deleteMessage: del });
    await expect(deleteMessage(bot, CHAT, 999)).resolves.toBe(false);
  });
});

describe('sendPoll', () => {
  const base: PollSpec = {
    question: 'بماذا أتممت يومك؟',
    options: ['أذكار الصباح', 'أذكار المساء', 'سورة الملك'],
  };

  it('returns the poll message_id on success', async () => {
    const poll = vi.fn().mockResolvedValue({ message_id: 99 });
    const bot = fakeBot({ sendPoll: poll });
    const id = await sendPoll(bot, CHAT, base, { name: 'p' });
    expect(id).toBe(99);
  });

  it('defaults to anonymous + multi-answer and bidi-isolated InputPollOption objects', async () => {
    const poll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll: poll });
    await sendPoll(bot, CHAT, base);
    const [chatId, question, options, other] = poll.mock.calls[0];
    expect(chatId).toBe(CHAT);
    expect(question).toBe(rtlIsolate(base.question));
    expect(options).toEqual([
      { text: rtlIsolate('أذكار الصباح') },
      { text: rtlIsolate('أذكار المساء') },
      { text: rtlIsolate('سورة الملك') },
    ]);
    expect(other.is_anonymous).toBe(true);
    expect(other.allows_multiple_answers).toBe(true);
  });

  it('sends the poll with NO parse_mode (the reason bidi isolates exist)', async () => {
    const poll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll: poll });
    await sendPoll(bot, CHAT, base);
    expect(poll.mock.calls[0][3].parse_mode).toBeUndefined();
  });

  it('honours explicit isAnonymous:false / allowsMultipleAnswers:false', async () => {
    const poll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll: poll });
    await sendPoll(bot, CHAT, { ...base, isAnonymous: false, allowsMultipleAnswers: false });
    const other = poll.mock.calls[0][3];
    expect(other.is_anonymous).toBe(false);
    expect(other.allows_multiple_answers).toBe(false);
  });

  it('rings by default (disable_notification false) and is silenceable', async () => {
    const audible = vi.fn().mockResolvedValue({ message_id: 1 });
    await sendPoll(fakeBot({ sendPoll: audible }), CHAT, base);
    expect(audible.mock.calls[0][3].disable_notification).toBe(false);

    const silent = vi.fn().mockResolvedValue({ message_id: 1 });
    await sendPoll(fakeBot({ sendPoll: silent }), CHAT, base, { silent: true });
    expect(silent.mock.calls[0][3].disable_notification).toBe(true);
  });

  it('sets a future close_date ~22h ahead by default', async () => {
    const poll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll: poll });
    const before = Math.floor(Date.now() / 1000);
    await sendPoll(bot, CHAT, base);
    const closeDate = poll.mock.calls[0][3].close_date as number;
    expect(closeDate).toBeGreaterThan(before);
    expect(closeDate).toBeCloseTo(before + 22 * 3600, -2);
  });

  it('clamps an absurdly large closeAfterHours into Telegram range', async () => {
    const poll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll: poll });
    const before = Math.floor(Date.now() / 1000);
    await sendPoll(bot, CHAT, { ...base, closeAfterHours: 99_999 });
    const closeDate = poll.mock.calls[0][3].close_date as number;
    expect(closeDate).toBeLessThanOrEqual(before + Math.round(MAX_CLOSE_HOURS * 3600) + 2);
  });

  it('clamps a zero/negative closeAfterHours up to the minimum', async () => {
    const poll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll: poll });
    const before = Math.floor(Date.now() / 1000);
    await sendPoll(bot, CHAT, { ...base, closeAfterHours: -5 });
    const closeDate = poll.mock.calls[0][3].close_date as number;
    expect(closeDate).toBeGreaterThanOrEqual(before + Math.floor(MIN_CLOSE_HOURS * 3600));
  });

  it('returns null (does not throw) when Telegram fails', async () => {
    const poll = vi.fn().mockRejectedValue(new Error('429 too many requests'));
    const bot = fakeBot({ sendPoll: poll });
    await expect(sendPoll(bot, CHAT, base)).resolves.toBeNull();
  });
});
