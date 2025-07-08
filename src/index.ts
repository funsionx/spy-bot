import { Telegraf, Markup, Context } from "telegraf";
import dotenv from "dotenv";
import { CacheFactory } from "./services/cache/CacheFactory";
import type { ICacheService } from "./services/cache/ICacheService";
import { MessageEditHandler } from "./handlers/messageEditHandler";
import { MessageDeleteHandler } from "./handlers/messageDeleteHandler";
import { NotificationService } from "./services/notificationService";
import { S3Service } from "./services/s3Service";
import { BusinessMessage, CachedMessage } from "./types/telegram";
import { Message } from "telegraf/types";
import path from "path";

// Загружаем переменные окружения
dotenv.config();

/**
 * Telegram Bot "Dialog Spy" - отслеживание изменений и удалений сообщений
 * через Telegram Business API
 */
class DialogSpyBot {
  private bot: Telegraf;
  private cacheService: ICacheService;
  private editHandler: MessageEditHandler;
  private deleteHandler: MessageDeleteHandler;
  private ownerId: number;
  private s3Service: S3Service | undefined;

  constructor(cacheService: ICacheService) {
    this.validateEnvironmentVariables();

    const botToken = process.env.BOT_TOKEN!;
    this.ownerId = parseInt(process.env.OWNER_ID!, 10);
    this.bot = new Telegraf(botToken);

    // Инициализация S3, если настроено
    try {
      this.s3Service = new S3Service(this.bot);
    } catch (error) {
      console.warn("⚠️ S3 Service не настроен, выгрузка медиа отключена.");
      this.s3Service = undefined;
    }

    // Инициализируем сервисы
    this.cacheService = cacheService;
    this.editHandler = new MessageEditHandler(this.cacheService, this.ownerId);
    this.deleteHandler = new MessageDeleteHandler(
      this.cacheService,
      this.ownerId,
      this.s3Service
    );

    console.log("🚀 Dialog Spy Bot инициализирован");
    console.log(`👤 Владелец: ${this.ownerId}`);
  }

  /**
   * Проверяет наличие необходимых переменных окружения
   */
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

  private isMediaMessage(message: BusinessMessage): boolean {
    return (
      "photo" in message ||
      "video" in message ||
      "voice" in message ||
      "video_note" in message
    );
  }

  private async handleNewBusinessMessage(ctx: Context): Promise<void> {
    const message = (ctx.update as any).business_message as BusinessMessage;
    if (!message || !message.from) {
      console.warn("Получено сообщение без автора, пропуск.");
      return;
    }

    let textForCache: string;
    let s3Key: string | null = null;

    // Это медиа-сообщение
    if (this.isMediaMessage(message)) {
      if (!this.s3Service) {
        console.warn(
          "⚠️ Получено медиа-сообщение, но S3 не настроен. Сообщение не будет закэшировано."
        );
        return; // Не кэшируем, если не можем обработать
      }

      const mediaMessage = message as
        | Message.PhotoMessage
        | Message.VideoMessage
        | Message.VoiceMessage
        | Message.VideoNoteMessage;
      s3Key = await this.s3Service.uploadMedia(mediaMessage);

      if (!s3Key) {
        // Ошибка уже залогирована в s3Service
        console.warn(
          "❌ Загрузка медиа в S3 не удалась, сообщение не будет закэшировано."
        );
        return; // Не кэшируем при ошибке загрузки
      }

      textForCache = (mediaMessage as any).caption || `[Медиафайл]`;
    }
    // Это текстовое сообщение
    else if (message.text) {
      textForCache = message.text;
    }
    // Это что-то другое, что мы не обрабатываем (стикер, локация и т.д.)
    else {
      textForCache = "[Сообщение без текста или неподдерживаемого типа]";
    }

    const cachedMessage: CachedMessage = {
      ...message,
      text: textForCache,
      s3Key: s3Key,
    };

    await this.cacheService.cacheMessage(cachedMessage);
  }

