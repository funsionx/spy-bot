import type { Context } from "telegraf";
import type { BusinessMessage } from "../types/telegram.js";
import type { ICacheService } from "../services/cache/ICacheService.js";
import { NotificationService } from "../services/notificationService.js";

/**
 * Обработчик изменений сообщений через Telegram Business API
 */
export class MessageEditHandler {
  constructor(private cacheService: ICacheService, private ownerId: number) {}

  /**
   * Обрабатывает отредактированное бизнес-сообщение
   */
  async handleEditedBusinessMessage(ctx: Context): Promise<void> {
    try {
      const update = ctx.update as any;

      if (!update.edited_business_message) {
        return;
      }

      const editedMessage = update.edited_business_message as BusinessMessage;
      await this.handleEditedMessage(ctx, editedMessage);
    } catch (error) {
      console.error(
        "❌ Ошибка при обработке отредактированного сообщения:",
        error
      );
    }
  }

  /**
   * Обрабатывает отредактированное сообщение
   */
  private async handleEditedMessage(
    ctx: Context,
    editedMessage: BusinessMessage
  ): Promise<void> {
    try {
      console.log(
        `🔄 Обнаружено изменение сообщения ID: ${editedMessage.message_id}`
      );

      // Ищем оригинальное сообщение в кэше
      const originalMessage = await this.cacheService.getCachedMessage(
        editedMessage.business_connection_id,
        editedMessage.chat.id,
        editedMessage.message_id
      );

      if (!originalMessage) {
        console.log(
          `⚠️ Оригинальное сообщение не найдено в кэше для ID: ${editedMessage.message_id}`
        );

        // Отправляем уведомление о том, что оригинал не найден
        const chatName = NotificationService.getChatDisplayName(
          editedMessage.chat
        );
        const notification = NotificationService.formatCacheMissNotification(
          chatName,
          [editedMessage.message_id]
        );

        await this.sendNotificationToOwner(ctx, notification);
        return;
      }

      const oldText = originalMessage.text || "";
      const newText =
        editedMessage.text ||
        (originalMessage.s3Key
          ? "(подпись к медиа была изменена/удалена)"
          : "");

      if (oldText === newText) {
        console.log(
          `📝 Текст сообщения ${editedMessage.message_id} не изменился, пропускаем`
        );
        return;
      }

      // Получаем информацию о пользователе и чате
      const userName = editedMessage.from
        ? NotificationService.getUserDisplayName(editedMessage.from)
        : "Неизвестный пользователь";

      const userUsername = editedMessage.from?.username;
      const chatName = NotificationService.getChatDisplayName(
        editedMessage.chat
      );

      // Форматируем и отправляем уведомление
      const notification = NotificationService.formatEditNotification(
        userName,
        userUsername,
        chatName,
        oldText,
        newText,
        originalMessage.s3Key
      );

      await this.sendNotificationToOwner(ctx, notification);

      // Обновляем кэш новым содержимым
      const newCachedMessage: import("../types/telegram").CachedMessage = {
        ...originalMessage, // Берем за основу старое кэшированное сообщение
        ...editedMessage, // Перезаписываем измененными полями
        s3Key: originalMessage.s3Key ?? null, // Убеждаемся, что s3Key сохранен как null, если undefined
      };
      await this.cacheService.cacheMessage(newCachedMessage);

      console.log(
        `✅ Уведомление об изменении отправлено для сообщения ID: ${editedMessage.message_id}`
      );
    } catch (error) {
      console.error("❌ Ошибка при обработке измененного сообщения:", error);
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
   * Проверяет, подключен ли business connection для данного пользователя
   */
  isBusinessConnectionActive(businessConnectionId: string): boolean {
    // В реальном приложении здесь может быть дополнительная логика
    // для проверки активности business connection
    return true;
  }
}
