import { Telegraf, Markup, Context, Telegram } from "telegraf";
import i18next from "../i18n";
import { ICacheService } from "../services/cache-service/cache.service.interface";
import { S3Service } from "../services/s3-service/s3.service";
import { TelegramService } from "../services/telegram-service/telegram.service";
import { Logger } from "../services/logger-service/logger.service";
import { SubscriptionService } from "../services/subscription-service/subscription.service";

export class CommandHandler {
  private logger = Logger.getInstance();

  constructor(
    private cacheService: ICacheService,
    private s3Service: S3Service | undefined,
    private telegramService: TelegramService,
    private subscriptionService?: SubscriptionService
  ) {}

  public register(bot: Telegraf) {
    bot.start(this.handleStart.bind(this));
    bot.command("get_latest_media", this.handleGetLatestMedia.bind(this));
    bot.command("help", this.handleHelp.bind(this));
    bot.command("set_language", this.handleSetLanguage.bind(this));
    bot.command("premium", this.handlePremium.bind(this));
    bot.command("referral", this.handleReferral.bind(this));
    bot.command("feedback", this.handleFeedback.bind(this));
    bot.action(/choose_chat_\-?\d+/, this.handleChooseChat.bind(this));
    bot.action("invite_referral", this.handleInviteReferral.bind(this));
    bot.action(/set_lang_(ru|en)/, this.handleSetLanguageAction.bind(this));

    this.setupBotCommands(bot.telegram);
  }

  private async handleStart(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Обработка deep-link: /start ref_<uuid>
    if (ctx.message && "text" in ctx.message) {
      const text: string = ctx.message.text;
      const parts = text.split(" ");
      const payload = parts[1] || "";
      if (payload.startsWith("ref_")) {
        try {
          const refUuid = payload.substring(4);
          if (this.subscriptionService) {
            await this.subscriptionService.addReferralAndGrant(refUuid, userId);
          }
        } catch (e) {
          this.logger.warn(`Ошибка обработки реферального кода: ${payload}`, e);
        }
      }
    }

    // Создаем/обновляем пользователя в базе
    try {
      if (this.subscriptionService) {
        const user = await this.subscriptionService.findOrCreateUser(userId);
        // Отправляем приветствие отдельным сообщением без MarkdownV2
        await ctx.reply(i18next.t("notifications.welcome"));

        // Затем отправляем реферальную ссылку отдельным сообщением
        const botInfo = await (ctx.telegram as any).getMe();
        const botUsername: string = botInfo.username;
        const link = this.subscriptionService.getReferralLink(
          botUsername,
          user.userUuid
        );
        const text = `${i18next.t("referral.title")}\n\n${link}`;
        await ctx.reply(text, {
          ...Markup.inlineKeyboard([
            [Markup.button.url(i18next.t("referral.button_open"), link)],
          ]),
        });
      } else {
        await ctx.reply(i18next.t("notifications.welcome"));
      }
    } catch (e) {
      this.logger.warn(
        "Не удалось создать пользователя / выдать рефссылку:",
        e
      );
    }

    await this.sendHelpMessage(ctx);
  }

  private async handlePremium(ctx: Context) {
    // Доступ всем
    await ctx.reply(i18next.t("premium.info"), {
      ...Markup.inlineKeyboard([
        Markup.button.url(
          i18next.t("premium.buy_button"),
          process.env.TRIBUTE_PREMIUM_URL ||
            "https://t.me/tribute/app?startapp=sxl5"
        ),
      ]),
    });
  }

