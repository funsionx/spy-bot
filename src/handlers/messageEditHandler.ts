import type { Context } from "telegraf";
import type { BusinessMessage, CachedMessage } from "../types/telegram.js";
import type { ICacheService } from "../services/cache-service/cache.service.interface.js";
import { NotificationService } from "../services/notification-service/notification.service.js";
import { Logger } from "../services/logger-service/logger.service.js";
import i18next from "../i18n.js";
import { TelegramService } from "../services/telegram-service/telegram.service.js";
import { SubscriptionService } from "../services/subscription-service/subscription.service.js";
import { UserModel } from "../models/user.model.js";
import { sendMarkdownMessage } from "../utils/markdown-sender.js";

/**
 * Обработчик изменений сообщений через Telegram Business API
 */
export class MessageEditHandler {
  private logger = Logger.getInstance();
  constructor(
    private cacheService: ICacheService,
    private telegramService: TelegramService,
    private subscriptionService: SubscriptionService
  ) {}

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
      this.logger.error(
        "Ошибка при обработке отредактированного сообщения:",
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
    let user = await UserModel.findOne({
      businessConnectionId: editedMessage.business_connection_id,
    });

    if (!user || !user.telegramId) {
      try {
        const conn: any = await (ctx.telegram as any).callApi(
          "getBusinessConnection",
          { business_connection_id: editedMessage.business_connection_id }
        );
        if (conn?.user?.id && conn?.id) {
          await this.subscriptionService.updateUserBusinessConnectionId(
            conn.user.id,
            conn.id,
            conn.user?.username || null
          );
          user = await UserModel.findOne({
            businessConnectionId: editedMessage.business_connection_id,
          });
        }
      } catch (e) {
        this.logger.warn(
          `Не удалось получить/сохранить business_connection (${editedMessage.business_connection_id}):`,
          e as any
        );
      }

      if (!user || !user.telegramId) {
        this.logger.warn(
          `User not found for business_connection_id: ${editedMessage.business_connection_id}`
        );
        return;
      }
    }
    const userId = Number(user.telegramId);

    if (editedMessage.from?.id === userId) {
      this.logger.info(
        `[EDIT] Skipping notification because message sender (${editedMessage.from?.id}) is the bot owner (${userId}).`
      );
      return;
    }

    const subscriptionStatus =
      await this.subscriptionService.getUserSubscriptionStatus(userId);
    const trialActive = await this.subscriptionService.isTrialActive(userId);

    if (subscriptionStatus === "FREE" && !trialActive) {
      const trackedChatId = await this.subscriptionService.getTrackedChatId(
        userId
      );
      if (trackedChatId && trackedChatId !== editedMessage.chat.id) {
        return;
      }
    }

    const originalMessage = await this.cacheService.getCachedMessage(
      editedMessage.business_connection_id,
      editedMessage.chat.id,
      editedMessage.message_id
    );

    if (!originalMessage) {
      const notificationCacheKey = `notification:original_not_found:${editedMessage.business_connection_id}:${editedMessage.chat.id}:${editedMessage.message_id}`;
      const alreadyNotified = await this.cacheService.getValue(
        notificationCacheKey
      );

      if (!alreadyNotified) {
        this.logger.warn(
          `Оригинальное сообщение не найдено в кэше для ID: ${editedMessage.message_id}`
        );
        // Отправка уведомления пользователю может быть здесь, если это необходимо
        await this.cacheService.setValue(notificationCacheKey, "true", 300); // Блокировка на 5 минут
      }
      return;
    }

    const oldText = originalMessage.text || "";
    const newText = editedMessage.text || editedMessage.caption || "";

    if (oldText === newText) {
      this.logger.info(
        `Текст сообщения ${editedMessage.message_id} не изменился, пропускаем`
      );
      return;
    }

    if (originalMessage.s3Key) {
      this.cacheService.setValue(
        `${userId}:latest_media_key`,
        originalMessage.s3Key,
        120
      );
    }

    const chatNameMd = NotificationService.getChatDisplayMarkdown(
      editedMessage.chat
    );
    const hasMedia = !!originalMessage.s3Key;
    const mediaIndicator = hasMedia ? " 📎" : "";

    const oldTextFormattedRaw =
      oldText || i18next.t("common.message_without_text");
    const newTextFormattedRaw =
      newText || i18next.t("common.message_without_text");

    const notification = i18next.t("notifications.edited_v2", {
      mediaIndicator,
      chatName: chatNameMd,
      mediaInfo: hasMedia ? i18next.t("notifications.media_info") : "",
      oldTextFormatted: NotificationService.escapeForCode(oldTextFormattedRaw),
      newTextFormatted: NotificationService.escapeForCode(newTextFormattedRaw),
    });

    const sent = await sendMarkdownMessage(ctx.telegram, userId, notification, {
      link_preview_options: { is_disabled: true },
    });

    if (hasMedia) {
      await this.telegramService.sendContentMessage(
        userId,
        "",
        originalMessage.s3Key,
        sent.message_id
      );
    }

    const newCachedMessage: CachedMessage = {
      ...originalMessage,
      ...editedMessage,
      text: newText,
      s3Key: originalMessage.s3Key ?? null,
    };
    await this.cacheService.cacheMessage(newCachedMessage);

    this.logger.info(
      `Уведомление об изменении отправлено для сообщения ID: ${editedMessage.message_id}`
    );
  }
}
