import { Schema, Types, model } from "mongoose";

const subscriptionSchema = new Schema({
  endpoint: { type: String, required: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  userType: {
    type: String,
    required: true,
    enum: ["organization", "employee"],
  },
  userId: { type: Types.ObjectId, required: true },
});

export default model("Subscription", subscriptionSchema);
