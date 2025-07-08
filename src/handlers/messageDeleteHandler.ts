import type { Context } from "telegraf";
import type {
  DeletedBusinessMessages,
  CachedMessage,
  PhotoSize,
  Video,
  Audio,
  Document,
  Voice,
  VideoNote,
} from "../types/telegram.js";
import type { ICacheService } from "../services/cache/ICacheService.js";
import { NotificationService } from "../services/notificationService.js";
import type { S3Service } from "../services/s3Service.js";
import { fetch } from "bun";

/**
 * Обработчик удаления сообщений через Telegram Business API
 */
export class MessageDeleteHandler {
  constructor(
    private cacheService: ICacheService,
    private ownerId: number,
    private s3Service?: S3Service
  ) {}

  /**
   * Обрабатывает событие удаления бизнес-сообщений
   */
  async handleDeletedBusinessMessages(ctx: Context): Promise<void> {
    try {
      const update = ctx.update;

      if (!("deleted_business_messages" in update)) {
        return;
      }

      const deletedMessages =
        update.deleted_business_messages as DeletedBusinessMessages;

      console.log(
        `🗑️ Обнаружено удаление ${deletedMessages.message_ids.length} сообщений в чате ID: ${deletedMessages.chat.id}`
      );

      await this.processDeletedMessages(ctx, deletedMessages);
    } catch (error) {
      console.error(
        "❌ Ошибка при обработке удаленных бизнес-сообщений:",
        error
      );
    }
  }

  /**
   * Обрабатывает удаленные сообщения
   */
  private async processDeletedMessages(
    ctx: Context,
    deletedMessages: DeletedBusinessMessages
  ): Promise<void> {
    try {
      // Получаем информацию о чате
      const chatName = NotificationService.getChatDisplayName(
        deletedMessages.chat
      );

      // Ищем удаленные сообщения в кэше
      const cachedMessages = await this.cacheService.getCachedMessages(
        deletedMessages.business_connection_id,
        deletedMessages.chat.id,
        deletedMessages.message_ids
      );

      // Разделяем на найденные и не найденные
      const foundMessages: CachedMessage[] = [];
      const missedMessageIds: number[] = [];

      for (const messageId of deletedMessages.message_ids) {
        const cached = cachedMessages.find(
          (msg) => msg.message_id === messageId
        );
        if (cached) {
          foundMessages.push(cached);
        } else {
          missedMessageIds.push(messageId);
        }
      }

      // Отправляем уведомления о найденных сообщениях
      if (foundMessages.length > 0) {
        await this.sendDeleteNotifications(ctx, foundMessages, chatName);
      }

      // Отправляем уведомление о пропущенных сообщениях
      if (missedMessageIds.length > 0) {
        const notification = NotificationService.formatCacheMissNotification(
          chatName,
          missedMessageIds
        );
        await this.sendNotificationToOwner(ctx, notification);
      }

      // Удаляем обработанные сообщения из кэша
      for (const messageId of deletedMessages.message_ids) {
        await this.cacheService.removeCachedMessage(
          deletedMessages.business_connection_id,
          deletedMessages.chat.id,
          messageId
        );
      }

      console.log(
        `✅ Обработано удаление ${foundMessages.length} из ${deletedMessages.message_ids.length} сообщений`
      );
    } catch (error) {
      console.error("❌ Ошибка при обработке удаленных сообщений:", error);
    }
  }