  /**
   * Настраивает обработчики событий бота
   */
  private setupEventHandlers(): void {
    // Обработка команды /start
    this.bot.start(async (ctx) => {
      const userId = ctx.from?.id;

      if (userId === this.ownerId) {
        await ctx.reply(
          `🎯 *Добро пожаловать в Dialog Spy Bot\\!*

Этот бот поможет вам отслеживать изменения и удаления в ваших бизнес-чатах\\.`,
          {
            parse_mode: "MarkdownV2",
            ...Markup.inlineKeyboard([
              Markup.button.url("Перейти к обучению", "https://google.com"),
            ]),
          }
        );
        // Отправляем справку следом
        await this.sendHelpMessage(ctx);
      } else {
        await ctx.reply("❌ У вас нет доступа к этому боту.");
      }
    });

    // Команда для просмотра статистики
    this.bot.command("stats", async (ctx) => {
      if (ctx.from?.id !== this.ownerId) {
        await ctx.reply("❌ У вас нет доступа к этой команде.");
        return;
      }

      const stats = await this.cacheService.getStats();
      const notification = NotificationService.formatStatsNotification(stats);

      await ctx.reply(notification, { parse_mode: "MarkdownV2" });
    });

    // Команда для очистки кэша
    this.bot.command("clear", async (ctx) => {
      if (ctx.from?.id !== this.ownerId) {
        await ctx.reply("❌ У вас нет доступа к этой команде.");
        return;
      }

      await this.cacheService.clearCache();
      await ctx.reply("✅ Кэш сообщений очищен.");
    });

    // Команда для получения медиа из S3
    this.bot.command("get_media", async (ctx) => {
      if (ctx.from?.id !== this.ownerId) {
        await ctx.reply("❌ У вас нет доступа к этой команде.");
        return;
      }

      if (!this.s3Service) {
        await ctx.reply("⚠️ S3 сервис не настроен.");
        return;
      }

      const key = ctx.message.text.split(" ")[1];
      if (!key) {
        await ctx.reply(
          "Пожалуйста, укажите ключ файла. Пример: `/get_media <ключ>`"
        );
        return;
      }

      try {
        const fileData = await this.s3Service.getFile(key);

        if (fileData?.body) {
          await this.sendMedia(
            ctx,
            key,
            fileData.body as NodeJS.ReadableStream
          );
        } else {
          await ctx.reply(
            "❌ Не удалось получить файл. Возможно, он не найден."
          );
        }
      } catch (error) {
        console.error("❌ Ошибка при получении файла из S3:", error);
        await ctx.reply("❌ Не удалось получить файл. Проверьте логи.");
      }
    });

    // Команда для получения последнего медиа
    this.bot.command("get_latest_media", async (ctx) => {
      if (ctx.from?.id !== this.ownerId) {
        await ctx.reply("❌ У вас нет доступа к этой команде.");
        return;
      }

      if (!this.s3Service) {
        await ctx.reply("⚠️ S3 сервис не настроен.");
        return;
      }

      try {
        const key = await this.s3Service.getLatestMediaKey(ctx.from.id);
        if (key) {
          const fileData = await this.s3Service.getFile(key);
          if (fileData?.body) {
            await this.sendMedia(
              ctx,
              key,
              fileData.body as NodeJS.ReadableStream
            );
          } else {
            await ctx.reply("❌ Не удалось получить файл.");
          }
        } else {
          await ctx.reply("❌ Последний медиафайл не найден.");
        }
      } catch (error) {
        console.error("❌ Ошибка при получении последнего медиафайла:", error);
        await ctx.reply("❌ Не удалось получить файл. Проверьте логи.");
      }
    });

    // Команда справки
    this.bot.command("help", async (ctx) => {
      if (ctx.from?.id !== this.ownerId) {
        await ctx.reply("❌ У вас нет доступа к этому боту.");
        return;
      }
      await this.sendHelpMessage(ctx);
    });

    // Универсальный обработчик для Business API
    this.bot.use(async (ctx, next) => {
      const update = ctx.update as any;

      // Логирование всех типов событий для отладки
      if (process.env.DEV_MODE === "true") {
        console.log("🔍 Получено событие:", Object.keys(update).join(", "));
      }

      // Обработка новых бизнес-сообщений (только кэширование)
      if (update.business_message) {
        console.log("📨 Получено новое бизнес-сообщение");
        await this.handleNewBusinessMessage(ctx);
        return;
      }

      // Обработка отредактированных бизнес-сообщений
      if (update.edited_business_message) {
        console.log("✏️ Получено отредактированное бизнес-сообщение");
        await this.editHandler.handleEditedBusinessMessage(ctx);
        return;
      }

      // Обработка удаленных бизнес-сообщений
      if (update.deleted_business_messages) {
        console.log("🗑️ Получено событие удаления бизнес-сообщений");
        await this.deleteHandler.handleDeletedBusinessMessages(ctx);
        return;
      }

      // Обработка business_connection для логирования подключений
      if (update.business_connection) {
        try {
          const connection = update.business_connection;
          console.log(
            `🔗 Business connection ${
              connection.is_enabled ? "подключен" : "отключен"
            }: ${connection.id}`
          );

          if (connection.is_enabled) {
            const userName = NotificationService.escapeMarkdown(
              connection.user.first_name
            );
            const connectionId = NotificationService.escapeMarkdown(
              connection.id
            );
            const dateStr = NotificationService.escapeMarkdown(
              new Date(connection.date * 1000).toLocaleString("ru-RU")
            );

            await ctx.telegram.sendMessage(
              this.ownerId,
              `✅ *Business подключение активировано\\!*

🔗 ID: \`${connectionId}\`
👤 Пользователь: ${userName}
📅 Дата: ${dateStr}

Теперь бот будет отслеживать изменения в ваших чатах\\.`,
              { parse_mode: "MarkdownV2" }
            );
          } else {
            const connectionId = NotificationService.escapeMarkdown(
              connection.id
            );

            await ctx.telegram.sendMessage(
              this.ownerId,
              `❌ *Business подключение отключено*

🔗 ID: \`${connectionId}\`

Бот больше не будет отслеживать изменения в чатах\\.`,
              { parse_mode: "MarkdownV2" }
            );
          }
        } catch (error) {
          console.error("❌ Ошибка обработки business_connection:", error);
        }
        return;
      }

      // Передаем управление следующему middleware
      return next();
    });

    // Обработка ошибок
    this.bot.catch((err, ctx) => {
      console.error(`❌ Ошибка в боте для пользователя ${ctx.from?.id}:`, err);
    });

    console.log("✅ Обработчики событий настроены");
  }

