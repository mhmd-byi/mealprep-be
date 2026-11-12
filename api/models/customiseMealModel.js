const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const mealItemSchema = new Schema({
  name: { type: String, required: true },
  weight: { type: String, default: '' },
  exclude: { type: Boolean, default: false },
});

const customiseMealRequestSchema = new Schema(
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
      enum: ['lunch', 'dinner'],
      required: true
    },
    items: [mealItemSchema],
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('CustomiseMeal', customiseMealRequestSchema);
