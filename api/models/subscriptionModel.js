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
    subscriptionEndDate: {
      type: Date,
      required: true
    },
    plan: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Subscription', subscriptionSchema);
