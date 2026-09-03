const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const mealDeliverySchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users',
      required: true
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      required: true
    },
    date: {
      type: Date,
      required: true
    },
    mealType: {
      type: String,
      enum: ['lunch', 'dinner'],
      required: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('MealDelivery', mealDeliverySchema);
