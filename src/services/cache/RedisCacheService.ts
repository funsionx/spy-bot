import { createClient, RedisClientType } from "redis";
import type { CachedMessage, BusinessMessage } from "../../types/telegram.js";
import type { ICacheService } from "./ICacheService.js";

/**
 * Реализация кэша с использованием Redis
 */
export class RedisCacheService implements ICacheService {
  private client: RedisClientType;
  private ttlSeconds: number;
  private stats = { hits: 0, misses: 0 };
  private connected = false;

  constructor(ttlSeconds: number = 120, redisUrl?: string) {
    this.ttlSeconds = ttlSeconds;

    // Создаем клиент Redis
    this.client = createClient({
      url: redisUrl || process.env.REDIS_URL || "redis://localhost:6379",
    });

    // Обработка ошибок
    this.client.on("error", (err: Error) => {
      console.error("❌ Redis ошибка:", err);
    });

    this.client.on("connect", () => {
      console.log("🔗 Подключение к Redis...");
    });

    this.client.on("ready", () => {
      console.log(`✅ Redis подключен с TTL: ${ttlSeconds}s`);
      this.connected = true;
    });

    this.client.on("end", () => {
      console.log("🔌 Redis отключен");
      this.connected = false;
    });
  }

  async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
    }
  }

  async cacheMessage(message: CachedMessage): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    const key = this.generateKey(
      message.business_connection_id,
      message.chat.id,
      message.message_id
    );

    await this.client.setEx(key, this.ttlSeconds, JSON.stringify(message));

    const logText = message.s3Key
      ? `Медиафайл (S3: ${message.s3Key})`
      : `Текст: "${message.text?.slice(0, 50)}..."`;

    console.log(`📝 Сообщение закэшировано (Redis): ${key} | ${logText}`);
  }

  async getCachedMessage(
    businessConnectionId: string,
    chatId: number,
    messageId: number
  ): Promise<CachedMessage | undefined> {
    if (!this.connected) {
      await this.connect();
    }

    const key = this.generateKey(businessConnectionId, chatId, messageId);

    try {
      const cached = await this.client.get(key);

      if (cached) {
        this.stats.hits++;
        console.log(`✅ Сообщение найдено в Redis: ${key}`);
        return JSON.parse(cached) as CachedMessage;
      } else {
        this.stats.misses++;
        console.log(`❌ Сообщение не найдено в Redis: ${key}`);
        return undefined;
      }
    } catch (error) {
      console.error(`❌ Ошибка получения из Redis: ${key}`, error);
      this.stats.misses++;
      return undefined;
    }
  }

  async getCachedMessages(
    businessConnectionId: string,
    chatId: number,
    messageIds: number[]
  ): Promise<CachedMessage[]> {
    const messages: CachedMessage[] = [];

    for (const messageId of messageIds) {
      const cached = await this.getCachedMessage(
        businessConnectionId,
        chatId,
        messageId
      );
      if (cached) {
        messages.push(cached);
      }
    }

    console.log(
      `📥 Найдено ${messages.length} из ${messageIds.length} сообщений в Redis`
    );
    return messages;
  }

  async removeCachedMessage(
    businessConnectionId: string,
    chatId: number,
    messageId: number
  ): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    const key = this.generateKey(businessConnectionId, chatId, messageId);
    await this.client.del(key);
    console.log(`🗑️ Сообщение удалено из Redis: ${key}`);
  }

  async getStats(): Promise<{ keys: number; hits: number; misses: number }> {
    if (!this.connected) {
      await this.connect();
    }

    try {
      // Получаем количество ключей с нашим префиксом
      const keys = await this.client.keys("*:*:*"); // Наш формат ключей
      return {
        keys: keys.length,
        hits: this.stats.hits,
        misses: this.stats.misses,
      };
    } catch (error) {
      console.error("❌ Ошибка получения статистики Redis:", error);
      return {
        keys: 0,
        hits: this.stats.hits,
        misses: this.stats.misses,
      };
    }
  }

  async clearCache(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    try {
      // Получаем все ключи с нашим форматом и удаляем их
      const keys = await this.client.keys("*:*:*");
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      this.stats = { hits: 0, misses: 0 };
      console.log(`🧹 Redis кэш очищен (удалено ${keys.length} ключей)`);
    } catch (error) {
      console.error("❌ Ошибка очистки Redis кэша:", error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.quit();
    }
  }

  private generateKey(
    businessConnectionId: string,
    chatId: number,
    messageId: number
  ): string {
    return `spy:${businessConnectionId}:${chatId}:${messageId}`;
  }
}
