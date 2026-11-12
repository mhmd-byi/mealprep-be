const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const planSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60, unique: true },
    price: { type: Number, required: true, min: 1 },
    meals: { type: Number, required: true, min: 1, max: 200 },
    period: { type: String, default: '', trim: true, maxlength: 20 },
    description: { type: String, default: '', trim: true, maxlength: 200 },
    features: { type: [String], default: [] },
    color: { type: String, default: '#6b7280' },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    websiteTitle: { type: String, default: '', trim: true, maxlength: 80 },
    validityText: { type: String, default: '', trim: true, maxlength: 80 },
    imageUrl: { type: String, default: '' }
  },
  { timestamps: true }
);

planSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('Plan', planSchema);
