import { Logger } from "../logger-service/logger.service";
import {
  UserActionModel,
  DailyStatsModel,
  type ActionType,
  type IUserAction,
  type IDailyStats,
} from "../../models/stats.model";
import { UserModel } from "../../models/user.model";

export class StatsService {
  private logger = Logger.getInstance();
  private actionQueue: Array<{
    userId: number;
    actionType: ActionType;
    metadata?: any;
  }> = [];
  private queueTimeout: NodeJS.Timeout | null = null;
  private readonly QUEUE_BATCH_SIZE = 50;
  private readonly QUEUE_FLUSH_INTERVAL = 5000;

  /**
   * Регистрирует действие пользователя асинхронно (батчинг)
   */
  public async trackAction(
    userId: number,
    actionType: ActionType,
    metadata?: Record<string, any>
  ): Promise<void> {
    this.actionQueue.push({ userId, actionType, metadata });

    if (this.actionQueue.length >= this.QUEUE_BATCH_SIZE) {
      await this.flushQueue();
    } else if (!this.queueTimeout) {
      this.queueTimeout = setTimeout(() => {
        this.flushQueue().catch((err) => {
          this.logger.error("Ошибка при flush статистики:", err);
        });
      }, this.QUEUE_FLUSH_INTERVAL);
    }
  }

  /**
   * Отправляет накопленные действия в базу
   */
  private async flushQueue(): Promise<void> {
    if (this.actionQueue.length === 0) return;

    if (this.queueTimeout) {
      clearTimeout(this.queueTimeout);
      this.queueTimeout = null;
    }

    const batch = this.actionQueue.splice(0, this.QUEUE_BATCH_SIZE);

    try {
      // Убеждаемся, что все записи имеют правильную структуру
      const validBatch = batch.filter((item) => {
        if (!item.userId || !item.actionType) {
          this.logger.warn(
            `Пропущена некорректная запись: ${JSON.stringify(item)}`
          );
          return false;
        }
        return true;
      });

      if (validBatch.length > 0) {
        await UserActionModel.insertMany(validBatch, { ordered: false });
        this.logger.debug(
          `Записано ${validBatch.length} действий в статистику`
        );
      }
    } catch (error: any) {
      // Обрабатываем ошибки дубликатов (E11000) - это нормально для повторяющихся действий
      if (error.code === 11000) {
        this.logger.debug(
          `Дубликаты при записи статистики (это нормально): ${error.message}`
        );
      } else {
        this.logger.error("Ошибка при записи статистики:", error);
      }
    }
  }

