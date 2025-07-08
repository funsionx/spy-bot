import type { ICacheService } from "./ICacheService.js";
import { NodeCacheService } from "./NodeCacheService.js";
import { RedisCacheService } from "./RedisCacheService.js";

/**
 * Фабрика для создания сервиса кэширования
 */
export class CacheFactory {
  /**
   * Создает сервис кэширования в зависимости от конфигурации
   */
  static async createCacheService(
    cacheType: "memory" | "redis" = "memory",
    ttlSeconds: number = 120,
    redisUrl?: string
  ): Promise<ICacheService> {
    if (cacheType === "redis") {
      console.log("🔄 Создание Redis кэша...");
      const redisService = new RedisCacheService(ttlSeconds, redisUrl);

      try {
        await redisService.connect();
        return redisService;
      } catch (error) {
        console.error(
          "❌ Не удалось подключиться к Redis, используем memory кэш:",
          error
        );
        console.log("🔄 Переключение на node-cache...");
        return new NodeCacheService(ttlSeconds);
      }
    }

    console.log("🔄 Создание memory кэша...");
    return new NodeCacheService(ttlSeconds);
  }

  /**
   * Определяет тип кэша из переменных окружения
   */
  static getCacheTypeFromEnv(): "memory" | "redis" {
    const cacheType = process.env.CACHE_TYPE?.toLowerCase();

    if (cacheType === "redis") {
      return "redis";
    }

    return "memory";
  }

  /**
   * Создает кэш на основе переменных окружения
   */
  static async createFromEnv(): Promise<ICacheService> {
    const cacheType = this.getCacheTypeFromEnv();
    const ttlSeconds = parseInt(process.env.CACHE_TTL || "120", 10);
    const redisUrl = process.env.REDIS_URL;

    console.log(`🎛️ Инициализация кэша: ${cacheType.toUpperCase()}`);

    return await this.createCacheService(cacheType, ttlSeconds, redisUrl);
  }
}
