const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const professionOptionSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 }
  },
  {
    timestamps: true
  }
);

professionOptionSchema.index({ sortOrder: 1 });

module.exports = mongoose.model('ProfessionOption', professionOptionSchema);
