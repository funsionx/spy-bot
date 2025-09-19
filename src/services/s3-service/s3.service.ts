import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Telegraf } from "telegraf";
import { Message } from "telegraf/types";
import moment from "moment";
import path from "path";
import { Readable } from "stream";
import { Logger } from "../logger-service/logger.service";

export class S3Service {
  private s3: S3Client;
  private bucketName: string;
  private bot: Telegraf<any>;
  private logger = Logger.getInstance();
  private scheduledDeletions = new Map<string, NodeJS.Timeout>();

  constructor(bot: Telegraf<any>) {
    if (
      !process.env.S3_BUCKET ||
      !process.env.S3_REGION ||
      !process.env.S3_KEY ||
      !process.env.S3_SECRET ||
      !process.env.S3_ENDPOINT
    ) {
      throw new Error("Не все переменные окружения S3 определены.");
    }

    this.s3 = new S3Client({
      region: process.env.S3_REGION,
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_KEY,
        secretAccessKey: process.env.S3_SECRET,
      },
    });
    this.bucketName = process.env.S3_BUCKET;
    this.bot = bot;
    this.logger.info("S3 Service инициализирован");
  }

  /**
   * Загружает медиафайл в S3
   */
  async uploadMedia(
    message:
      | Message.VideoMessage
      | Message.PhotoMessage
      | Message.VoiceMessage
      | Message.VideoNoteMessage
      | Message.DocumentMessage
  ): Promise<string | null> {
    const fileId = this.getFileId(message);
    if (!fileId || !message.from) {
      return null;
    }

    try {
      const fileLink = await this.bot.telegram.getFileLink(fileId);
      const response = await fetch(fileLink.href);

      if (!response.ok || !response.body) {
        throw new Error(`Ошибка при скачивании файла: ${response.statusText}`);
      }

      const fileBuffer = Buffer.from(await response.arrayBuffer());

      const contentType = response.headers.get("content-type") || undefined;
      const extension = this.getFileExtension(
        message,
        contentType,
        fileLink.href
      );
      const mediaType = this.getMediaType(message);
      const timestamp = moment().format("HH-mm-ss_DD-MM-YYYY");
      const s3Key = `spy-bot-media/${message.from.id}/${timestamp}_${mediaType}${extension}`;

      const putCommand = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType,
        ContentLength: fileBuffer.length,
      });

      await this.s3.send(putCommand);
      this.logger.info(`Файл успешно загружен в S3: ${s3Key}`);
      return s3Key;
    } catch (error) {
      this.logger.error("Ошибка при загрузке файла в S3:", error);
      return null;
    }
  }

  /**
   * Получает файл из S3
   */
  async getFile(
    key: string
  ): Promise<{ body: Readable; contentType: string | undefined } | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      const response = await this.s3.send(command);

      if (response.Body) {
        return {
          body: response.Body as Readable,
          contentType: response.ContentType,
        };
      }
      return null;
    } catch (error) {
      this.logger.error(`Ошибка при получении файла из S3 ${key}:`, error);
      return null;
    }
  }

  /**
   * Удаляет файл из S3
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.s3.send(command);
      this.logger.info(`Файл удален из S3: ${key}`);
    } catch (error) {
      this.logger.error(`Ошибка при удалении файла из S3 ${key}:`, error);
    }
  }

  /**
   * Запланировать удаление файла из S3 через определенное время
   */
  scheduleFileDeletion(key: string, delayMs: number): void {
    const timeoutId = setTimeout(() => {
      this.logger.info(`Сработало автоудаление для S3 ключа: ${key}`);
      this.deleteFile(key);
      this.scheduledDeletions.delete(key);
    }, delayMs);
    this.scheduledDeletions.set(key, timeoutId);
    this.logger.info(`Запланировано удаление для S3 ключа: ${key}`);
  }

  /**
   * Отменить запланированное удаление файла
   */
  cancelFileDeletion(key: string): void {
    const timeoutId = this.scheduledDeletions.get(key);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.scheduledDeletions.delete(key);
      this.logger.info(`Автоудаление отменено для S3 ключа: ${key}`);
    }
  }

  /**
   * Отменить все запланированные удаления (при остановке бота)
   */
  cancelAllScheduledDeletions(): void {
    if (this.scheduledDeletions.size > 0) {
      this.logger.info(
        `Очистка ${this.scheduledDeletions.size} запланированных удалений...`
      );
      for (const timeoutId of this.scheduledDeletions.values()) {
        clearTimeout(timeoutId);
      }
      this.scheduledDeletions.clear();
      this.logger.info("Все запланированные удаления отменены.");
    }
  }

  /**
   * Получает ключ последнего медиафайла пользователя
   */
  async getLatestMediaKey(userId: number): Promise<string | null> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: `spy-bot-media/${userId}/`,
      });

      const response = await this.s3.send(command);
      if (!response.Contents || response.Contents.length === 0) {
        return null;
      }

      const sortedFiles = response.Contents.sort((a, b) => {
        return (
          (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0)
        );
      });

      if (sortedFiles.length === 0 || !sortedFiles[0]) {
        return null;
      }

      return sortedFiles[0].Key || null;
    } catch (error) {
      this.logger.error(
        `Ошибка при поиске последнего медиафайла для пользователя ${userId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Извлекает file_id из сообщения
   */
  private getFileId(
    message:
      | Message.VideoMessage
      | Message.PhotoMessage
      | Message.VoiceMessage
      | Message.VideoNoteMessage
      | Message.DocumentMessage
  ): string | undefined {
    if ("video" in message) {
      return message.video.file_id;
    }
    if ("voice" in message) {
      return message.voice.file_id;
    }
    if ("video_note" in message) {
      return message.video_note.file_id;
    }
    if ("document" in message) {
      return message.document.file_id;
    }
    if ("photo" in message && message.photo.length > 0) {
      const photo = message.photo.sort(
        (a, b) => b.width * b.height - a.width * a.height
      )[0];
      return photo?.file_id;
    }
    return undefined;
  }

  private getMediaType(
    message:
      | Message.VideoMessage
      | Message.PhotoMessage
      | Message.VoiceMessage
      | Message.VideoNoteMessage
      | Message.DocumentMessage
  ): string {
    if ("video_note" in message) return "videonote";
    if ("voice" in message) return "voice";
    if ("video" in message) return "video";
    if ("photo" in message) return "photo";
    return "document";
  }

  private getFileExtension(
    message:
      | Message.VideoMessage
      | Message.PhotoMessage
      | Message.VoiceMessage
      | Message.VideoNoteMessage
      | Message.DocumentMessage,
    contentType?: string,
    href?: string
  ): string {
    // 1) Используем исходное имя файла, если доступно
    if ("document" in message && message.document?.file_name) {
      const ext = path.extname(message.document.file_name);
      if (ext) return ext;
    }
    if ("video" in message && message.video?.file_name) {
      const ext = path.extname(message.video.file_name);
      if (ext) return ext;
    }

    // 2) Фото обычно jpeg
    if ("photo" in message) {
      return ".jpg";
    }

    // 3) Пробуем по URL
    if (href) {
      try {
        const fromPath = path.extname(new URL(href).pathname);
        if (fromPath && fromPath.length > 1) return fromPath;
      } catch {}
    }

    // 4) По Content-Type
    if (contentType) {
      const map: Record<string, string> = {
        "application/pdf": ".pdf",
        "application/msword": ".doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          ".docx",
        "application/vnd.ms-excel": ".xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
          ".xlsx",
        "application/vnd.ms-powerpoint": ".ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation":
          ".pptx",
        "application/zip": ".zip",
        "application/x-zip-compressed": ".zip",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
        "video/mpeg": ".mpeg",
        "audio/ogg": ".ogg",
        "audio/mpeg": ".mp3",
        "application/octet-stream": ".bin",
      };
      if (map[contentType]) return map[contentType];
    }

    // 5) Fallback
    return ".dat";
  }
}
