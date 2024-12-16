const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const mealItemSchema = new Schema({
  name: { type: String, required: true },
  weight: { type: String, required: true },
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
    items: [mealItemSchema],
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('CustomiseMeal', customiseMealRequestSchema);
