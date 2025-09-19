import { Telegraf } from "telegraf";
import { S3Service } from "../s3-service/s3.service";
import { Logger } from "../logger-service/logger.service";
import path from "path";
import i18next from "../../i18n";

/**
 * TelegramService — фасад для отправки сообщений и медиа с опциональной привязкой к треду.
 */
export class TelegramService {
  private logger = Logger.getInstance();

  constructor(
    private bot: Telegraf,
    private s3Service: S3Service | undefined
  ) {}

  /**
   * Отправляет контент сообщения (текст и/или медиа). Если передан replyToMessageId — ответом на него.
   */
  public async sendContentMessage(
    chatId: number,
    text: string,
    s3Key?: string | null,
    replyToMessageId?: number
  ): Promise<void> {
    if (s3Key && this.s3Service) {
      const fileData = await this.s3Service.getFile(s3Key);
      if (fileData?.body) {
        await this.sendMedia(
          chatId,
          s3Key,
          fileData.body as NodeJS.ReadableStream,
          text,
          replyToMessageId
        );
        return;
      }
      this.logger.warn(
        `Не удалось получить медиа из S3 по ключу: ${s3Key}. Отправляем только текст.`
      );
    }

    const extra: any = {};
    if (replyToMessageId) {
      extra.reply_parameters = { message_id: replyToMessageId };
    }

    if (text) {
      await this.bot.telegram.sendMessage(chatId, text, extra);
    }
  }

  /**
   * Отправляет медиафайл, определяя его тип по ключу S3. По возможности указывает filename.
   */
  public async sendMedia(
    chatId: number,
    key: string,
    fileStream: NodeJS.ReadableStream,
    caption?: string,
    replyToMessageId?: number
  ) {
    const baseName = path.basename(key);
    const ext = path.extname(baseName);
    const nameOnly = baseName.replace(ext, "");
    const parts = nameOnly.split("_");
    const mediaType = parts[parts.length - 1];

    const source = { source: fileStream, filename: baseName } as any;

    const extraBase: any = {};
    if (replyToMessageId) {
      extraBase.reply_parameters = { message_id: replyToMessageId };
    }

    const captionOptions = caption ? { caption, ...extraBase } : extraBase;

    try {
      switch (mediaType) {
        case "video":
          await this.bot.telegram.sendVideo(chatId, source, captionOptions);
          break;
        case "photo":
          await this.bot.telegram.sendPhoto(chatId, source, captionOptions);
          break;
        case "voice":
          await this.bot.telegram.sendVoice(chatId, source, extraBase);
          if (caption) {
            await this.bot.telegram.sendMessage(chatId, caption, extraBase);
          }
          break;
        case "videonote":
          await this.bot.telegram.sendVideoNote(chatId, source, extraBase);
          if (caption) {
            await this.bot.telegram.sendMessage(chatId, caption, extraBase);
          }
          break;
        default:
          await this.bot.telegram.sendDocument(chatId, source, captionOptions);
          break;
      }
    } catch (error) {
      this.logger.error(`Ошибка при отправке медиа файла ${key}:`, error);
      await this.bot.telegram.sendMessage(
        chatId,
        i18next.t("notifications.file_not_found"),
        extraBase
      );
    }
  }
}
