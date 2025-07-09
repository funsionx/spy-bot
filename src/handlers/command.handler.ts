import { Telegraf, Markup, Context, Telegram } from "telegraf";
import i18next from "../i18n";
import { ICacheService } from "../services/cache-service/cache.service.interface";
import { S3Service } from "../services/s3-service/s3.service";
import { TelegramService } from "../services/telegram-service/telegram.service";
import { Logger } from "../services/logger-service/logger.service";

export class CommandHandler {
  private logger = Logger.getInstance();

  constructor(
    private ownerId: number,
    private cacheService: ICacheService,
    private s3Service: S3Service | undefined,
    private telegramService: TelegramService
  ) {}

  public register(bot: Telegraf) {
    bot.start(this.handleStart.bind(this));
    bot.command("get_latest_media", this.handleGetLatestMedia.bind(this));
    bot.command("help", this.handleHelp.bind(this));
    bot.command("set_language", this.handleSetLanguage.bind(this));
    bot.action(/set_lang_(ru|en)/, this.handleSetLanguageAction.bind(this));

    this.setupBotCommands(bot.telegram);
  }

  private async handleStart(ctx: Context) {
    const userId = ctx.from?.id;

    if (userId === this.ownerId) {
      await ctx.reply(i18next.t("notifications.welcome"), {
        parse_mode: "MarkdownV2",
        ...Markup.inlineKeyboard([
          Markup.button.url(
            i18next.t("common.tutorial_button"),
            "https://google.com"
          ),
        ]),
      });
      // Отправляем справку следом
      await this.sendHelpMessage(ctx);
    } else {
      await ctx.reply(i18next.t("notifications.access_denied"));
    }
  }

  private async handleGetLatestMedia(ctx: Context) {
    if (ctx.from?.id !== this.ownerId) {
      await ctx.reply(i18next.t("notifications.access_denied_command"));
      return;
    }

    if (!this.s3Service) {
      await ctx.reply(i18next.t("notifications.s3_not_configured"));
      return;
    }

    try {
      const pointerCacheKey = `${ctx.from.id}:latest_media_key`;
      let key: string | null | undefined = await this.cacheService.getValue(
        pointerCacheKey
      );

      if (key) {
        this.logger.info(`Получение медиа по ключу из кэша-указателя: ${key}`);
        // Удаляем ключ, чтобы он не использовался повторно
        await this.cacheService.deleteValue(pointerCacheKey);
      } else {
        this.logger.info(
          `Ключ в кэше-указателе не найден, ищем последний файл в S3...`
        );
        key = await this.s3Service.getLatestMediaKey(ctx.from.id);
      }

      if (key) {
        // Отменяем запланированное удаление, так как пользователь запросил файл
        this.s3Service.cancelFileDeletion(key);

        const fileData = await this.s3Service.getFile(key);
        if (fileData?.body) {
          await this.telegramService.sendMedia(
            ctx.from.id,
            key,
            fileData.body as NodeJS.ReadableStream
          );
          // Удаляем файл сразу после успешной отправки
          await this.s3Service.deleteFile(key);
        } else {
          await ctx.reply(i18next.t("notifications.file_not_found"));
        }
      } else {
        await ctx.reply(i18next.t("notifications.latest_media_not_found"));
      }
    } catch (error) {
      this.logger.error("Ошибка при получении последнего медиафайла:", error);
      await ctx.reply(i18next.t("notifications.get_media_error"));
    }
  }

  private async handleHelp(ctx: Context) {
    if (ctx.from?.id !== this.ownerId) {
      await ctx.reply(i18next.t("notifications.access_denied"));
      return;
    }
    await this.sendHelpMessage(ctx);
  }

  private async handleSetLanguage(ctx: Context) {
    if (ctx.from?.id !== this.ownerId) {
      await ctx.reply(i18next.t("notifications.access_denied_command"));
      return;
    }

    await ctx.reply(i18next.t("language.select"), {
      ...Markup.inlineKeyboard([
        Markup.button.callback("Русский 🇷🇺", "set_lang_ru"),
        Markup.button.callback("English 🇬🇧", "set_lang_en"),
      ]),
    });
  }

  private async handleSetLanguageAction(
    ctx: Context & { match: RegExpExecArray }
  ) {
    const lang = ctx.match[1];
    if (!lang) return;

    const userId = ctx.from?.id;
    if (userId !== this.ownerId) {
      await ctx.answerCbQuery(i18next.t("notifications.access_denied"));
      return;
    }

    // Сохраняем выбор пользователя в Redis
    await this.cacheService.setValue(`user:${userId}:lang`, lang, -1); // -1 TTL для бессрочного хранения
    await i18next.changeLanguage(lang);

    // Обновляем команды на новом языке
    await this.setupBotCommands(ctx.telegram);

    await ctx.editMessageText(i18next.t("language.changed", { lang }));
    await ctx.answerCbQuery();
  }

  private async sendHelpMessage(ctx: any): Promise<void> {
    await ctx.reply(i18next.t("help_text"), { parse_mode: "MarkdownV2" });
  }

  public async setupBotCommands(telegram: Telegram): Promise<void> {
    const commands = [
      {
        command: "start",
        description: i18next.t("commands.start"),
      },
      {
        command: "get_latest_media",
        description: i18next.t("commands.get_latest_media"),
      },
      { command: "help", description: i18next.t("commands.help") },
      {
        command: "set_language",
        description: i18next.t("commands.set_language"),
      },
    ];
    await telegram.setMyCommands(commands);
    this.logger.info("Команды бота настроены");
  }
}
