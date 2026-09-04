const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const subscriptionAuditLogSchema = new Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users',
      required: true
    },
    // Snapshot admin identity at the time of the action, so the log stays
    // readable even if the admin's account is later renamed or removed.
    adminName: { type: String, required: true },
    adminEmail: { type: String, required: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users',
      required: true
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      required: true
    },
    action: {
      type: String,
      enum: ['create', 'update', 'cancel'],
      required: true
    },
    reason: {
      type: String,
      required: true
    },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('SubscriptionAuditLog', subscriptionAuditLogSchema);
