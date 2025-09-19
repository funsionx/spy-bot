import type { Context } from "telegraf";
import type { BusinessMessage, CachedMessage } from "../types/telegram.js";
import type { ICacheService } from "../services/cache-service/cache.service.interface.js";
import { NotificationService } from "../services/notification-service/notification.service.js";
import { Logger } from "../services/logger-service/logger.service.js";
import i18next from "../i18n.js";
import { TelegramService } from "../services/telegram-service/telegram.service.js";

/**
 * Обработчик изменений сообщений через Telegram Business API
 */
export class MessageEditHandler {
  private logger = Logger.getInstance();
  constructor(
    private cacheService: ICacheService,
    private ownerId: number,
    private telegramService: TelegramService
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

    const originalMessage = await this.cacheService.getCachedMessage(
      editedMessage.business_connection_id,
      editedMessage.chat.id,
      editedMessage.message_id
    );

    if (!originalMessage) {
      this.logger.warn(
        `Оригинальное сообщение не найдено в кэше для ID: ${editedMessage.message_id}`
      );
      const chatName = NotificationService.getChatDisplayName(
        editedMessage.chat
      );
      const notification = NotificationService.formatCacheMissNotification(
        chatName,
        [editedMessage.message_id]
      );
      await ctx.telegram.sendMessage(this.ownerId, notification);
      return;
    }

    const oldText = originalMessage.text || "";
    const newText = editedMessage.text || "";

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

    const contextText = `🔄 ${userName} изменил(а) сообщение в чате с "${chatName}":${usernameLine}`;

    const sent = await ctx.telegram.sendMessage(this.ownerId, contextText, {
      link_preview_options: { is_disabled: true },
    });

    const beforeCaption = `${i18next.t("common.before")}\n${
      oldText || i18next.t("common.message_without_text")
    }`;
    await this.telegramService.sendContentMessage(
      this.ownerId,
      beforeCaption,
      originalMessage.s3Key,
      sent.message_id
    );

    const afterTextContent =
      newText ||
      (originalMessage.s3Key ? "" : i18next.t("common.message_without_text"));

    const afterCaption = `${i18next.t("common.after")}\n${afterTextContent}`;
    await this.telegramService.sendContentMessage(
      this.ownerId,
      afterCaption,
      originalMessage.s3Key,
      sent.message_id
    );

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