  private async handleGetLatestMedia(ctx: Context) {
    // Ограничим только отсутствием S3
    if (!this.s3Service) {
      await ctx.reply(i18next.t("notifications.s3_not_configured"));
      return;
    }

    if (!ctx.from?.id) {
      this.logger.warn("Пользователь не авторизован");
      return;
    }

    try {
      const pointerCacheKey = `${ctx?.from?.id}:latest_media_key`;
      let key: string | null | undefined = await this.cacheService.getValue(
        pointerCacheKey
      );

      if (key) {
        this.logger.info(`Получение медиа по ключу из кэша-указателя: ${key}`);
        await this.cacheService.deleteValue(pointerCacheKey);
      } else {
        this.logger.info(
          `Ключ в кэше-указателе не найден, ищем последний файл в S3...`
        );
        key = await this.s3Service.getLatestMediaKey(ctx.from.id);
      }

      if (key) {
        this.s3Service.cancelFileDeletion(key);

        const fileData = await this.s3Service.getFile(key);
        if (fileData?.body) {
          await this.telegramService.sendMedia(
            ctx.from.id,
            key,
            fileData.body as NodeJS.ReadableStream
          );
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
    await this.sendHelpMessage(ctx);
  }

  private async handleSetLanguage(ctx: Context) {
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

    await this.cacheService.setValue(`user:${userId}:lang`, lang, -1);
    await i18next.changeLanguage(lang);

    await this.setupBotCommands(ctx.telegram);

    await ctx.editMessageText(i18next.t("language.changed", { lang }));
    await ctx.answerCbQuery();
  }

  private async sendHelpMessage(ctx: any): Promise<void> {
    const help = i18next.t("help_text");
    // Отправляем как простой текст без Markdown, чтобы избежать ошибок экранирования
    await ctx.reply(help);
  }

  private async handleReferral(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) return;
    const botInfo = await (ctx.telegram as any).getMe();
    const botUsername: string = botInfo.username;

    if (!this.subscriptionService) {
      await ctx.reply(i18next.t("notifications.service_unavailable"));
      return;
    }
    const user = await this.subscriptionService.findOrCreateUser(userId);
    const link = this.subscriptionService.getReferralLink(
      botUsername,
      user.userUuid
    );
    const text = `${i18next.t("referral.title")}\n\n${link}`;
    await ctx.reply(text, {
      ...Markup.inlineKeyboard([
        Markup.button.url(i18next.t("referral.button_open"), link),
      ]),
    });
  }

  private async handleInviteReferral(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) return;
    if (!this.subscriptionService) {
      await ctx.answerCbQuery(i18next.t("notifications.service_unavailable"), {
        show_alert: true,
      });
      return;
    }
    const botInfo = await (ctx.telegram as any).getMe();
    const botUsername: string = botInfo.username;
    const user = await this.subscriptionService.findOrCreateUser(userId);
    const link = this.subscriptionService.getReferralLink(
      botUsername,
      user.userUuid
    );
    const text = `${i18next.t("referral.title")}\n\n${link}`;
    await (ctx as any).reply(text, {
      ...Markup.inlineKeyboard([
        [Markup.button.url(i18next.t("referral.button_open"), link)],
      ]),
    });
    await ctx.answerCbQuery();
  }

  private async handleFeedback(ctx: Context) {
    await ctx.reply(i18next.t("feedback.prompt"));
  }

  private async handleChooseChat(ctx: Context & { match: RegExpExecArray }) {
    const userId = ctx.from?.id;
    if (!userId) return;
    if (!this.subscriptionService) return;
    // Парсим chatId из callback data
    const data = (ctx as any).callbackQuery?.data as string;
    const chatIdStr = data?.split("choose_chat_")[1];
    const chatId = chatIdStr ? parseInt(chatIdStr, 10) : NaN;
    if (Number.isNaN(chatId)) {
      await ctx.answerCbQuery(i18next.t("notifications.invalid_chat"), {
        show_alert: true,
      });
      return;
    }
    await this.subscriptionService.setTrackedChatId(userId, chatId);
    await ctx.editMessageText(i18next.t("limits.chat_selected"));
    await ctx.answerCbQuery();
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
      { command: "premium", description: i18next.t("commands.premium") },
      { command: "referral", description: i18next.t("commands.referral") },
      { command: "feedback", description: i18next.t("commands.feedback") },
    ];
    await telegram.setMyCommands(commands);
    this.logger.info("Команды бота настроены");
  }
}
