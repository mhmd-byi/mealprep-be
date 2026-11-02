const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const notificationSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 65 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    category: { type: String, enum: ['announcement', 'service', 'reminder'], default: 'announcement' },
    route: { type: String, default: '' },
    filter: { type: Schema.Types.Mixed, default: {} },
    audienceSummary: { type: String, default: '' },
    source: { type: String, enum: ['admin', 'auto'], default: 'admin' },
    autoKey: { type: String, default: '' },
    status: { type: String, enum: ['scheduled', 'sending', 'sent', 'failed', 'cancelled'], default: 'sending' },
    scheduledFor: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    errorMessage: { type: String, default: '' },
    createdBy: {
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
      name: { type: String, default: '' }
    },
    stats: {
      recipients: { type: Number, default: 0 },
      pushSent: { type: Number, default: 0 },
      pushFailed: { type: Number, default: 0 },
      noDevice: { type: Number, default: 0 },
      skippedOptOut: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ status: 1, scheduledFor: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
