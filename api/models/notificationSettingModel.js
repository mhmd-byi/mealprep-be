const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const notificationSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true, maxlength: 65 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    days: { type: [Number], default: [] },
    sendAt: { type: String, default: '09:00' },
    lastRunDate: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('NotificationSetting', notificationSettingSchema);
