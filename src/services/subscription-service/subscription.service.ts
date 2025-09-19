import { Logger } from "../logger-service/logger.service";
import {
  UserModel,
  type IUser,
  type SubscriptionStatus,
} from "../../models/user.model";
import { randomUUID } from "crypto";
import { ReferralModel } from "../../models/referral.model";

export type { SubscriptionStatus };

/**
 * Сервис управления пользователями и подписками.
 * Работает поверх MongoDB (Mongoose) и инкапсулирует:
 * - создание/поиск пользователя по Telegram ID или публичному UUID,
 * - изменение и проверку статуса подписки с учётом срока действия,
 * - фиксацию отслеживаемого чата для FREE,
 * - генерацию реферальной ссылки и обработку рефералов с бонусом.
 */
export class SubscriptionService {
  private logger = Logger.getInstance();

  /**
   * Возвращает пользователя по Telegram ID, создавая нового при отсутствии.
   * У нового пользователя генерируется публичный UUID.
   */
  public async findOrCreateUser(telegramId: number): Promise<IUser> {
    let user = await UserModel.findOne({ telegramId }).exec();
    if (user) return user;
    this.logger.info(
      `Создаем нового пользователя с Telegram ID: ${telegramId}`
    );
    user = await UserModel.create({
      userUuid: randomUUID(),
      telegramId,
      subscriptionStatus: "FREE",
    });
    return user;
  }

  /**
   * Возвращает/создаёт пользователя по публичному UUID (без Telegram ID).
   */
  public async getOrCreateByUuid(userUuid: string): Promise<IUser> {
    let user = await UserModel.findOne({ userUuid }).exec();
    if (user) return user;
    user = await UserModel.create({ userUuid, subscriptionStatus: "FREE" });
    return user;
  }

  /**
   * Получает статус подписки пользователя по Telegram ID.
   * Если PREMIUM истёк — статус автоматически сбрасывается на FREE.
   */
  public async getUserSubscriptionStatus(
    telegramId: number
  ): Promise<SubscriptionStatus> {
    const user = await this.findOrCreateUser(telegramId);
    if (
      user.subscriptionStatus === "PREMIUM" &&
      user.subscriptionEndsAt &&
      user.subscriptionEndsAt.getTime() < Date.now()
    ) {
      this.logger.info(
        `Подписка для пользователя ${telegramId} истекла. Меняем статус на FREE.`
      );
      user.subscriptionStatus = "FREE";
      user.subscriptionEndsAt = null;
      await user.save();
      return "FREE";
    }
    return user.subscriptionStatus;
  }

  /**
   * Устанавливает статус подписки для пользователя по Telegram ID.
   * Возвращает актуальную сущность пользователя после обновления.
   */
  public async setUserSubscriptionStatus(
    telegramId: number,
    status: SubscriptionStatus,
    expiresAtISO: string | null
  ): Promise<IUser> {
    const user = await this.findOrCreateUser(telegramId);
    user.subscriptionStatus = status;
    user.subscriptionEndsAt = expiresAtISO ? new Date(expiresAtISO) : null;
    await user.save();
    this.logger.info(
      `Статус подписки для пользователя ${telegramId} установлен на ${status}. Срок действия: ${expiresAtISO}`
    );
    return user;
  }

  /**
   * Возвращает ID отслеживаемого чата для FREE-пользователя.
   */
  public async getTrackedChatId(telegramId: number): Promise<number | null> {
    const user = await this.findOrCreateUser(telegramId);
    return user.trackedChatId ?? null;
  }

  /**
   * Фиксирует отслеживаемый чат для FREE-пользователя.
   */
  public async setTrackedChatId(
    telegramId: number,
    chatId: number
  ): Promise<void> {
    await UserModel.updateOne(
      { telegramId },
      { $set: { trackedChatId: chatId } }
    ).exec();
    this.logger.info(
      `Для пользователя ${telegramId} (FREE) установлен отслеживаемый чат: ${chatId}`
    );
  }

  /**
   * Формирует реферальную ссылку для публичного UUID пользователя.
   */
  public getReferralLink(botUsername: string, userUuid: string): string {
    return `https://t.me/${botUsername}?start=ref_${userUuid}`;
  }

  /**
   * Создаёт реферальную связь (если её ещё нет) и начисляет 7 дней PREMIUM рефереру.
   * Возвращает объект результата без undefined в optional поле (совместимо с exactOptionalPropertyTypes).
   */
  public async addReferralAndGrant(
    referrerUuid: string,
    referredTelegramId: number
  ): Promise<{ referrer?: IUser; referred: IUser; created: boolean }> {
    const referrer = await UserModel.findOne({ userUuid: referrerUuid }).exec();
    if (!referrer) {
      this.logger.warn(`Referrer с UUID ${referrerUuid} не найден`);
    }

    const referred = await this.findOrCreateUser(referredTelegramId);

    // Уже есть связь — ничего не делаем
    const existing = await ReferralModel.findOne({
      referred: referred._id,
    }).exec();
    if (existing) {
      const base = { referred, created: false };
      return referrer ? { referrer, ...base } : base;
    }

    if (referrer) {
      await ReferralModel.create({
        referrer: referrer._id,
        referred: referred._id,
      });
      // Бонус 7 дней премиума: продлеваем при необходимости
      const baseDate =
        referrer.subscriptionEndsAt && referrer.subscriptionEndsAt > new Date()
          ? referrer.subscriptionEndsAt
          : new Date();
      const newEnds = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      referrer.subscriptionStatus = "PREMIUM";
      referrer.subscriptionEndsAt = newEnds;
      await referrer.save();
    }

    const base = { referred, created: true };
    return referrer ? { referrer, ...base } : base;
  }
}
