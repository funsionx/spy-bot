import NodeCache from "node-cache";
import type { CachedMessage, BusinessMessage } from "../../types/telegram.js";
import type { ICacheService } from "./ICacheService.js";

/**
 * Реализация кэша с использованием node-cache (in-memory)
 */
export class NodeCacheService implements ICacheService {
  private cache: NodeCache;
  private stats = { hits: 0, misses: 0 };

  constructor(ttlSeconds: number = 120) {
    this.cache = new NodeCache({
      stdTTL: ttlSeconds,
      checkperiod: 60,
      useClones: false,
    });

    console.log(`💾 Node-cache инициализирован с TTL: ${ttlSeconds}s`);
  }

  async cacheMessage(message: CachedMessage): Promise<void> {
    const key = this.generateKey(
      message.business_connection_id,
      message.chat.id,
      message.message_id
    );

    this.cache.set(key, message);

    const logText = message.s3Key
      ? `Медиафайл (S3: ${message.s3Key})`
      : `Текст: "${message.text?.slice(0, 50)}..."`;

    console.log(`📝 Сообщение закэшировано (node-cache): ${key} | ${logText}`);
  }

  async getCachedMessage(
    businessConnectionId: string,
    chatId: number,
    messageId: number
  ): Promise<CachedMessage | undefined> {
    const key = this.generateKey(businessConnectionId, chatId, messageId);
    const cached = this.cache.get<CachedMessage>(key);

    if (cached) {
      this.stats.hits++;
      console.log(`✅ Сообщение найдено в node-cache: ${key}`);
    } else {
      this.stats.misses++;
      console.log(`❌ Сообщение не найдено в node-cache: ${key}`);
    }

    return cached;
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
      `📥 Найдено ${messages.length} из ${messageIds.length} сообщений в node-cache`
    );
    return messages;
  }

  async removeCachedMessage(
    businessConnectionId: string,
    chatId: number,
    messageId: number
  ): Promise<void> {
    const key = this.generateKey(businessConnectionId, chatId, messageId);
    this.cache.del(key);
    console.log(`🗑️ Сообщение удалено из node-cache: ${key}`);
  }

  async getStats(): Promise<{ keys: number; hits: number; misses: number }> {
    const cacheStats = this.cache.getStats();
    return {
      keys: cacheStats.keys,
      hits: this.stats.hits,
      misses: this.stats.misses,
    };
  }

  async clearCache(): Promise<void> {
    this.cache.flushAll();
    this.stats = { hits: 0, misses: 0 };
    console.log("🧹 Node-cache полностью очищен");
  }

  async disconnect(): Promise<void> {
    this.cache.close();
    console.log("🔌 Node-cache отключен");
  }

  private generateKey(
    businessConnectionId: string,
    chatId: number,
    messageId: number
  ): string {
    return `${businessConnectionId}:${chatId}:${messageId}`;
  }
}
