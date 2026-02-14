import type { Logger } from 'pino';

export interface TelegramButton {
  text: string;
  url: string;
}

export interface TelegramSendMessageArgs {
  token: string;
  chatIds: string[]; // allow multiple
  text: string;
  buttons?: TelegramButton[];
  logger?: Logger;
}

export async function telegramSendMessage(args: TelegramSendMessageArgs): Promise<void> {
  const { token, chatIds, text, buttons, logger } = args;

  const replyMarkup = buttons?.length
    ? {
        inline_keyboard: [buttons.map((b) => ({ text: b.text, url: b.url }))],
      }
    : undefined;

  const payloadBase: any = {
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };

  // Fan-out to multiple chats (each entry: "CHAT_ID" or "CHAT_ID:THREAD_ID" for forum topics)
  await Promise.all(
    chatIds.map(async (entry) => {
      const [chat_id, threadIdStr] = entry.includes(':') ? entry.split(':') : [entry, ''];
      const message_thread_id = threadIdStr ? parseInt(threadIdStr, 10) : undefined;
      if (Number.isNaN(message_thread_id) && threadIdStr) {
        logger?.warn({ entry }, 'Invalid thread ID in chat entry, ignoring');
      }
      const payload: Record<string, unknown> = { chat_id: chat_id.trim(), ...payloadBase };
      if (message_thread_id != null && !Number.isNaN(message_thread_id)) {
        payload.message_thread_id = message_thread_id;
      }
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        logger?.error({ chat_id, message_thread_id, status: res.status, body }, 'Telegram sendMessage failed');
        throw new Error(`telegram sendMessage failed: ${res.status}`);
      }
    })
  );
}

