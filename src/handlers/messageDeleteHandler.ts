import type { Context } from "telegraf";
import type { DeletedBusinessMessages, CachedMessage } from "../types/telegram";
import type { ICacheService } from "../services/cache-service/cache.service.interface";
import { NotificationService } from "../services/notification-service/notification.service";
import type { S3Service } from "../services/s3-service/s3.service";
import { Logger } from "../services/logger-service/logger.service";
import i18next from "../i18n";
import { TelegramService } from "../services/telegram-service/telegram.service";

/**
 * Обработчик удаления сообщений через Telegram Business API
 */
export class MessageDeleteHandler {
  private logger = Logger.getInstance();

  constructor(
    private cacheService: ICacheService,
    private ownerId: number,
    private telegramService: TelegramService,
    private s3Service?: S3Service
  ) {}

  /**
   * Обрабатывает событие удаления бизнес-сообщений
   */
  async handleDeletedBusinessMessages(ctx: Context): Promise<void> {
    const update = ctx.update;
    if (!("deleted_business_messages" in update)) return;

    const deletedMessages =
      update.deleted_business_messages as DeletedBusinessMessages;
    this.logger.info(
      `Обнаружено удаление ${deletedMessages.message_ids.length} сообщений в чате ID: ${deletedMessages.chat.id}`
    );
    await this.processDeletedMessages(ctx, deletedMessages);
  }

  /**
   * Обрабатывает удаленные сообщения
   */
  private async processDeletedMessages(
    ctx: Context,
    deletedMessages: DeletedBusinessMessages
  ): Promise<void> {
    const chatName = NotificationService.getChatDisplayName(
      deletedMessages.chat
    );
    const cachedMessages = await this.cacheService.getCachedMessages(
      deletedMessages.business_connection_id,
      deletedMessages.chat.id,
      deletedMessages.message_ids
    );

    const foundMessages: CachedMessage[] = [];
    const missedMessageIds: number[] = [];

    for (const messageId of deletedMessages.message_ids) {
      const cached = cachedMessages.find((msg) => msg.message_id === messageId);
      cached ? foundMessages.push(cached) : missedMessageIds.push(messageId);
    }

    if (foundMessages.length > 0) {
      await this.sendDeleteNotifications(ctx, foundMessages, chatName);
    }

    if (missedMessageIds.length > 0) {
      const notification = NotificationService.formatCacheMissNotification(
        chatName,
        missedMessageIds
      );
      await ctx.telegram.sendMessage(this.ownerId, notification, {
        parse_mode: "MarkdownV2",
      });
    }

    for (const messageId of deletedMessages.message_ids) {
      await this.cacheService.removeCachedMessage(
        deletedMessages.business_connection_id,
        deletedMessages.chat.id,
        messageId
      );
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
    const messagesByUser = new Map<string, CachedMessage[]>();
    for (const message of deletedMessages) {
      const userId = message.from?.id.toString() || "unknown";
      if (!messagesByUser.has(userId)) {
        messagesByUser.set(userId, []);
      }
      messagesByUser.get(userId)!.push(message);
    }

    for (const userMessages of messagesByUser.values()) {
      if (userMessages.length === 0) continue;

      const firstMessage = userMessages[0];
      if (!firstMessage) continue; // Проверка на существование

      const userName = firstMessage.from
        ? NotificationService.getUserDisplayName(firstMessage.from)
        : i18next.t("common.unknown_user");
      const userUsername = firstMessage.from?.username;
      const usernameLine = userUsername
        ? `\n👤 \`${NotificationService.escapeForCode(userUsername)}\``
        : "";

      if (userMessages.length === 1) {
        // --- Одно удаленное сообщение ---
        const message = userMessages[0];
        if (!message) continue; // Проверка на существование

        const contextNotification = i18next.t("notifications.deleted", {
          userName: NotificationService.escapeMarkdown(userName),
          chatName: NotificationService.escapeMarkdown(chatName),
          usernameLine,
        });

        await ctx.telegram.sendMessage(this.ownerId, contextNotification, {
          parse_mode: "MarkdownV2",
          link_preview_options: { is_disabled: true },
        });

        if (message.s3Key) {
          this.cacheService.setValue(
            `${this.ownerId}:latest_media_key`,
            message.s3Key,
            120
          );
        }

        const deletedCaption = `${i18next.t("common.deleted")}\n${
          message.text || i18next.t("common.message_without_text")
        }`;
        await this.telegramService.sendContentMessage(
          this.ownerId,
          deletedCaption,
          message.s3Key
        );
      } else {
        // --- Несколько удаленных сообщений ---
        const contextNotification = i18next.t(
          "notifications.deleted_multiple",
          {
            userName: NotificationService.escapeMarkdown(userName),
            chatName: NotificationService.escapeMarkdown(chatName),
            usernameLine,
            count: userMessages.length,
          }
        );

        await ctx.telegram.sendMessage(this.ownerId, contextNotification, {
          parse_mode: "MarkdownV2",
          link_preview_options: { is_disabled: true },
        });

        for (let i = 0; i < userMessages.length; i++) {
          const message = userMessages[i];
          if (!message) continue; // Проверка на существование

          const deletedCaption = `${i18next.t("common.deleted_item", {
            index: i + 1,
          })}\n${message.text || i18next.t("common.message_without_text")}`;

          if (message.s3Key) {
            this.cacheService.setValue(
              `${this.ownerId}:latest_media_key`,
              message.s3Key,
              120
            );
          }
          await this.telegramService.sendContentMessage(
            this.ownerId,
            deletedCaption,
            message.s3Key
          );
        }
      }
    }
  }
}
