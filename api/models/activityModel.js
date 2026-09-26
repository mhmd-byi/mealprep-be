const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CATEGORIES = ['account', 'subscription', 'cancellation', 'customisation', 'diet', 'profile', 'holiday', 'meal_count', 'other'];

const activitesSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    date: {
      type: Date,
      required: true
    },
    description: {
      type: String,
      required: true,
    },
    // Defaults to 'other' so pre-existing rows (created before this field
    // existed) still render under a sensible bucket instead of failing to load.
    category: {
      type: String,
      enum: CATEGORIES,
      default: 'other'
    }
  },
  {
    timestamps: true
  }
);

activitesSchema.statics.CATEGORIES = CATEGORIES;

module.exports = mongoose.model('Activity', activitesSchema);
