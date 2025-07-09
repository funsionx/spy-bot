import { Telegraf, Context } from "telegraf";
import dotenv from "dotenv";
import { CacheFactory } from "./services/cache-service/cache.factory";
import type { ICacheService } from "./services/cache-service/cache.service.interface";
import { MessageEditHandler } from "./handlers/messageEditHandler";
import { MessageDeleteHandler } from "./handlers/messageDeleteHandler";
import { S3Service } from "./services/s3-service/s3.service";
import i18next, { initializeI18n } from "./i18n";
import { Logger } from "./services/logger-service/logger.service";
import { TelegramService } from "./services/telegram-service/telegram.service";
import { CommandHandler } from "./handlers/command.handler";
import { BusinessMessageHandler } from "./handlers/business-message.handler";
import { BusinessConnectionHandler } from "./handlers/business-connection.handler";

dotenv.config();

class DialogSpyBot {
  private bot: Telegraf;
  private cacheService: ICacheService;
  private s3Service: S3Service | undefined;
  private logger = Logger.getInstance();
  private ownerId: number;

  // Handlers
  private commandHandler: CommandHandler;
  private messageEditHandler: MessageEditHandler;
  private messageDeleteHandler: MessageDeleteHandler;
  private businessMessageHandler: BusinessMessageHandler;
  private businessConnectionHandler: BusinessConnectionHandler;

  constructor(cacheService: ICacheService) {
    this.validateEnvironmentVariables();

    const botToken = process.env.BOT_TOKEN!;
    this.ownerId = parseInt(process.env.OWNER_ID!, 10);
    this.bot = new Telegraf(botToken);
    this.cacheService = cacheService;

    // Инициализация сервисов
    try {
      this.s3Service = new S3Service(this.bot);
    } catch (error) {
      this.logger.warn("S3 Service не настроен, выгрузка медиа отключена.");
      this.s3Service = undefined;
    }
    const telegramService = new TelegramService(this.bot, this.s3Service);

    // Инициализация обработчиков
    this.commandHandler = new CommandHandler(
      this.ownerId,
      this.cacheService,
      this.s3Service,
      telegramService
    );
    this.messageEditHandler = new MessageEditHandler(
      this.cacheService,
      this.ownerId,
      telegramService
    );
    this.messageDeleteHandler = new MessageDeleteHandler(
      this.cacheService,
      this.ownerId,
      telegramService,
      this.s3Service
    );
    this.businessMessageHandler = new BusinessMessageHandler(
      this.cacheService,
      this.s3Service
    );
    this.businessConnectionHandler = new BusinessConnectionHandler(
      this.ownerId
    );

    this.logger.info("Dialog Spy Bot инициализирован");
    this.logger.info(`Владелец: ${this.ownerId}`);
  }

  private validateEnvironmentVariables(): void {
    const requiredVars = ["BOT_TOKEN", "OWNER_ID"];
    for (const varName of requiredVars) {
      if (!process.env[varName]) {
        throw new Error(`❌ Переменная окружения ${varName} не установлена`);
      }
    }
    const ownerId = parseInt(process.env.OWNER_ID!, 10);
    if (isNaN(ownerId)) {
      throw new Error("❌ OWNER_ID должен быть числом");
    }
  }

  private async setupEventHandlers(): Promise<void> {
    this.commandHandler.register(this.bot);

    this.bot.use(async (ctx, next) => {
      const update = ctx.update as any;

      if (process.env.DEV_MODE === "true") {
        this.logger.debug("Получено событие:", Object.keys(update).join(", "));
      }

      if (ctx.from?.id === this.ownerId) {
        const userLang = await this.cacheService.getValue(
          `user:${ctx.from.id}:lang`
        );
        if (userLang && userLang !== i18next.language) {
          await i18next.changeLanguage(userLang);
        }
      }

      if (update.business_message) {
        await this.businessMessageHandler.handle(ctx);
      } else if (update.edited_business_message) {
        await this.messageEditHandler.handleEditedBusinessMessage(ctx);
      } else if (update.deleted_business_messages) {
        await this.messageDeleteHandler.handleDeletedBusinessMessages(ctx);
      } else if (update.business_connection) {
        await this.businessConnectionHandler.handle(ctx);
      } else {
        return next();
      }
    });

    this.bot.catch((err, ctx) => {
      this.logger.error(
        `Глобальная ошибка в боте (updateType: ${ctx.updateType}):`,
        err
      );
    });

    this.logger.info("Обработчики событий настроены");
  }

  public async start(): Promise<void> {
    try {
      await this.setupEventHandlers();
      this.logger.info("Запуск бота...");
      await this.bot.launch();
      this.logger.info("Бот запущен");
    } catch (error) {
      this.logger.error("Не удалось запустить бота:", error);
    }
  }

  public async stop(): Promise<void> {
    this.logger.info("Остановка бота...");
    this.bot.stop("SIGINT");
    if (this.s3Service) {
      this.s3Service.cancelAllScheduledDeletions();
    }
    await this.cacheService.disconnect();
    this.logger.info("Бот остановлен");
  }
}

async function main(): Promise<void> {
  const logger = Logger.getInstance();
  let botInstance: DialogSpyBot | null = null;
  try {
    await initializeI18n();
    const cacheService = await CacheFactory.createFromEnv();
    botInstance = new DialogSpyBot(cacheService);
    await botInstance.start();
  } catch (error) {
    logger.error("Критическая ошибка при инициализации бота:", error);
    process.exit(1);
  }

  const shutdown = async () => {
    if (botInstance) {
      await botInstance.stop();
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
