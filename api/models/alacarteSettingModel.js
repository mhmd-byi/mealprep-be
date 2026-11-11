const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const alacarteSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'main' },
    middayFee: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AlacarteSetting', alacarteSettingSchema);
