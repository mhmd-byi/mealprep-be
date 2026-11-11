const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const productCategorySchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
    sortOrder: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProductCategory', productCategorySchema);