  /**
   * Отправляет уведомления об удаленных сообщениях
   */
  private async sendDeleteNotifications(
    ctx: Context,
    deletedMessages: CachedMessage[],
    chatName: string
  ): Promise<void> {
    try {
      // Группируем сообщения по пользователям
      const messagesByUser = new Map<string, CachedMessage[]>();

      for (const message of deletedMessages) {
        const userId = message.from?.id.toString() || "unknown";
        if (!messagesByUser.has(userId)) {
          messagesByUser.set(userId, []);
        }
        messagesByUser.get(userId)!.push(message);
      }

      // Отправляем уведомления для каждого пользователя
      for (const [userId, userMessages] of messagesByUser) {
        if (userMessages.length === 0) continue;

        const firstMessage = userMessages[0];
        if (!firstMessage) continue;

        const userName = firstMessage.from
          ? NotificationService.getUserDisplayName(firstMessage.from)
          : "Неизвестный пользователь";

        const userUsername = firstMessage.from?.username;

        if (userMessages.length === 1) {
          // Одно сообщение
          const message = userMessages[0];
          if (!message) continue;

          const s3Key = await this.handleMediaUpload(ctx, message);

          const deletedText =
            message.text || (s3Key ? "[Медиафайл]" : "[Сообщение без текста]");

          const notification = NotificationService.formatDeleteNotification(
            userName,
            userUsername,
            chatName,
            deletedText,
            s3Key
          );
          await this.sendNotificationToOwner(ctx, notification);
        } else {
          // Множественные сообщения
          const deletedTexts: string[] = [];
          for (const msg of userMessages) {
            const s3Key = await this.handleMediaUpload(ctx, msg);
            deletedTexts.push(
              msg.text ||
                (s3Key
                  ? `[Медиафайл, ключ: ${s3Key}]`
                  : "[Сообщение без текста]")
            );
          }

          const notification =
            NotificationService.formatMultipleDeleteNotification(
              userName,
              userUsername,
              chatName,
              deletedTexts
            );
          await this.sendNotificationToOwner(ctx, notification);
        }
      }
    } catch (error) {
      console.error("❌ Ошибка отправки уведомлений об удалении:", error);
    }
  }

  /**
   * Отправляет уведомление владельцу бота
   */
  private async sendNotificationToOwner(
    ctx: Context,
    notification: string
  ): Promise<void> {
    try {
      await ctx.telegram.sendMessage(this.ownerId, notification, {
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.error("❌ Ошибка отправки уведомления владельцу:", error);

      // Пробуем отправить без markdown, если есть проблемы с форматированием
      try {
        await ctx.telegram.sendMessage(
          this.ownerId,
          notification.replace(/[*_`[\]()~>#+=|{}.!-]/g, "")
        );
      } catch (fallbackError) {
        console.error(
          "❌ Критическая ошибка отправки уведомления:",
          fallbackError
        );
      }
    }
  }

  private async handleMediaUpload(
    ctx: Context,
    message: CachedMessage
  ): Promise<string | null> {
    if (!this.s3Service) {
      return null;
    }

    const media =
      message.photo?.[message.photo.length - 1] || // Берем наибольшее разрешение
      message.video ||
      message.audio ||
      message.document ||
      message.voice ||
      message.video_note;

    if (!media) {
      return null;
    }

    try {
      const fileId = media.file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const response = await fetch(fileLink.href);

      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      const fileExtension = this.getFileExtension(media);
      const key = `${message.business_connection_id}/${message.chat.id}/${message.message_id}_${media.file_unique_id}.${fileExtension}`;

      await this.s3Service.uploadFile(key, buffer);
      return key;
    } catch (error) {
      console.error("❌ Ошибка при загрузке медиа в S3:", error);
      return null;
    }
  }

  private getFileExtension(
    media: PhotoSize | Video | Audio | Document | Voice | VideoNote
  ): string {
    // 1. Из имени файла, если оно есть
    if ("file_name" in media && media.file_name) {
      const parts = media.file_name.split(".");
      if (parts.length > 1) {
        const ext = parts.pop()?.toLowerCase();
        if (ext) return ext;
      }
    }

    // 2. Из MIME-типа
    if ("mime_type" in media && media.mime_type) {
      const mimeType = media.mime_type;
      // video/mp4 -> mp4
      // audio/ogg -> ogg
      const parts = mimeType.split("/");
      if (parts.length === 2 && parts[1]) {
        // Стандартные сопоставления
        switch (parts[1]) {
          case "jpeg":
            return "jpg";
          case "mp4":
            return "mp4";
          case "ogg":
            return "ogg";
          case "mpeg":
            return "mp3";
          case "webm":
            return "webm";
          case "png":
            return "png";
          case "gif":
            return "gif";
          default:
            return parts[1];
        }
      }
    }

    // 3. По типу объекта (наименее точный метод)
    if ("width" in media && "height" in media && !("duration" in media))
      return "jpg"; // PhotoSize
    if ("duration" in media && "length" in media) return "mp4"; // VideoNote
    if ("duration" in media && !("length" in media)) return "mp4"; // Video
    if (
      "duration" in media &&
      "mime_type" in media &&
      media.mime_type?.startsWith("audio/")
    )
      return "ogg"; // Voice

    return "bin"; // Не удалось определить
  }

  /**
   * Получает статистику удалений
   */
  getDeleteStats(): {
    totalProcessed: number;
    cacheHits: number;
    cacheMisses: number;
  } {
    // В реальном приложении можно добавить счетчики
    return {
      totalProcessed: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }
}
