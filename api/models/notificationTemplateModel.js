const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const notificationTemplateSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
    title: { type: String, required: true, trim: true, maxlength: 65 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    category: { type: String, enum: ['announcement', 'service'], default: 'announcement' },
    route: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('NotificationTemplate', notificationTemplateSchema);
