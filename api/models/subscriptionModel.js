const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const subscriptionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users',
      required: true
    },
    subscriptionStartDate: {
      type: Date,
      required: true,
      default: Date.now
    },
    plan: {
      type: String,
      required: true
    },
    lunchMeals: {
      type: Number,
      required: true
    },
    dinnerMeals: {
      type: Number,
      required: true
    },
    // New fields for next-day meals
    nextDayLunchMeals: {
      type: Number,
      default: 0
    },
    nextDayDinnerMeals: {
      type: Number,
      default: 0
    },
    totalMeals: {
      type: Number,
      required: true
    },
    mealType: {
      type: String,
      required: true
    },
    carbType: {
      type: String,
      required: true
    },
    paymentId: { type: String },
    // Only set for admin-created subscriptions (Razorpay purchases already
    // carry their own paymentId/orderId and don't need this).
    paymentMethod: {
      type: String,
      enum: ['Cash', 'UPI', 'Card', 'Bank Transfer']
    },
    orderId: { type: String },
    refundId: { type: String },
    mealStartDate: { type: String },
    allergy: { type: String, default: "" },
    // 'active' = currently delivering, 'queued' = waiting for current to finish, 'completed' = meals exhausted
    status: {
      type: String,
      enum: ['active', 'queued', 'completed', 'cancelled'],
      default: 'active'
    },
    // Tracks which expiration-reminder emails have already gone out for this
    // subscription, so the daily reminder job never sends the same one twice.
    remindersSent: {
      sevenDay: { type: Boolean, default: false },
      threeDay: { type: Boolean, default: false },
      oneDay: { type: Boolean, default: false }
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Subscription', subscriptionSchema);
