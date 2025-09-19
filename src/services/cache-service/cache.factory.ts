import type { ICacheService } from "./cache.service.interface.js";
import { RedisCacheService } from "./redis-cache.service.js";
import { Logger } from "../logger-service/logger.service.js";

/**
 * Фабрика для создания сервиса кэширования
 */
export class CacheFactory {
  private static logger = Logger.getInstance();

  /**
   * Создает сервис кэширования Redis
   */
  static async createCacheService(
    ttlSeconds: number = 120,
    redisUrl?: string
  ): Promise<ICacheService> {
    this.logger.info("Создание Redis кэша...");
    const redisService = new RedisCacheService(ttlSeconds, redisUrl);

    try {
      await redisService.connect();
      return redisService;
    } catch (error) {
      this.logger.error(
        "Не удалось подключиться к Redis. Проверьте REDIS_URL/REDIS_PASSWORD.",
        error
      );
      throw new Error("Не удалось подключиться к Redis.");
    }
  }

  /**
   * Создает кэш на основе переменных окружения
   */
  static async createFromEnv(): Promise<ICacheService> {
    const ttlSeconds = parseInt(process.env.CACHE_TTL || "120", 10);
    const redisUrl = process.env.REDIS_URL || "redis://redis:6379";

    this.logger.info(`Инициализация Redis кэша...`);

    return await this.createCacheService(ttlSeconds, redisUrl);
  }
}