  /**
   * Запускает бота
   */
  public async start(): Promise<void> {
    try {
      this.setupEventHandlers();
      await this.setupBotCommands();

      console.log("🚀 Запуск бота...");
      await this.bot.launch();
      console.log("✅ Бот запущен");
    } catch (error) {
      console.error("❌ Не удалось запустить бота:", error);
    }
  }

  /**
   * Останавливает бота
   */
  public async stop(): Promise<void> {
    console.log("🔄 Остановка бота...");
    this.bot.stop("SIGINT");
    await this.cacheService.disconnect();
    console.log("✅ Бот остановлен");
  }

  private async sendHelpMessage(ctx: any): Promise<void> {
    await ctx.reply(
      `📖 *Справка Dialog Spy Bot*

🔍 *Функции:*
• Отслеживание изменений сообщений
• Отслеживание удаленных сообщений
• Сохранение удаленных медиафайлов
• Уведомления в реальном времени

⚙️ *Настройка:*
1\\. Telegram \\> Настройки \\> Business
2\\. Боты для чатов \\> Добавить бота
3\\. Выберите этого бота

🎯 *Команды:*
/start \\- запуск и справка
/stats \\- статистика
/clear \\- очистить кэш
/get\\_media <ключ> \\- получить медиафайл
/get\\_latest\\_media \\- получить последний медиафайл
/help \\- эта справка

⚠️ *Важно:* 
Бот не сохраняет сообщения\\. Все уведомления приходят только в этот чат\\.`,
      { parse_mode: "MarkdownV2" }
    );
  }

  private async setupBotCommands(): Promise<void> {
    const commands = [
      { command: "start", description: "🏁 Запуск и справка" },
      { command: "stats", description: "📊 Статистика работы" },
      { command: "clear", description: "🧹 Очистить кэш" },
      { command: "get_media", description: "🔗 Получить медиа по ключу" },
      {
        command: "get_latest_media",
        description: "🖼️ Получить последнее медиа",
      },
      { command: "help", description: "📖 Справка" },
    ];
    await this.bot.telegram.setMyCommands(commands);
    console.log("✅ Команды бота настроены");
  }

  private async sendMedia(
    ctx: Context,
    key: string,
    fileStream: NodeJS.ReadableStream
  ) {
    const keyParts = path.basename(key, path.extname(key)).split("_");
    const mediaType = keyParts[keyParts.length - 1];
    const source = { source: fileStream };

    try {
      switch (mediaType) {
        case "video":
          await ctx.replyWithVideo(source);
          break;
        case "photo":
          await ctx.replyWithPhoto(source);
          break;
        case "voice":
          await ctx.replyWithVoice(source);
          break;
        case "videonote":
          await ctx.replyWithVideoNote(source);
          break;
        default:
          await ctx.replyWithDocument(source, {
            caption: path.basename(key),
          });
          break;
      }
    } catch (error) {
      console.error(`❌ Ошибка при отправке медиа файла ${key}:`, error);
      await ctx.reply("❌ Не удалось отправить медиа файл.");
    }
  }
}

/**
 * Главная функция для запуска бота
 */
async function main(): Promise<void> {
  let botInstance: DialogSpyBot | null = null;

  try {
    const cacheService = await CacheFactory.createFromEnv();

    botInstance = new DialogSpyBot(cacheService);
    await botInstance.start();
  } catch (error) {
    console.error("❌ Критическая ошибка при инициализации бота:", error);
    process.exit(1);
  }

  // Graceful shutdown
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
