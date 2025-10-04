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
import { SubscriptionService } from "./services/subscription-service/subscription.service";
import { TributeWebhookHandler } from "./handlers/tribute-webhook.handler";
import { MongoService } from "./services/mongo-service/mongo.service";
import { H } from "@highlight-run/node";

dotenv.config();

H.init({
  projectID: "odz3463e",
  serviceName: "TruthTellerBot",
  environment: "production",
});

class TruthTellerBot {
  private bot: Telegraf;
  private cacheService: ICacheService;
  private s3Service: S3Service | undefined;
  private logger = Logger.getInstance();
  private ownerId: number;

  // Services
  private subscriptionService: SubscriptionService;

  // Handlers
  private commandHandler: CommandHandler;
  private messageEditHandler: MessageEditHandler;
  private messageDeleteHandler: MessageDeleteHandler;
  private businessMessageHandler: BusinessMessageHandler;
  private businessConnectionHandler: BusinessConnectionHandler;
  private tributeWebhookHandler: TributeWebhookHandler;

  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(cacheService: ICacheService) {
    this.validateEnvironmentVariables();

    const botToken = process.env.BOT_TOKEN!;
    this.ownerId = parseInt(process.env.OWNER_ID!, 10);
    this.bot = new Telegraf(botToken);
    this.cacheService = cacheService;

    // Инициализация сервисов
    this.subscriptionService = new SubscriptionService();
    try {
      this.s3Service = new S3Service(this.bot);
    } catch (error) {
      this.logger.warn("S3 Service не настроен, выгрузка медиа отключена.");
      this.s3Service = undefined;
    }
    const telegramService = new TelegramService(this.bot, this.s3Service);

    // Инициализация обработчиков
    this.tributeWebhookHandler = new TributeWebhookHandler(
      this.subscriptionService,
      this.bot
    );
    this.commandHandler = new CommandHandler(
      this.ownerId,
      this.cacheService,
      this.s3Service,
      telegramService,
      this.subscriptionService
    );
    this.messageEditHandler = new MessageEditHandler(
      this.cacheService,
      this.ownerId,
      telegramService,
      this.subscriptionService
    );
    this.messageDeleteHandler = new MessageDeleteHandler(
      this.cacheService,
      this.ownerId,
      telegramService,
      this.s3Service,
      this.subscriptionService
    );
    this.businessMessageHandler = new BusinessMessageHandler(
      this.cacheService,
      this.s3Service,
      this.subscriptionService,
      this.ownerId
    );
    this.businessConnectionHandler = new BusinessConnectionHandler(
      this.ownerId,
      this.cacheService
    );

    this.logger.info("TruthTellerBot инициализирован");
    this.logger.info(`Владелец: ${this.ownerId}`);
  }

  private validateEnvironmentVariables(): void {
    const requiredVars = [
      "BOT_TOKEN",
      "OWNER_ID",
      "WEBHOOK_URL",
      "TRIBUTE_API_KEY",
      "MONGODB_URI",
    ];
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

      const userId = ctx.from?.id;
      if (userId) {
        // Устанавливаем язык для каждого запроса от пользователя
        if (userId === this.ownerId) {
          const userLang = await this.cacheService.getValue(
            `user:${userId}:lang`
          );
          if (userLang && userLang !== i18next.language) {
            await i18next.changeLanguage(userLang);
          }
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
      } else if (
        update.message &&
        update.message.text &&
        update.message.text.startsWith("/start")
      ) {
        // Обработка deep-link: /start ref_<uuid>
        try {
          const text: string = update.message.text as string;
          const parts = text.split(" ");
          const payload = parts[1] || "";
          if (payload.startsWith("ref_")) {
            const refUuid = payload.substring(4);
            await this.subscriptionService.addReferralAndGrant(
              refUuid,
              update.message.from.id
            );
          }
        } catch {}
        return next();
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

      const webhookUrl = process.env.WEBHOOK_URL!;
      const port = parseInt(process.env.PORT || "3000", 10);
      const webhookPath =
        process.env.TELEGRAM_WEBHOOK_PATH ||
        `/telegraf/${this.bot.secretPathComponent()}`;
      await this.bot.telegram.setWebhook(`${webhookUrl}${webhookPath}`, {
        drop_pending_updates: true,
        allowed_updates: [
          "message",
          "callback_query",
          "business_connection",
          "business_message",
          "edited_business_message",
          "deleted_business_messages",
        ] as any,
      });
      this.logger.info(`Веб-хук установлен на: ${webhookUrl}${webhookPath}`);

      // Диагностика состояния вебхука
      try {
        const info = await this.bot.telegram.getWebhookInfo();
        this.logger.info(`WebhookInfo: ${JSON.stringify(info)}`);
      } catch (e) {
        this.logger.warn("Не удалось получить WebhookInfo:", e as any);
      }

      this.server = Bun.serve({
        port,
        fetch: async (request) => {
          const url = new URL(request.url);
          this.logger.info(
            `Входящий запрос: ${request.method} ${url.pathname}`
          );

          if (
            url.pathname === webhookPath ||
            url.pathname === `${webhookPath}/`
          ) {
            this.logger.info("Запрос направлен в Telegraf handler.");
            if (request.method !== "POST") {
              return new Response("Method Not Allowed", { status: 405 });
            }
            const update = await request.json();
            await this.bot.handleUpdate(update);
            return new Response("OK");
          }

          if (url.pathname === "/tribute-webhook") {
            this.logger.info("Запрос направлен в TributeWebhookHandler.");
            return this.tributeWebhookHandler.handle(request);
          }

          if (
            url.pathname === "/" ||
            url.pathname === "/_health" ||
            url.pathname === "/healthz"
          ) {
            return new Response("OK", { status: 200 });
          }

          this.logger.warn(
            `Неизвестный путь: ${url.pathname}. Возвращаем 404 Not Found.`
          );
          return new Response("Not Found", { status: 404 });
        },
      });

      this.logger.info(`Сервер запущен на порту ${this.server.port}`);
    } catch (error) {
      this.logger.error("Не удалось запустить бота:", error);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    this.logger.info("Остановка бота...");
    if (this.server) {
      this.server.stop(true);
      this.logger.info("Веб-сервер остановлен.");
    }
    if (this.s3Service) {
      this.s3Service.cancelAllScheduledDeletions();
    }
    await this.cacheService.disconnect();
    await MongoService.disconnect();
    this.logger.info("Бот остановлен");
  }
}

async function main(): Promise<void> {
  const logger = Logger.getInstance();
  let botInstance: TruthTellerBot | null = null;
  try {
    await initializeI18n();
    const cacheService = await CacheFactory.createFromEnv();
    // Инициализируем подключение к MongoDB при старте
    await MongoService.connect(process.env.MONGODB_URI!);
    botInstance = new TruthTellerBot(cacheService);
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
