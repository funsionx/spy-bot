import mongoose, { Schema, Document, Model } from "mongoose";

export type ActionType =
  | "first_start"
  | "premium_button_click"
  | "premium_payment"
  | "referral_button_click"
  | "referral_success"
  | "first_notification_received";

export interface IUserAction extends Document {
  userId: number;
  actionType: ActionType;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface UserInfo {
  userId: number;
  telegramUsername?: string | null;
}

export interface IDailyStats extends Document {
  date: Date;
  dau: number;
  mau: number;
  dauUsers: UserInfo[]; // Массив уникальных пользователей для подсчета DAU
  activationUsers: {
    // Массивы уникальных пользователей для отслеживания первого раза активаций
    premium_button_click: UserInfo[];
    premium_payment: UserInfo[];
    referral_button_click: UserInfo[];
    referral_success: UserInfo[];
    first_notification_received: UserInfo[];
  };
  activations: {
    first_start: number;
    premium_button_click: number;
    premium_payment: number;
    referral_button_click: number;
    referral_success: number;
    first_notification_received: number;
  };
  retention: number;
  trialCR: number;
  createdAt: Date;
  updatedAt: Date;
}

const UserActionSchema = new Schema<IUserAction>(
  {
    userId: { type: Number, required: true, index: true },
    actionType: {
      type: String,
      enum: [
        "first_start",
        "premium_button_click",
        "premium_payment",
        "referral_button_click",
        "referral_success",
        "first_notification_received",
      ],
      required: true,
      index: true,
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

UserActionSchema.index({ userId: 1, actionType: 1, createdAt: 1 });
UserActionSchema.index({ createdAt: 1 });

const UserInfoSchema = new Schema(
  {
    userId: { type: Number, required: true },
    telegramUsername: { type: String, default: null },
  },
  { _id: false }
);

const DailyStatsSchema = new Schema<IDailyStats>(
  {
    date: { type: Date, required: true, unique: true, index: true },
    dau: { type: Number, default: 0 },
    mau: { type: Number, default: 0 },
    dauUsers: { type: [UserInfoSchema], default: [] }, // Массив уникальных пользователей для подсчета DAU
    activationUsers: {
      premium_button_click: { type: [UserInfoSchema], default: [] },
      premium_payment: { type: [UserInfoSchema], default: [] },
      referral_button_click: { type: [UserInfoSchema], default: [] },
      referral_success: { type: [UserInfoSchema], default: [] },
      first_notification_received: { type: [UserInfoSchema], default: [] },
    },
    activations: {
      first_start: { type: Number, default: 0 },
      premium_button_click: { type: Number, default: 0 },
      premium_payment: { type: Number, default: 0 },
      referral_button_click: { type: Number, default: 0 },
      referral_success: { type: Number, default: 0 },
      first_notification_received: { type: Number, default: 0 },
    },
    retention: { type: Number, default: 0 },
    trialCR: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const UserActionModel: Model<IUserAction> =
  mongoose.models.UserAction ||
  mongoose.model<IUserAction>("UserAction", UserActionSchema, "stats");

export const DailyStatsModel: Model<IDailyStats> =
  mongoose.models.DailyStats ||
  mongoose.model<IDailyStats>("DailyStats", DailyStatsSchema, "stats");
