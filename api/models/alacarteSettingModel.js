const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const slotSchema = new Schema(
  {
    key: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    fee: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const alacarteSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'main' },
    middayFee: { type: Number, default: 0, min: 0 },
    slots: { type: [slotSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AlacarteSetting', alacarteSettingSchema);
