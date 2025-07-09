import { Context } from "telegraf";
import { Message } from "telegraf/types";
import { BusinessMessage, CachedMessage } from "../types/telegram";
import { ICacheService } from "../services/cache-service/cache.service.interface";
import { S3Service } from "../services/s3-service/s3.service";
import { Logger } from "../services/logger-service/logger.service";

export class BusinessMessageHandler {
  private logger = Logger.getInstance();

  constructor(
    private cacheService: ICacheService,
    private s3Service: S3Service | undefined
  ) {}

  public async handle(ctx: Context) {
    const message = (ctx.update as any).business_message as BusinessMessage;
    if (!message || !message.from) {
      this.logger.warn("Получено сообщение без автора, пропуск.");
      return;
    }

    let textForCache: string;
    let s3Key: string | null = null;

    // Это медиа-сообщение
    if (this.isMediaMessage(message)) {
      if (!this.s3Service) {
        this.logger.warn(
          "Получено медиа-сообщение, но S3 не настроен. Сообщение не будет закэшировано."
        );
        return; // Не кэшируем, если не можем обработать
      }

      const mediaMessage = message as
        | Message.PhotoMessage
        | Message.VideoMessage
        | Message.VoiceMessage
        | Message.VideoNoteMessage
        | Message.DocumentMessage;
      s3Key = await this.s3Service.uploadMedia(mediaMessage);

      if (!s3Key) {
        // Ошибка уже залогирована в s3Service
        this.logger.warn(
          "Загрузка медиа в S3 не удалась, сообщение не будет закэшировано."
        );
        return; // Не кэшируем при ошибке загрузки
      }

      textForCache = (mediaMessage as any).caption || `[Медиафайл]`;
    }
    // Это текстовое сообщение
    else if (message.text) {
      textForCache = message.text;
    }
    // Это что-то другое, что мы не обрабатываем (стикер, локация и т.д.)
    else {
      textForCache = "[Сообщение без текста или неподдерживаемого типа]";
    }

    if (s3Key && this.s3Service) {
      this.s3Service.scheduleFileDeletion(s3Key, 2 * 60 * 1000); // 2 минуты
    }

    const cachedMessage: CachedMessage = {
      ...message,
      text: textForCache,
      s3Key: s3Key,
    };

    await this.cacheService.cacheMessage(cachedMessage);
  }

  private isMediaMessage(message: BusinessMessage): boolean {
    return (
      "photo" in message ||
      "video" in message ||
      "voice" in message ||
      "video_note" in message ||
      "document" in message
    );
  }
}
