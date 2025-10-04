import crypto from "crypto";
import { Logger } from "../services/logger-service/logger.service";
import { SubscriptionService } from "../services/subscription-service/subscription.service";
import { ReferralModel } from "../models/referral.model";
import { UserModel } from "../models/user.model";
import type { TributeWebhookPayload } from "../types/tribute";
import { Telegraf } from "telegraf";

export class TributeWebhookHandler {
  private logger = Logger.getInstance();
  private tributeApiKey: string;

  constructor(
    private subscriptionService: SubscriptionService,
    private bot: Telegraf
  ) {
    if (!process.env.TRIBUTE_API_KEY) {
      throw new Error("Переменная окружения TRIBUTE_API_KEY не установлена.");
    }
    this.tributeApiKey = process.env.TRIBUTE_API_KEY;
  }

  public async handle(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Проверка подписи
    const signature = request.headers.get("trbt-signature");
    if (!signature) {
      this.logger.warn("Tribute Webhook: Отсутствует заголовок trbt-signature");
      return new Response("Signature header is missing", { status: 400 });
    }

    const bodyText = await request.text();
    const hmac = crypto.createHmac("sha256", this.tributeApiKey);
    const digest = hmac.update(bodyText).digest("hex");

    if (digest !== signature) {
      this.logger.warn("Tribute Webhook: Неверная подпись");
      return new Response("Invalid signature", { status: 403 });
    }

    const parsed = JSON.parse(bodyText) as any;
    const name: string = parsed.name || parsed.event;
    const payload = parsed.payload || {};

    const telegramId: number = payload.telegram_user_id || payload.user?.id;
    const expiresAt: string | null =
      payload.expires_at || payload.subscription?.expires_at || null;

    this.logger.info(
      `Получен веб-хук от Tribute: ${name} для пользователя ${telegramId}`
    );

    try {
      switch (name) {
        case "new_subscription":
          {
            const user =
              await this.subscriptionService.setUserSubscriptionStatus(
                telegramId,
                "PREMIUM",
                expiresAt
              );
            // Если у пользователя есть реферер — даём ему +3 недели, один раз
            try {
              const rel = await ReferralModel.findOne({
                referred: user._id,
              }).exec();
              if (rel && !rel.paidBonusGranted) {
                const referrer = await UserModel.findById(rel.referrer).exec();
                if (referrer) {
                  await this.subscriptionService.grantWeeksToUser(referrer, 3);
                  rel.paidBonusGranted = true;
                  await rel.save();
                  this.logger.info(
                    `Выдан бонус +3 недели рефереру ${referrer.telegramId} за платёж пользователя ${telegramId}`
                  );
                }
              }
            } catch (e) {
              this.logger.warn(
                "Не удалось обработать реферальный бонус за оплату",
                e as any
              );
            }
          }
          // Пытаемся поблагодарить пользователя
          try {
            await this.bot.telegram.sendMessage(
              telegramId,
              "Спасибо за поддержку! Ваша подписка активирована."
            );
          } catch (e) {
            this.logger.warn(
              "Не удалось отправить благодарность пользователю:",
              e as any
            );
          }
          break;
        case "cancelled_subscription":
          await this.subscriptionService.setUserSubscriptionStatus(
            telegramId,
            "FREE",
            null
          );
          break;
        default:
          this.logger.warn(`Неизвестное событие Tribute: ${name}`);
      }
      return new Response("OK", { status: 200 });
    } catch (error) {
      this.logger.error("Ошибка при обработке веб-хука Tribute:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }
}
