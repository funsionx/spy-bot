import type { Context } from "telegraf";
import type { DeletedBusinessMessages, CachedMessage } from "../types/telegram";
import type { ICacheService } from "../services/cache-service/cache.service.interface";
import { NotificationService } from "../services/notification-service/notification.service";
import type { S3Service } from "../services/s3-service/s3.service";
import { Logger } from "../services/logger-service/logger.service";
import i18next from "../i18n";
import { TelegramService } from "../services/telegram-service/telegram.service";
import { SubscriptionService } from "../services/subscription-service/subscription.service";

/**
 * Обработчик удаления сообщений через Telegram Business API
 */
export class MessageDeleteHandler {
  private logger = Logger.getInstance();

  constructor(
    private cacheService: ICacheService,
    private ownerId: number,
    private telegramService: TelegramService,
    private s3Service: S3Service | undefined,
    private subscriptionService: SubscriptionService
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
    const subscriptionStatus =
      await this.subscriptionService.getUserSubscriptionStatus(this.ownerId);
    const trialActive = await this.subscriptionService.isTrialActive(
      this.ownerId
    );

    if (subscriptionStatus === "FREE" && !trialActive) {
      const trackedChatId = await this.subscriptionService.getTrackedChatId(
        this.ownerId
      );
      if (trackedChatId && trackedChatId !== deletedMessages.chat.id) {
        return;
      }
    }

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
      const usernameLine = userUsername ? `\n@${userUsername}` : "";

      if (userMessages.length === 1) {
        const message = userMessages[0];
        if (!message) continue;

        const hasMedia = !!message.s3Key;
        const mediaIndicator = hasMedia ? " 📎" : "";
        const messageText =
          message.text || i18next.t("common.message_without_text");

        const mediaInfo = hasMedia
          ? i18next.t("notifications.media_info")
          : "";

        const notification = i18next.t("notifications.deleted_v2", {
          mediaIndicator,
          userName,
          usernameLine,
          chatName,
          mediaInfo,
          messageText,
        });

        if (message.s3Key) {
          this.cacheService.setValue(
            `${this.ownerId}:latest_media_key`,
            message.s3Key,
            120
          );
        }

        const sent = await ctx.telegram.sendMessage(
          this.ownerId,
          notification,
          {
            link_preview_options: { is_disabled: true },
            parse_mode: "MarkdownV2",
          }
        );

        if (hasMedia) {
          await this.telegramService.sendContentMessage(
            this.ownerId,
            "",
            message.s3Key,
            sent.message_id
          );
        }
      } else {
        const hasAnyMedia = userMessages.some((msg) => msg.s3Key);
        const mediaIndicator = hasAnyMedia ? " 📎" : "";

        let messagesText = "";
        const mediaMessages: Array<{ s3Key: string; index: number }> = [];

        for (let i = 0; i < userMessages.length; i++) {
          const message = userMessages[i];
          if (!message) continue;

          const messageText =
            message.text || i18next.t("common.message_without_text");
          const msgHasMedia = message.s3Key ? " 📎" : "";
          messagesText += `\n\n*${i + 1}.* ${messageText}${msgHasMedia}`;

          if (message.s3Key) {
            this.cacheService.setValue(
              `${this.ownerId}:latest_media_key`,
              message.s3Key,
              120
            );
            mediaMessages.push({ s3Key: message.s3Key, index: i + 1 });
          }
        }

        const mediaInfo = hasAnyMedia
          ? i18next.t("notifications.media_info")
          : "";

        const notification = i18next.t("notifications.deleted_multiple_v2", {
          count: userMessages.length,
          mediaIndicator,
          userName,
          usernameLine,
          chatName,
          mediaInfo,
          messagesText,
        });

        const sent = await ctx.telegram.sendMessage(
          this.ownerId,
          notification,
          {
            link_preview_options: { is_disabled: true },
            parse_mode: "MarkdownV2",
          }
        );

        for (const mediaMsg of mediaMessages) {
          await this.telegramService.sendContentMessage(
            this.ownerId,
            i18next.t("notifications.media_from_message", {
              index: mediaMsg.index,
            }),
            mediaMsg.s3Key,
            sent.message_id
          );
        }
      }
    }
  }
}
