import { Context, Telegram } from "telegraf";
import { Logger } from "../services/logger-service/logger.service";

const logger = Logger.getInstance();

/**
 * Отправляет сообщение с MarkdownV2 форматированием.
 * При ошибке парсинга автоматически отправляет plain text версию.
 */
export async function sendMarkdownMessage(
  telegram: Telegram,
  chatId: number,
  text: string,
  options?: {
    link_preview_options?: { is_disabled: boolean };
    reply_to_message_id?: number;
    [key: string]: any;
  }
): Promise<any> {
  try {
    return await telegram.sendMessage(chatId, text, {
      ...options,
      parse_mode: "MarkdownV2",
    });
  } catch (error: any) {
    logger.error(
      "Ошибка отправки сообщения с MarkdownV2, отправляем без форматирования:",
      error
    );
    const plainText = removeMarkdown(text);
    return await telegram.sendMessage(chatId, plainText, options);
  }
}

/**
 * Отправляет сообщение через Context с MarkdownV2 форматированием.
 * При ошибке парсинга автоматически отправляет plain text версию.
 */
export async function replyWithMarkdown(
  ctx: Context,
  text: string,
  options?: {
    link_preview_options?: { is_disabled: boolean };
    reply_to_message_id?: number;
    [key: string]: any;
  }
): Promise<any> {
  try {
    return await ctx.reply(text, {
      ...options,
      parse_mode: "MarkdownV2",
    });
  } catch (error: any) {
    logger.error(
      "Ошибка отправки сообщения с MarkdownV2, отправляем без форматирования:",
      error
    );
    const plainText = removeMarkdown(text);
    return await ctx.reply(plainText, options);
  }
}

/**
 * Удаляет Markdown разметку из текста для fallback на plain text
 */
function removeMarkdown(text: string): string {
  return text
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .replace(/_/g, "")
    .replace(/\[/g, "")
    .replace(/\]/g, "")
    .replace(/\(/g, "")
    .replace(/\)/g, "")
    .replace(/~/g, "")
    .replace(/#/g, "")
    .replace(/\+/g, "")
    .replace(/-/g, "")
    .replace(/=/g, "")
    .replace(/\|/g, "")
    .replace(/\{/g, "")
    .replace(/\}/g, "")
    .replace(/\./g, "")
    .replace(/!/g, "")
    .replace(/\\/g, "");
}