  /**
   * Получает или создает статистику за день
   */
  private async getOrCreateDailyStats(date: Date): Promise<IDailyStats> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    let stats = await DailyStatsModel.findOne({ date: startOfDay }).exec();
    if (!stats) {
      stats = await DailyStatsModel.create({
        date: startOfDay,
        dau: 0,
        mau: 0,
        dauUsers: [],
        activationUsers: {
          premium_button_click: [],
          premium_payment: [],
          referral_button_click: [],
          referral_success: [],
          first_notification_received: [],
        },
        activations: {
          first_start: 0,
          premium_button_click: 0,
          premium_payment: 0,
          referral_button_click: 0,
          referral_success: 0,
          first_notification_received: 0,
        },
        retention: 0,
        trialCR: 0,
      });
    }
    return stats;
  }

  /**
   * Обновляет DAU (Daily Active Users) - инкрементально
   * DAU считается через массив dauUsers в DailyStats
   * Не создает записей в UserActionModel для first_start
   */
  public async updateDAU(
    userId: number,
    telegramUsername?: string | null
  ): Promise<void> {
    try {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);

      // Проверяем, есть ли уже этот пользователь в массиве
      const stats = await this.getOrCreateDailyStats(startOfDay);
      const existingUser = stats.dauUsers?.find((u) => u.userId === userId);

      if (!existingUser) {
        // Добавляем нового пользователя в массив
        const userInfo = { userId, telegramUsername: telegramUsername || null };
        await DailyStatsModel.updateOne(
          { date: startOfDay },
          { $push: { dauUsers: userInfo } }
        ).exec();

        // Обновляем DAU на основе длины массива
        const updatedStats = await DailyStatsModel.findOne({
          date: startOfDay,
        }).exec();
        if (updatedStats) {
          updatedStats.dau = updatedStats.dauUsers?.length || 0;
          await updatedStats.save();
        }
      } else if (
        existingUser.telegramUsername !== telegramUsername &&
        telegramUsername !== undefined
      ) {
        // Обновляем username если он изменился
        await DailyStatsModel.updateOne(
          { date: startOfDay, "dauUsers.userId": userId },
          { $set: { "dauUsers.$.telegramUsername": telegramUsername || null } }
        ).exec();
      }
    } catch (error) {
      this.logger.error("Ошибка при обновлении DAU:", error);
    }
  }

  /**
   * Обновляет MAU (Monthly Active Users) - рассчитывается по запросу
   */
  public async getMAU(month?: Date): Promise<number> {
    try {
      await this.flushQueue();
      const targetMonth = month || new Date();
      const startOfMonth = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth(),
        1
      );
      const endOfMonth = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth() + 1,
        0,
        23,
        59,
        59
      );

      const uniqueUsers = await UserActionModel.distinct("userId", {
        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
      }).exec();

      return uniqueUsers.length;
    } catch (error) {
      this.logger.error("Ошибка при расчете MAU:", error);
      return 0;
    }
  }

  /**
   * Обновляет счетчик активации first_start в DailyStats
   * Используется вместе с updateDAU (который обновляет dauUsers)
   * Не создает записей в UserActionModel
   */
  public async trackFirstStartActivation(
    userId: number,
    startOfDay: Date,
    telegramUsername?: string | null
  ): Promise<void> {
    try {
      // Проверяем, был ли уже first_start для этого пользователя за день
      const stats = await this.getOrCreateDailyStats(startOfDay);
      const existingUser = stats.dauUsers?.find((u) => u.userId === userId);
      if (existingUser) {
        // Пользователь уже учтен, не инкрементируем счетчик активации повторно
        return;
      }

      // Обновляем счетчик активации first_start
      const activationField = `activations.first_start`;
      const result = await DailyStatsModel.updateOne(
        { date: startOfDay },
        { $inc: { [activationField]: 1 } }
      ).exec();

      if (result.matchedCount === 0) {
        // Если документ не найден, создаем его заново
        await this.getOrCreateDailyStats(startOfDay);
        await DailyStatsModel.updateOne(
          { date: startOfDay },
          { $inc: { [activationField]: 1 } }
        ).exec();
      }

      this.logger.debug(
        `Обновлен счетчик активации first_start для пользователя ${userId}`
      );
    } catch (error) {
      this.logger.error(
        "Ошибка при отслеживании активации first_start:",
        error
      );
    }
  }

  /**
   * Обновляет активации (конверсии) - инкрементально
   * Для активаций использует массивы activationUsers в DailyStats для отслеживания первого раза
   * Не создает записей в UserActionModel
   * Для first_start не используется - используется trackFirstStartActivation
   */
  public async trackActivation(
    userId: number,
    actionType: ActionType,
    telegramUsername?: string | null
  ): Promise<void> {
    try {
      // first_start обрабатывается отдельно
      if (actionType === "first_start") {
        this.logger.warn(
          "trackActivation не должен вызываться для first_start, используйте trackFirstStartActivation"
        );
        return;
      }

      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);

      // Проверяем, был ли уже этот тип активации для пользователя за день
      const stats = await this.getOrCreateDailyStats(startOfDay);
      const activationUsersField =
        `activationUsers.${actionType}` as keyof typeof stats.activationUsers;
      const activationUsers = stats.activationUsers[activationUsersField] as
        | any[]
        | undefined;

      const existingUser = activationUsers?.find((u) => u.userId === userId);
      if (existingUser) {
        // Пользователь уже учтен, не инкрементируем счетчик повторно
        // Но обновляем username если изменился
        if (
          existingUser.telegramUsername !== telegramUsername &&
          telegramUsername !== undefined
        ) {
          await DailyStatsModel.updateOne(
            {
              date: startOfDay,
              [`activationUsers.${actionType}.userId`]: userId,
            },
            {
              $set: {
                [`activationUsers.${actionType}.$.telegramUsername`]:
                  telegramUsername || null,
              },
            }
          ).exec();
        }
        return;
      }

      // Добавляем пользователя в массив и инкрементируем счетчик
      const userInfo = { userId, telegramUsername: telegramUsername || null };
      const updateResult = await DailyStatsModel.updateOne(
        { date: startOfDay },
        {
          $push: { [activationUsersField]: userInfo },
          $inc: { [`activations.${actionType}`]: 1 },
        }
      ).exec();

      if (updateResult.matchedCount === 0) {
        // Если документ не найден, создаем его заново
        await this.getOrCreateDailyStats(startOfDay);
        await DailyStatsModel.updateOne(
          { date: startOfDay },
          {
            $push: { [activationUsersField]: userInfo },
            $inc: { [`activations.${actionType}`]: 1 },
          }
        ).exec();
      }

      this.logger.debug(
        `Обновлен счетчик активации ${actionType} для пользователя ${userId}`
      );
    } catch (error) {
      this.logger.error("Ошибка при отслеживании активации:", error);
    }
  }

  /**
   * Рассчитывает Retention за месяц
   * Формула: ((Клиентов на конец периода - Новых клиентов за период) / Клиентов на начало периода) × 100%
   */
  public async calculateRetention(month?: Date): Promise<number> {
    try {
      await this.flushQueue();
      const targetMonth = month || new Date();
      const startOfMonth = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth(),
        1
      );
      const endOfMonth = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth() + 1,
        0,
        23,
        59,
        59
      );
      const startOfPreviousMonth = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth() - 1,
        1
      );
      const endOfPreviousMonth = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth(),
        0,
        23,
        59,
        59
      );

      const usersAtStart = await UserModel.countDocuments({
        createdAt: { $lte: endOfPreviousMonth },
      }).exec();

      if (usersAtStart === 0) return 0;

      const newUsersInMonth = await UserModel.countDocuments({
        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
      }).exec();

      const activeUsersAtEnd = await UserActionModel.distinct("userId", {
        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
      }).exec();

      const activeUsersAtEndCount = activeUsersAtEnd.length;
      const retainedUsers = activeUsersAtEndCount - newUsersInMonth;

      const retention = (retainedUsers / usersAtStart) * 100 || 0;

      const startOfDay = new Date(targetMonth);
      startOfDay.setHours(0, 0, 0, 0);
      const stats = await this.getOrCreateDailyStats(startOfDay);
      stats.retention = retention;
      await stats.save();

      return retention;
    } catch (error) {
      this.logger.error("Ошибка при расчете Retention:", error);
      return 0;
    }
  }

  /**
   * Рассчитывает Trial Conversion Rate
   * Формула: (Количество пользователей, оплативших после триала / Количество пользователей, завершивших триал) × 100%
   */
  public async calculateTrialCR(month?: Date): Promise<number> {
    try {
      await this.flushQueue();
      const targetMonth = month || new Date();
      const startOfMonth = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth(),
        1
      );
      const endOfMonth = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth() + 1,
        0,
        23,
        59,
        59
      );

      const usersWithTrialEnded = await UserModel.countDocuments({
        trialEndsAt: { $gte: startOfMonth, $lte: endOfMonth },
      }).exec();

      if (usersWithTrialEnded === 0) return 0;

      const usersWithTrialEndedAndPaid = await UserModel.countDocuments({
        trialEndsAt: { $gte: startOfMonth, $lte: endOfMonth },
        subscriptionStatus: "PREMIUM",
        subscriptionEndsAt: { $ne: null },
      }).exec();

      const trialCR =
        (usersWithTrialEndedAndPaid / usersWithTrialEnded) * 100 || 0;

      const startOfDay = new Date(targetMonth);
      startOfDay.setHours(0, 0, 0, 0);
      const stats = await this.getOrCreateDailyStats(startOfDay);
      stats.trialCR = trialCR;
      await stats.save();

      return trialCR;
    } catch (error) {
      this.logger.error("Ошибка при расчете Trial CR:", error);
      return 0;
    }
  }

  /**
   * Получает статистику за день
   */
  public async getDailyStats(date?: Date): Promise<IDailyStats | null> {
    try {
      await this.flushQueue();
      const targetDate = date || new Date();
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);

      let stats = await DailyStatsModel.findOne({ date: startOfDay }).exec();

      if (!stats) {
        const mau = await this.getMAU(targetDate);
        const retention = await this.calculateRetention(targetDate);
        const trialCR = await this.calculateTrialCR(targetDate);

        stats = await DailyStatsModel.create({
          date: startOfDay,
          dau: 0,
          mau,
          activations: {
            first_start: 0,
            premium_button_click: 0,
            premium_payment: 0,
            referral_button_click: 0,
            referral_success: 0,
            first_notification_received: 0,
          },
          retention,
          trialCR,
        });
      } else {
        stats.mau = await this.getMAU(targetDate);
        if (!stats.retention) {
          stats.retention = await this.calculateRetention(targetDate);
        }
        if (!stats.trialCR) {
          stats.trialCR = await this.calculateTrialCR(targetDate);
        }
        await stats.save();
      }

      return stats;
    } catch (error) {
      this.logger.error("Ошибка при получении статистики:", error);
      return null;
    }
  }

  /**
   * Проверяет, было ли у пользователя первое действие определенного типа
   * Для всех активаций проверяет через массивы в DailyStats
   */
  public async isFirstAction(
    userId: number,
    actionType: ActionType
  ): Promise<boolean> {
    try {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const stats = await DailyStatsModel.findOne({
        date: startOfDay,
      }).exec();

      if (!stats) {
        return true; // Нет статистики, значит первое действие
      }

      // Для first_start проверяем через dauUsers
      if (actionType === "first_start") {
        const existingUser = stats.dauUsers?.find((u) => u.userId === userId);
        if (existingUser) {
          return false; // Уже был first_start
        }
        return true; // Еще не было first_start
      }

      // Для остальных активаций проверяем через activationUsers
      const activationUsersField =
        `activationUsers.${actionType}` as keyof typeof stats.activationUsers;
      const activationUsers = stats.activationUsers[activationUsersField] as
        | any[]
        | undefined;
      const existingUser = activationUsers?.find((u) => u.userId === userId);
      if (existingUser) {
        return false; // Уже была активация
      }
      return true; // Еще не было активации
    } catch (error) {
      this.logger.error("Ошибка при проверке первого действия:", error);
      return false;
    }
  }

  /**
   * Принудительно сохраняет все накопленные действия
   */
  public async flush(): Promise<void> {
    await this.flushQueue();
  }
}
