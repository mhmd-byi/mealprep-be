const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const tasteOptionSchema = new Schema(
  {
    group: { type: String, enum: ['spice', 'flavour'], required: true },
    label: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 }
  },
  {
    timestamps: true
  }
);

tasteOptionSchema.index({ group: 1, sortOrder: 1 });

module.exports = mongoose.model('TasteOption', tasteOptionSchema);
