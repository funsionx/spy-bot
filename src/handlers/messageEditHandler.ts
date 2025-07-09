import type { Context } from "telegraf";
import type { BusinessMessage, CachedMessage } from "../types/telegram.js";
import type { ICacheService } from "../services/cache/ICacheService.js";
import { NotificationService } from "../services/notificationService.js";
import { Logger } from "../services/logger.js";
import i18next from "../i18n.js";

/**
 * Обработчик изменений сообщений через Telegram Business API
 */
export class MessageEditHandler {
  private logger = Logger.getInstance();
  constructor(
    private cacheService: ICacheService,
    private ownerId: number,
    private sendContentMessage: (
      chatId: number,
      text: string,
      s3Key?: string | null
    ) => Promise<void>
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
      await ctx.telegram.sendMessage(this.ownerId, notification, {
        parse_mode: "MarkdownV2",
      });
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
    const usernameLine = userUsername
      ? `\n👤 \`${NotificationService.escapeForCode(userUsername)}\``
      : "";

    const contextNotification = i18next.t("notifications.edited", {
      userName: NotificationService.escapeMarkdown(userName),
      chatName: NotificationService.escapeMarkdown(chatName),
      usernameLine,
    });

    await ctx.telegram.sendMessage(this.ownerId, contextNotification, {
      parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
    });

    const beforeCaption = `${i18next.t("common.before")}\n${
      oldText || i18next.t("common.message_without_text")
    }`;
    await this.sendContentMessage(
      this.ownerId,
      beforeCaption,
      originalMessage.s3Key
    );

    const afterTextContent =
      newText ||
      (originalMessage.s3Key
        ? "" // Если у медиа удалили подпись, newText будет пустым
        : i18next.t("common.message_without_text"));

    const afterCaption = `${i18next.t("common.after")}\n${afterTextContent}`;
    await this.sendContentMessage(
      this.ownerId,
      afterCaption,
      originalMessage.s3Key
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
