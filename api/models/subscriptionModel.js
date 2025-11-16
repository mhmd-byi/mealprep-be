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
    orderId: { type: String },
    mealStartDate: { type: String }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Subscription', subscriptionSchema);
