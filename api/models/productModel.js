const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const imageSchema = new Schema({ url: { type: String, required: true } }, { _id: false });

const authorSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'Users' },
    name: { type: String, default: '' }
  },
  { _id: false }
);

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 1000 },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, default: null, min: 0 },
    images: { type: [imageSchema], default: [] },
    dietType: { type: String, enum: ['veg', 'non-veg'], required: true },
    category: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true },
    trackStock: { type: Boolean, default: false },
    stock: { type: Number, default: 0, min: 0 },
    availableDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    cutoffDaysBefore: { type: Number, default: 1, min: 0, max: 7 },
    cutoffTime: { type: String, default: '18:00' },
    sortOrder: { type: Number, default: 0 },
    createdBy: authorSchema,
    updatedBy: authorSchema
  },
  { timestamps: true }
);

productSchema.index({ isActive: 1, sortOrder: 1, createdAt: -1 });
productSchema.index({ category: 1 });

module.exports = mongoose.model('Product', productSchema);
