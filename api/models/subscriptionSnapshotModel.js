const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// One row per calendar day, written once daily by a cron job. Subscription
// status is overwritten in place with no history kept, so this is the only
// way to later answer "how many Weekly/Monthly/Trial subs were active N days
// ago" — that question can't be reconstructed retroactively, so the series
// only covers days from whenever this job first started running.
const subscriptionSnapshotSchema = new Schema(
  {
    date: { type: Date, required: true, unique: true }, // calendar day, UTC midnight
    weeklyCount: { type: Number, required: true },
    monthlyCount: { type: Number, required: true },
    trialCount: { type: Number, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SubscriptionSnapshot', subscriptionSnapshotSchema);
