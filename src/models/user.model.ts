import mongoose, { Schema, Document, Model } from "mongoose";

export type SubscriptionStatus = "FREE" | "PREMIUM";

export interface IUser extends Document {
  userUuid: string; // публичный UUID для рефералок
  telegramId?: number; // может отсутствовать
  subscriptionStatus: SubscriptionStatus;
  subscriptionEndsAt?: Date | null;
  trackedChatId?: number | null;
  trialEndsAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    userUuid: { type: String, unique: true, required: true, index: true },
    telegramId: { type: Number, unique: true, sparse: true },
    subscriptionStatus: {
      type: String,
      enum: ["FREE", "PREMIUM"],
      default: "FREE",
    },
    subscriptionEndsAt: { type: Date, default: null },
    trackedChatId: { type: Number, default: null },
    trialEndsAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const UserModel: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
