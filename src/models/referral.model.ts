import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface IReferral extends Document {
  referrer: Types.ObjectId;
  referred: Types.ObjectId;
  createdAt: Date;
}

const ReferralSchema = new Schema<IReferral>(
  {
    referrer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    referred: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const ReferralModel: Model<IReferral> =
  mongoose.models.Referral ||
  mongoose.model<IReferral>("Referral", ReferralSchema);
