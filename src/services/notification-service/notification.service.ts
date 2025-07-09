import i18next from "../../i18n";

/**
 * Сервис для форматирования уведомлений о изменениях и удалениях сообщений
 */
export class NotificationService {
  /**
   * Получает название чата для отображения
   */
  static getChatDisplayName(chat: {
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  }): string {
    if (chat.title) {
      return chat.title;
    }

    if (chat.type === "private") {
      const firstName = chat.first_name || "";
      const lastName = chat.last_name || "";
      return (
        `${firstName} ${lastName}`.trim() ||
        chat.username ||
        i18next.t("common.private_chat")
      );
    }

    return chat.username || i18next.t("common.unknown_chat");
  }

  /**
   * Получает имя пользователя для отображения
   */
  static getUserDisplayName(user: {
    first_name: string;
    last_name?: string;
    username?: string;
  }): string {
    const firstName = user.first_name || "";
    const lastName = user.last_name || "";
    return (
      `${firstName} ${lastName}`.trim() ||
      user.username ||
      i18next.t("common.unknown_user")
    );
  }

  /**
   * Экранирует специальные символы Markdown
   */
  public static escapeMarkdown(text: string): string {
    if (!text) return "";
    // Полный список символов для экранирования в MarkdownV2
    const toEscape = /[_*[\]()~`>#+\-=|{}.!]/g;
    return text.replace(toEscape, "\\$&");
  }

  /**
   * Экранирует символы для вставки в блок code
   */
  public static escapeForCode(text: string): string {
    if (!text) return "";
    return text.replace(/`/g, "\\`").replace(/\\/g, "\\\\");
  }

  /**
   * Создает уведомление о том, что сообщение не было найдено в кэше
   */
  static formatCacheMissNotification(
    chatName: string,
    messageIds: number[]
  ): string {
    const idsText =
      messageIds.length === 1
        ? `ID ${messageIds[0]}`
        : `IDs: ${messageIds.join(", ")}`;

    return i18next.t("notifications.original_not_found", {
      chatName: this.escapeMarkdown(chatName),
      messageId: idsText,
    });
  }

  /**
   * Публичный метод для экранирования специальных символов Markdown
   */
  static escapeMarkdownStatic(text: string): string {
    return this.escapeMarkdown(text);
  }
}
