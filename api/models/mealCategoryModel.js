const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const mealCategorySchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    color: { type: String, required: true }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('MealCategory', mealCategorySchema);
