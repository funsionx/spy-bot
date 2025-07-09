import type { CachedMessage } from "../../types/telegram";

/**
 * Интерфейс для сервиса кэширования сообщений
 */
export interface ICacheService {
  /**
   * Кэширует входящее бизнес-сообщение
   */
  cacheMessage(message: CachedMessage): Promise<void>;

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
   * Закрывает соединение с кэшем (для Redis)
   */
  disconnect(): Promise<void>;

  /**
   * Устанавливает простое значение ключ-значение с TTL
   * @param key Ключ
   * @param value Значение
   * @param ttlSeconds Время жизни в секундах. -1 для бессрочного хранения.
   */
  setValue(key: string, value: string, ttlSeconds: number): Promise<void>;

  /**
   * Получает простое значение по ключу
   */
  getValue(key: string): Promise<string | null>;

  /**
   * Удаляет значение по ключу
   */
  deleteValue(key: string): Promise<void>;
}
