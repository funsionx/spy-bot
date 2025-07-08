/**
 * Сервис для форматирования уведомлений о изменениях и удалениях сообщений
 */
export class NotificationService {
  /**
   * Форматирует уведомление об изменении сообщения
   */
  static formatEditNotification(
    userName: string,
    userUsername: string | undefined,
    chatName: string,
    oldText: string,
    newText: string,
    s3Key?: string | null
  ): string {
    const escapedUserName = this.escapeMarkdown(userName);
    const escapedChatName = this.escapeMarkdown(chatName);
    const usernameLine = userUsername
      ? `\n👤 \`${this.escapeForCode(userUsername)}\``
      : "";

    let notification = `🔄 *${escapedUserName}* изменил\\(а\\) сообщение в чате с "${escapedChatName}":${usernameLine}

*До:*
> ${this.escapeMarkdown(oldText)}

*После:*
> ${this.escapeMarkdown(newText)}`;

    if (s3Key) {
      const command = "/get_latest_media";
      notification += `\n\n🖼️ Чтобы получить медиафайл, используйте команду: \`${this.escapeForCode(
        command
      )}\``;
    }

    return notification;
  }

  /**
   * Форматирует уведомление об удалении сообщения
   */
  static formatDeleteNotification(
    userName: string,
    userUsername: string | undefined,
    chatName: string,
    deletedText: string,
    s3Key?: string | null
  ): string {
    const escapedUserName = this.escapeMarkdown(userName);
    const escapedChatName = this.escapeMarkdown(chatName);
    const escapedText = this.escapeMarkdown(deletedText);
    const usernameLine = userUsername
      ? `\n👤 \`${this.escapeForCode(userUsername)}\``
      : "";

    let notification = `🗑️ *${escapedUserName}* удалил\\(а\\) сообщение в чате с "${escapedChatName}":${usernameLine}

*Удалено:*
> ${escapedText}`;

    if (s3Key) {
      const command = `/get_latest_media`;
      notification += `\n\n🖼️ Медиафайл сохранен\\. Чтобы получить его, используйте команду: \`${this.escapeForCode(
        command
      )}\``;
    }

    return notification;
  }

  /**
   * Форматирует множественное уведомление об удалении сообщений
   */
  static formatMultipleDeleteNotification(
    userName: string,
    userUsername: string | undefined,
    chatName: string,
    deletedMessages: { text: string; s3Key?: string | null }[]
  ): string {
    const escapedUserName = this.escapeMarkdown(userName);
    const escapedChatName = this.escapeMarkdown(chatName);
    const messageCount = deletedMessages.length;
    const usernameLine = userUsername
      ? `\n👤 \`${this.escapeForCode(userUsername)}\``
      : "";

    let notification = `🗑️ *${escapedUserName}* удалил\\(а\\) ${messageCount} сообщений в чате "${escapedChatName}":${usernameLine}\n\n`;

    deletedMessages.forEach((msg, index) => {
      notification += `*Удалено ${index + 1}:*\n> ${this.escapeMarkdown(
        msg.text
      )}\n`;
    });

    if (deletedMessages.some((msg) => msg.s3Key)) {
      const command = "/get_latest_media";
      notification += `\n🖼️ Некоторые сообщения содержали медиа\\. Чтобы получить последний файл, введите: \`${this.escapeForCode(
        command
      )}\``;
    }

    return notification.trim();
  }

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
      return `${firstName} ${lastName}`.trim() || chat.username || "Личный чат";
    }

    return chat.username || "Неизвестный чат";
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
      "Неизвестный пользователь"
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
        ? `сообщение с ID ${messageIds[0]}`
        : `сообщения с ID: ${messageIds.join(", ")}`;

    return `⚠️ В чате "${chatName}" было удалено/изменено ${idsText}, но оригинальный текст не найден в кэше.

Это может произойти, если:
• Сообщение было отправлено до запуска бота
• Кэш был очищен
• Сообщение старше 2 минут`;
  }

  /**
   * Создает уведомление о статистике работы бота
   */
  static formatStatsNotification(stats: {
    keys: number;
    hits: number;
    misses: number;
  }): string {
    return `📊 *Статистика бота:*

🔑 Сообщений в кэше: ${stats.keys}
✅ Попадания в кэш: ${stats.hits}
❌ Промахи кэша: ${stats.misses}
📈 Процент попаданий: ${
      stats.hits + stats.misses > 0
        ? Math.round((stats.hits / (stats.hits + stats.misses)) * 100)
        : 0
    }%`;
  }

  /**
   * Публичный метод для экранирования специальных символов Markdown
   */
  static escapeMarkdownStatic(text: string): string {
    return this.escapeMarkdown(text);
  }
}
