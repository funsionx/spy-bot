import { Context } from "telegraf";
import { NotificationService } from "../services/notification-service/notification.service";
import { Logger } from "../services/logger-service/logger.service";
import i18next from "../i18n";
import { SubscriptionService } from "../services/subscription-service/subscription.service";
import { UserModel } from "../models/user.model";

export class BusinessConnectionHandler {
  private logger = Logger.getInstance();

  constructor(private subscriptionService: SubscriptionService) {}

  public async handle(ctx: Context) {
    const update = ctx.update as any;
    if (!update.business_connection) return;

    try {
      const connection = update.business_connection;
      const telegramId = connection.user?.id;

      if (!telegramId) {
        this.logger.warn("Business connection event without user_id received.");
        return;
      }

      this.logger.info(
        `Business connection event for user ${telegramId}. Enabled: ${connection.is_enabled}. Connection ID: ${connection.id}`
      );

      if (connection.is_enabled) {
        // Обновляем businessConnectionId для пользователя через сервис
        await this.subscriptionService.updateUserBusinessConnectionId(
          telegramId,
          connection.id
        );

        const userName = NotificationService.escapeMarkdown(
          connection.user.first_name
        );
        const connectionId = NotificationService.escapeMarkdown(connection.id);
        const dateStr = NotificationService.escapeMarkdown(
          new Date(connection.date * 1000).toLocaleString(i18next.language)
        );

        const notification = i18next.t(
          "notifications.business_connection_enabled_v2",
          {
            title: i18next.t("notifications.business_connection_enabled"),
            id: i18next.t("notifications.connection_id", { id: connectionId }),
            user: i18next.t("notifications.connection_user", { userName }),
            date: i18next.t("notifications.connection_date", { date: dateStr }),
            message: i18next.t("notifications.connection_enabled_message"),
          }
        );

        await ctx.telegram.sendMessage(telegramId, notification, {
          parse_mode: "MarkdownV2",
        });
      } else {
        // Удаляем businessConnectionId у пользователя через сервис
        await this.subscriptionService.updateUserBusinessConnectionId(
          telegramId,
          null
        );

        const connectionId = NotificationService.escapeMarkdown(connection.id);

        const notification = i18next.t(
          "notifications.business_connection_disabled_v2",
          {
            title: i18next.t("notifications.business_connection_disabled"),
            id: i18next.t("notifications.connection_id", { id: connectionId }),
            message: i18next.t("notifications.connection_disabled_message"),
          }
        );

        await ctx.telegram.sendMessage(telegramId, notification, {
          parse_mode: "MarkdownV2",
        });
      }
    } catch (error) {
      this.logger.error("Ошибка обработки business_connection:", error);
    }
  }
}
