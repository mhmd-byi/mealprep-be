const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userNotificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notificationId: { type: Schema.Types.ObjectId, ref: 'Notification', required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    category: { type: String, default: 'announcement' },
    route: { type: String, default: '' },
    pushStatus: { type: String, enum: ['pending', 'sent', 'failed', 'no-device'], default: 'pending' },
    readAt: { type: Date, default: null },
    dedupeKey: { type: String }
  },
  { timestamps: true }
);

userNotificationSchema.index({ userId: 1, createdAt: -1 });
userNotificationSchema.index({ userId: 1, readAt: 1 });
userNotificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $exists: true } } }
);

module.exports = mongoose.model('UserNotification', userNotificationSchema);
