const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const subcategorySchema = new Schema({
  name: { type: String, required: true, trim: true }
});

const expenseCategorySchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    color: { type: String, required: true },
    subcategories: [subcategorySchema]
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('ExpenseCategory', expenseCategorySchema);
