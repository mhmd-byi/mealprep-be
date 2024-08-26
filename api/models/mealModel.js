// models/mealModel.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const mealItemSchema = new Schema({
  name: { type: String, required: true },
  weight: { type: String, required: true },
  type: { type: String, required: true },
  description: { type: String }
});

// models/mealModel.js
const mealSchema = new Schema(
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
    mealType: {
      type: String,
      required: true,
      enum: ['lunch', 'dinner']
    },
    items: [mealItemSchema],
    imageUrl: { type: String }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Meal', mealSchema);
