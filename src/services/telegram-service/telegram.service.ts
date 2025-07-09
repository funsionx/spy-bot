import { Telegraf } from "telegraf";
import { S3Service } from "../s3-service/s3.service";
import { Logger } from "../logger-service/logger.service";
import path from "path";
import i18next from "../../i18n";

export class TelegramService {
  private logger = Logger.getInstance();

  constructor(
    private bot: Telegraf,
    private s3Service: S3Service | undefined
  ) {}

  /**
   * Отправляет контент сообщения (текст и/или медиа)
   */
  public async sendContentMessage(
    chatId: number,
    text: string,
    s3Key?: string | null
  ): Promise<void> {
    // Если есть медиа, пробуем его отправить
    if (s3Key && this.s3Service) {
      const fileData = await this.s3Service.getFile(s3Key);
      if (fileData?.body) {
        await this.sendMedia(
          chatId,
          s3Key,
          fileData.body as NodeJS.ReadableStream,
          text
        );
        // Если медиа отправлено успешно, выходим
        return;
      }
      this.logger.warn(
        `Не удалось получить медиа из S3 по ключу: ${s3Key}. Отправляем только текст.`
      );
    }

    // Если медиа нет, или не удалось его получить, или текста вообще нет
    if (text) {
      await this.bot.telegram.sendMessage(chatId, text, {
        parse_mode: "MarkdownV2",
      });
    }
  }

  /**
   * Отправляет медиафайл, определяя его тип по ключу S3
   */
  public async sendMedia(
    chatId: number,
    key: string,
    fileStream: NodeJS.ReadableStream,
    caption?: string
  ) {
    const keyParts = path.basename(key, path.extname(key)).split("_");
    const mediaType = keyParts[keyParts.length - 1];
    const source = { source: fileStream };

    const captionOptions = caption
      ? { caption, parse_mode: "MarkdownV2" as const }
      : undefined;
    const voiceCaptionOptions = caption ? { caption } : undefined;

    try {
      switch (mediaType) {
        case "video":
          await this.bot.telegram.sendVideo(chatId, source, captionOptions);
          break;
        case "photo":
          await this.bot.telegram.sendPhoto(chatId, source, captionOptions);
          break;
        case "voice":
          await this.bot.telegram.sendVoice(
            chatId,
            source,
            voiceCaptionOptions
          );
          break;
        case "videonote":
          await this.bot.telegram.sendVideoNote(chatId, source);
          break;
        default:
          await this.bot.telegram.sendDocument(chatId, source, captionOptions);
          break;
      }
    } catch (error) {
      this.logger.error(`Ошибка при отправке медиа файла ${key}:`, error);
      await this.bot.telegram.sendMessage(
        chatId,
        i18next.t("notifications.file_not_found")
      );
    }
  }
}
