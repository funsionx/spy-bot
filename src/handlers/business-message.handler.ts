import { Context, Markup } from "telegraf";
import { Message } from "telegraf/types";
import { BusinessMessage, CachedMessage } from "../types/telegram";
import { ICacheService } from "../services/cache-service/cache.service.interface";
import { S3Service } from "../services/s3-service/s3.service";
import { Logger } from "../services/logger-service/logger.service";
import { SubscriptionService } from "../services/subscription-service/subscription.service";
import i18next from "../i18n";
import { IUser, UserModel } from "../models/user.model";

export class BusinessMessageHandler {
  private logger = Logger.getInstance();

  constructor(
    private cacheService: ICacheService,
    private s3Service: S3Service | undefined,
    private subscriptionService: SubscriptionService
  ) {}

  public async handle(ctx: Context) {
    const message = (ctx.update as any).business_message as BusinessMessage;
    if (!message || !message.from) {
      this.logger.warn("Получено сообщение без автора, пропуск.");
      return;
    }

    let user: IUser | null = await UserModel.findOne({
      businessConnectionId: message.business_connection_id,
    });

    if (!user || !user.telegramId) {
      // Пытаемся самовосстановиться без ownerId: получаем связь через Bot API и линкуем её к владельцу (user.id) бизнес-аккаунта
      try {
        const conn: any = await (ctx.telegram as any).callApi(
          "getBusinessConnection",
          { business_connection_id: message.business_connection_id }
        );
        if (conn?.user?.id && conn?.id) {
          await this.subscriptionService.updateUserBusinessConnectionId(
            conn.user.id,
            conn.id
          );
          user = await UserModel.findOne({
            businessConnectionId: message.business_connection_id,
          });
        }
      } catch (e) {
        this.logger.warn(
          `Не удалось получить/сохранить business_connection (${message.business_connection_id}):`,
          e as any
        );
      }

      if (!user || !user.telegramId) {
        this.logger.warn(
          `User not found for business_connection_id: ${message.business_connection_id}. Caching message but skipping logic.`
        );
        await this.cacheOriginalMessage(message);
        return;
      }
    }

    const userId = Number(user.telegramId);

    // Если это сообщение от владельца, просто кэшируем его и выходим.
    // Вся остальная логика (лимиты и т.д.) применяется только к собеседникам.
    if (message.from.id === userId) {
      await this.cacheOriginalMessage(message);
      return;
    }

    const subscriptionStatus =
      await this.subscriptionService.getUserSubscriptionStatus(userId);
    const trialActive = await this.subscriptionService.isTrialActive(userId);

    // Ограничение на 1 чат для FREE-пользователей после окончания триала
    if (subscriptionStatus === "FREE" && !trialActive) {
      const trackedChatId = await this.subscriptionService.getTrackedChatId(
        userId
      );

      if (trackedChatId && trackedChatId !== message.chat.id) {
        this.logger.info(
          `Пользователь ${userId} (FREE) пытается отслеживать новый чат. Отклонено.`
        );
        // Покажем владельцу варианты: оформить подписку, пригласить реферала, выбрать этот чат
        await ctx.telegram.sendMessage(
          userId,
          i18next.t("limits.choose_option"),
          {
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  i18next.t("limits.choose_this_chat"),
                  `choose_chat_${message.chat.id}`
                ),
              ],
              [
                Markup.button.url(
                  i18next.t("premium.buy_button"),
                  process.env.TRIBUTE_PREMIUM_URL ||
                    "https://t.me/tribute/app?startapp=sxl5"
                ),
                Markup.button.callback(
                  i18next.t("referral.invite_friend"),
                  `invite_referral`
                ),
              ],
            ]),
          }
        );
        return;
      }
      if (!trackedChatId) {
        // Начинаем отслеживать этот чат
        await this.subscriptionService.setTrackedChatId(
          userId,
          message.chat.id
        );
        this.logger.info(
          `Пользователь ${userId} (FREE) начал отслеживать чат ${message.chat.id}`
        );
      }
    }
    await this.cacheOriginalMessage(message);
  }

  private async cacheOriginalMessage(message: BusinessMessage) {
    let textForCache: string;
    let s3Key: string | null = null;
    if (this.isMediaMessage(message)) {
      if (!this.s3Service) {
        this.logger.warn(
          "Получено медиа-сообщение, но S3 не настроен. Сообщение не будет закэшировано."
        );
        return;
      }
      const mediaMessage = message as Message.PhotoMessage &
        Message.VideoMessage &
        Message.VoiceMessage &
        Message.VideoNoteMessage &
        Message.DocumentMessage;
      s3Key = await this.s3Service.uploadMedia(mediaMessage);
      if (!s3Key) {
        this.logger.warn(
          "Загрузка медиа в S3 не удалась, сообщение не будет закэшировано."
        );
        return;
      }
      textForCache = mediaMessage.caption || i18next.t("common.media_file");
    } else if (message.text) {
      textForCache = message.text;
    } else {
      textForCache = i18next.t("common.message_without_text");
    }

    if (s3Key && this.s3Service) {
      this.s3Service.scheduleFileDeletion(s3Key, 5 * 60 * 1000); // 5 минут
    }

    const cachedMessage: CachedMessage = {
      ...message,
      text: textForCache,
      ...(message.caption && { caption: message.caption }),
      s3Key: s3Key,
    };
    await this.cacheService.cacheMessage(cachedMessage);
  }

  private isMediaMessage(message: BusinessMessage): boolean {
    return (
      "photo" in message ||
      "video" in message ||
      "voice" in message ||
      "video_note" in message ||
      "document" in message ||
      "sticker" in (message as any)
    );
  }
}
