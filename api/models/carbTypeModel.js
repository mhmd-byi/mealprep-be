const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const macroSchema = new Schema(
  {
    min: { type: Number, min: 0, max: 5000 },
    max: { type: Number, min: 0, max: 5000 }
  },
  { _id: false }
);

const carbTypeSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true, match: /^[a-z0-9-]{2,40}$/ },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    shortCode: { type: String, default: '', trim: true, uppercase: true, maxlength: 6 },
    color: { type: String, default: '#6b7280' },
    nutrition: {
      protein: macroSchema,
      carbs: macroSchema,
      fat: macroSchema,
      fiber: macroSchema,
      kcal: macroSchema
    },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    websiteName: { type: String, default: '', trim: true, maxlength: 60 },
    websiteBlurb: { type: String, default: '', trim: true, maxlength: 200 },
    showOnWebsite: { type: Boolean, default: false }
  },
  { timestamps: true }
);

carbTypeSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('CarbType', carbTypeSchema);
