import type { Context } from "telegraf";
import type { DeletedBusinessMessages, CachedMessage } from "../types/telegram";
import type { ICacheService } from "../services/cache-service/cache.service.interface";
import { NotificationService } from "../services/notification-service/notification.service";
import { Logger } from "../services/logger-service/logger.service";
import i18next from "../i18n";
import { TelegramService } from "../services/telegram-service/telegram.service";
import { SubscriptionService } from "../services/subscription-service/subscription.service";
import { UserModel } from "../models/user.model";

/**
 * Обработчик удаления сообщений через Telegram Business API
 */
export class MessageDeleteHandler {
  private logger = Logger.getInstance();

  constructor(
    private cacheService: ICacheService,
    private telegramService: TelegramService,
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
    let user = await UserModel.findOne({
      businessConnectionId: deletedMessages.business_connection_id,
    });

    if (!user || !user.telegramId) {
      try {
        const conn: any = await (ctx.telegram as any).callApi(
          "getBusinessConnection",
          { business_connection_id: deletedMessages.business_connection_id }
        );
        if (conn?.user?.id && conn?.id) {
          await this.subscriptionService.updateUserBusinessConnectionId(
            conn.user.id,
            conn.id
          );
          user = await UserModel.findOne({
            businessConnectionId: deletedMessages.business_connection_id,
          });
        }
      } catch (e) {
        this.logger.warn(
          `Не удалось получить/сохранить business_connection (${deletedMessages.business_connection_id}):`,
          e as any
        );
      }

      if (!user || !user.telegramId) {
        this.logger.warn(
          `User not found for business_connection_id: ${deletedMessages.business_connection_id}`
        );
        return;
      }
    }
    const userId = Number(user.telegramId);

    const subscriptionStatus =
      await this.subscriptionService.getUserSubscriptionStatus(userId);
    const trialActive = await this.subscriptionService.isTrialActive(userId);

    if (subscriptionStatus === "FREE" && !trialActive) {
      const trackedChatId = await this.subscriptionService.getTrackedChatId(
        userId
      );
      if (trackedChatId && trackedChatId !== deletedMessages.chat.id) {
        return;
      }
    }

    const chatNameMd = NotificationService.getChatDisplayMarkdown(
      deletedMessages.chat as any
    );
    const cachedMessages = await this.cacheService.getCachedMessages(
      deletedMessages.business_connection_id,
      deletedMessages.chat.id,
      deletedMessages.message_ids
    );

    const foundMessages: CachedMessage[] = [];

    for (const messageId of deletedMessages.message_ids) {
      const cached = cachedMessages.find((msg) => msg.message_id === messageId);
      if (cached) foundMessages.push(cached);
    }

    if (foundMessages.length > 0) {
      // Фильтруем сообщения, отправленные владельцем бизнес-аккаунта
      const interlocutorMessages = foundMessages.filter(
        (msg) => msg.from?.id !== userId
      );

      if (interlocutorMessages.length > 0) {
        await this.sendDeleteNotifications(
          ctx,
          interlocutorMessages,
          chatNameMd,
          userId
        );
      }
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
    chatNameMd: string,
    ownerId: number
  ): Promise<void> {
    const messagesByUser = new Map<string, CachedMessage[]>();
    for (const message of deletedMessages) {
      const senderKey = message.from?.id?.toString() || "unknown";
      if (!messagesByUser.has(senderKey)) {
        messagesByUser.set(senderKey, []);
      }
      messagesByUser.get(senderKey)!.push(message);
    }

    for (const userMessages of messagesByUser.values()) {
      if (userMessages.length === 0) continue;
      if (!userMessages[0]) continue; // пустая группа на всякий случай

      if (userMessages.length === 1) {
        const message = userMessages[0];
        if (!message) continue;

        const hasMedia = !!message.s3Key;
        const mediaIndicator = hasMedia ? " 📎" : "";
        const messageText =
          message.text || i18next.t("common.message_without_text");
        const hasText =
          !!message.text &&
          message.text !== i18next.t("common.message_without_text");

        const chatNameEsc = chatNameMd;

        const mediaInfo = hasMedia ? i18next.t("notifications.media_info") : "";

        let notification: string;
        if (hasMedia && !hasText) {
          // Медиа без текста — убираем блок ТЕКСТ
          notification = i18next.t("notifications.deleted_media_only_v2", {
            mediaIndicator,
            chatName: chatNameEsc,
            mediaInfo: NotificationService.escapeMarkdown(mediaInfo),
          });
        } else {
          // Есть текст — заворачиваем в код-блок
          const messageTextCode = `\`\`\`${NotificationService.escapeForCode(
            messageText
          )}\`\`\``;
          notification = i18next.t("notifications.deleted_v2", {
            mediaIndicator,
            chatName: chatNameEsc,
            mediaInfo: NotificationService.escapeMarkdown(mediaInfo),
            messageText: messageTextCode,
          });
        }

        if (message.s3Key) {
          this.cacheService.setValue(
            `${ownerId}:latest_media_key`,
            message.s3Key,
            120
          );
        }

        const sent = await ctx.telegram.sendMessage(ownerId, notification, {
          link_preview_options: { is_disabled: true },
          parse_mode: "MarkdownV2",
        });

        if (hasMedia) {
          await this.telegramService.sendContentMessage(
            ownerId,
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
          // Используем (i + 1) вместо `${i + 1}.` чтобы избежать проблем с MarkdownV2
          const hasText =
            !!message.text &&
            message.text !== i18next.t("common.message_without_text");
          messagesText += `\n\n*(${i + 1})*${msgHasMedia}`;
          if (hasText) {
            const code = `\n\n\`\`\`${NotificationService.escapeForCode(
              messageText
            )}\`\`\``;
            messagesText += code;
          }

          if (message.s3Key) {
            this.cacheService.setValue(
              `${ownerId}:latest_media_key`,
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
          chatName: chatNameMd,
          mediaInfo: NotificationService.escapeMarkdown(mediaInfo),
          messagesText,
        });

        const sent = await ctx.telegram.sendMessage(ownerId, notification, {
          link_preview_options: { is_disabled: true },
          parse_mode: "MarkdownV2",
        });

        for (const mediaMsg of mediaMessages) {
          await this.telegramService.sendContentMessage(
            ownerId,
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
