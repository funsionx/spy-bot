import type { Context } from "telegraf";
import type { DeletedBusinessMessages, CachedMessage } from "../types/telegram";
import type { ICacheService } from "../services/cache/ICacheService";
import { NotificationService } from "../services/notificationService";
import type { S3Service } from "../services/s3Service";
import { Message } from "telegraf/types";
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

          const deletedText = message.text || "[Сообщение без текста]";
          const s3Key = message.s3Key;

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
          const deletedItems: { text: string; s3Key?: string | null }[] = [];
          for (const msg of userMessages) {
            deletedItems.push({
              text: msg.text || "[Сообщение без текста]",
              s3Key: msg.s3Key ?? null,
            });
          }

          const notification =
            NotificationService.formatMultipleDeleteNotification(
              userName,
              userUsername,
              chatName,
              deletedItems
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
