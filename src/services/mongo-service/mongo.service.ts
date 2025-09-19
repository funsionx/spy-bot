import mongoose from "mongoose";
import { Logger } from "../logger-service/logger.service";

export class MongoService {
  private static logger = Logger.getInstance();
  private static isConnected = false;

  public static async connect(uri: string): Promise<void> {
    if (this.isConnected) return;
    this.logger.info("Подключение к MongoDB...");
    await mongoose.connect(uri, {
      autoIndex: true,
      serverSelectionTimeoutMS: 10000,
    });
    this.isConnected = true;
    this.logger.info("MongoDB подключен");
  }

  public static async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    await mongoose.disconnect();
    this.isConnected = false;
    this.logger.info("MongoDB отключен");
  }
}
