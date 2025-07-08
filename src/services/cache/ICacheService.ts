import type { CachedMessage, BusinessMessage } from "../../types/telegram.js";

/**
 * Интерфейс для сервиса кэширования сообщений
 */
export interface ICacheService {
  /**
   * Кэширует входящее бизнес-сообщение
   */
  cacheMessage(message: BusinessMessage): Promise<void>;

  /**
   * Получает сообщение из кэша по ID
   */
  getCachedMessage(
    businessConnectionId: string,
    chatId: number,
    messageId: number
  ): Promise<CachedMessage | undefined>;

  /**
   * Получает несколько сообщений из кэша по их ID
   */
  getCachedMessages(
    businessConnectionId: string,
    chatId: number,
    messageIds: number[]
  ): Promise<CachedMessage[]>;

  /**
   * Удаляет сообщение из кэша
   */
  removeCachedMessage(
    businessConnectionId: string,
    chatId: number,
    messageId: number
  ): Promise<void>;

  /**
   * Получает статистику кэша
   */
  getStats(): Promise<{ keys: number; hits: number; misses: number }>;

  /**
   * Очищает весь кэш
   */
  clearCache(): Promise<void>;

  /**
   * Закрывает соединение с кэшем (для Redis)
   */
  disconnect(): Promise<void>;
}
