const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// One row per (user, date, mealSlot) that a user has explicitly overridden away
// from the default ('veg'). Absence of a row for a given user/date/slot means
// the default applies — days are never bulk-created up front.
const mealDietaryPreferenceSchema = new Schema(
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
    mealSlot: {
      type: String,
      enum: ['lunch', 'dinner'],
      required: true
    },
    preference: {
      type: String,
      enum: ['veg', 'non-veg'],
      required: true
    }
  },
  {
    timestamps: true
  }
);

mealDietaryPreferenceSchema.index({ userId: 1, date: 1, mealSlot: 1 }, { unique: true });

module.exports = mongoose.model('MealDietaryPreference', mealDietaryPreferenceSchema);
