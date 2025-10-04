import type { Context } from "telegraf";
import type { BusinessMessage, CachedMessage } from "../types/telegram.js";
import type { ICacheService } from "../services/cache-service/cache.service.interface.js";
import { NotificationService } from "../services/notification-service/notification.service.js";
import { Logger } from "../services/logger-service/logger.service.js";
import i18next from "../i18n.js";
import { TelegramService } from "../services/telegram-service/telegram.service.js";
import { SubscriptionService } from "../services/subscription-service/subscription.service.js";
import { Markup } from "telegraf";

/**
 * Обработчик изменений сообщений через Telegram Business API
 */
export class MessageEditHandler {
  private logger = Logger.getInstance();
  constructor(
    private cacheService: ICacheService,
    private ownerId: number,
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
    this.logger.info(
      `Обнаружено изменение сообщения ID: ${editedMessage.message_id}`
    );

    const businessUserId = await this.cacheService.getValue(
      `business_connection:${editedMessage.business_connection_id}:user_id`
    );

    if (
      businessUserId &&
      editedMessage.from?.id.toString() === businessUserId
    ) {
      this.logger.info(
        `Пропуск изменения сообщения от владельца бизнес-аккаунта: ${editedMessage.from?.id}`
      );
      return;
    }

    const subscriptionStatus =
      await this.subscriptionService.getUserSubscriptionStatus(this.ownerId);
    const trialActive = await this.subscriptionService.isTrialActive(
      this.ownerId
    );

    if (subscriptionStatus === "FREE" && !trialActive) {
      const trackedChatId = await this.subscriptionService.getTrackedChatId(
        this.ownerId
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
        `${this.ownerId}:latest_media_key`,
        originalMessage.s3Key,
        120
      );
    }

    const userName = editedMessage.from
      ? NotificationService.getUserDisplayName(editedMessage.from)
      : i18next.t("common.unknown_user");
    const chatName = NotificationService.getChatDisplayName(editedMessage.chat);
    const userUsername = editedMessage.from?.username;
    const usernameLine = userUsername ? `\n@${userUsername}` : "";

    const hasMedia = !!originalMessage.s3Key;
    const mediaIndicator = hasMedia ? " 📎" : "";

    const oldTextFormatted =
      oldText || i18next.t("common.message_without_text");
    const newTextFormatted =
      newText || i18next.t("common.message_without_text");

    const mediaInfo = hasMedia ? i18next.t("notifications.media_info") : "";

    const notification = i18next.t("notifications.edited_v2", {
      mediaIndicator,
      userName,
      usernameLine,
      chatName,
      mediaInfo,
      oldTextFormatted,
      newTextFormatted,
    });

    const sent = await ctx.telegram.sendMessage(this.ownerId, notification, {
      link_preview_options: { is_disabled: true },
      parse_mode: "MarkdownV2",
    });

    if (hasMedia) {
      await this.telegramService.sendContentMessage(
        this.ownerId,
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
