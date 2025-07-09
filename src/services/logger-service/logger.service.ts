import moment from "moment";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

/**
 * Централизованный сервис для логирования
 */
export class Logger {
  private static instance: Logger;
  private devMode: boolean;

  private constructor() {
    this.devMode = process.env.DEV_MODE === "true";
    this.info("Logger инициализирован.", { devMode: this.devMode });
  }

  /**
   * Получает единственный экземпляр логгера (Singleton)
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    ...args: any[]
  ): string {
    const timestamp = moment().format("HH:mm:ss DD.MM.YYYY");
    let formattedMessage = `${timestamp} [${level}] ${message}`;

    if (args.length > 0) {
      const formattedArgs = args
        .map((arg) =>
          typeof arg === "object" && arg !== null
            ? JSON.stringify(arg, null, 2)
            : arg
        )
        .join(" ");
      formattedMessage += ` ${formattedArgs}`;
    }
    return formattedMessage;
  }

  /**
   * Логирует информационное сообщение
   */
  public info(message: string, ...args: any[]): void {
    console.log(this.formatMessage("INFO", message, ...args));
  }

  /**
   * Логирует предупреждение
   */
  public warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage("WARN", message, ...args));
  }

  /**
   * Логирует ошибку
   */
  public error(message: string, ...args: any[]): void {
    console.error(this.formatMessage("ERROR", message, ...args));
  }

  /**
   * Логирует отладочное сообщение (только если DEV_MODE=true)
   */
  public debug(message: string, ...args: any[]): void {
    if (this.devMode) {
      console.log(this.formatMessage("DEBUG", message, ...args));
    }
  }
}
