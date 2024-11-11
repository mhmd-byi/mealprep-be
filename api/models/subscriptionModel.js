const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const subscriptionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
    paymentId: { type: String },
    orderId: { type: String }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Subscription', subscriptionSchema);
