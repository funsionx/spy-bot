import NodeCache from "node-cache";
import type { CachedMessage, BusinessMessage } from "../types/telegram.js";

/**
 * Сервис для краткосрочного кэширования сообщений в памяти
 * Используется для отслеживания изменений и удалений сообщений
 */
export class MessageCacheService {
  private cache: NodeCache;

  constructor(ttlSeconds: number = 120) {
    this.cache = new NodeCache({
      stdTTL: ttlSeconds,
      checkperiod: 60, // Проверка устаревших записей каждые 60 секунд
      useClones: false, // Для лучшей производительности
    });

    console.log(`💾 Кэш сообщений инициализирован с TTL: ${ttlSeconds}s`);
  }

  /**
   * Кэширует входящее бизнес-сообщение
   */
  cacheMessage(message: BusinessMessage): void {
    const key = this.generateKey(
      message.business_connection_id,
      message.chat.id,
      message.message_id
    );

    if (!message.from) {
      console.warn(
        `Сообщение ${message.message_id} не имеет автора, пропуск кэширования.`
      );
      return;
    }

    const cachedMessage: CachedMessage = {
      message_id: message.message_id,
      from: message.from,
      chat: message.chat,
      date: message.date,
      business_connection_id: message.business_connection_id,
      ...(message.text && { text: message.text }),
      ...(message.photo && { photo: message.photo }),
      ...(message.video && { video: message.video }),
      ...(message.audio && { audio: message.audio }),
      ...(message.document && { document: message.document }),
      ...(message.voice && { voice: message.voice }),
      ...(message.video_note && { video_note: message.video_note }),
    };

    this.cache.set(key, cachedMessage);

    const mediaType = this.getMediaType(message);
    const logText = mediaType || `Текст: "${message.text?.slice(0, 50)}..."`;

    console.log(`📝 Сообщение закэшировано: ${key} | ${logText}`);
  }

  /**
   * Получает сообщение из кэша по ID
   */
  getCachedMessage(
    businessConnectionId: string,
    chatId: number,
    messageId: number
  ): CachedMessage | undefined {
    const key = this.generateKey(businessConnectionId, chatId, messageId);
    const cached = this.cache.get<CachedMessage>(key);

    if (cached) {
      console.log(`✅ Сообщение найдено в кэше: ${key}`);
    } else {
      console.log(`❌ Сообщение не найдено в кэше: ${key}`);
    }

    return cached;
  }

  /**
   * Получает несколько сообщений из кэша по их ID
   */
  getCachedMessages(
    businessConnectionId: string,
    chatId: number,
    messageIds: number[]
  ): CachedMessage[] {
    const messages: CachedMessage[] = [];

    for (const messageId of messageIds) {
      const cached = this.getCachedMessage(
        businessConnectionId,
        chatId,
        messageId
      );
      if (cached) {
        messages.push(cached);
      }
    }

    console.log(
      `📥 Найдено ${messages.length} из ${messageIds.length} сообщений в кэше`
    );
    return messages;
  }

  /**
   * Удаляет сообщение из кэша
   */
  removeCachedMessage(
    businessConnectionId: string,
    chatId: number,
    messageId: number
  ): void {
    const key = this.generateKey(businessConnectionId, chatId, messageId);
    this.cache.del(key);
    console.log(`🗑️ Сообщение удалено из кэша: ${key}`);
  }

  /**
   * Генерирует уникальный ключ для кэша
   */
  private generateKey(
    businessConnectionId: string,
    chatId: number,
    messageId: number
  ): string {
    return `${businessConnectionId}:${chatId}:${messageId}`;
  }

  /**
   * Определяет тип медиа в сообщении для логирования
   */
  private getMediaType(message: BusinessMessage): string | null {
    if (message.photo) return "Фото";
    if (message.video) return "Видео";
    if (message.audio) return "Аудио";
    if (message.document) return "Документ";
    if (message.voice) return "Голосовое сообщение";
    if (message.video_note) return "Видеокружок";
    return null;
  }

  /**
   * Получает статистику кэша
   */
  getStats(): { keys: number; hits: number; misses: number } {
    const stats = this.cache.getStats();
    return {
      keys: stats.keys,
      hits: stats.hits,
      misses: stats.misses,
    };
  }

  /**
   * Очищает весь кэш
   */
  clearCache(): void {
    this.cache.flushAll();
    console.log("🧹 Кэш полностью очищен");
  }
}
