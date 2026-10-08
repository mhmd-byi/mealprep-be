const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const optionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    priceDelta: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false }
  },
  { _id: true }
);

const addOnSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0 }
  },
  { _id: true }
);

const mealLibraryItemSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Stored as plain text, not a reference — same convention as ExpenseCategory
    // (see expenseCategoryController's rename cascade, mirrored here too).
    category: { type: String, required: true },
    dietType: { type: String, enum: ['veg', 'non-veg'], required: true },
    mealType: { type: String, enum: ['lunch', 'dinner', 'both'], required: true, default: 'both' },
    price: { type: Number, default: 0 },
    prepTimeMinutes: { type: Number },
    servingSize: { type: String },
    description: { type: String },
    imageUrl: { type: String },
    nutrition: {
      kcal: { type: Number, default: 0 },
      protein: { type: Number, default: 0 },
      carbs: { type: Number, default: 0 },
      fat: { type: Number, default: 0 }
    },
    customization: {
      proteins: [optionSchema],
      carbs: [optionSchema],
      veggies: [optionSchema]
    },
    addOns: [addOnSchema],
    tags: [{ type: String, trim: true }],
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('MealLibraryItem', mealLibraryItemSchema);
