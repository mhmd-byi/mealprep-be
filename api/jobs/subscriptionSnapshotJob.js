const cron = require('node-cron');
const SubscriptionSnapshot = require('../models/subscriptionSnapshotModel');
const { todayCalendarDateUTC, IST_ZONE } = require('../utils/dateUtils');
const { countActiveSubscriptionsByPlan } = require('../controllers/subscriptionController');

// Records that day's active-subscription counts by plan — the only way to
// later show a trend on the Dashboard's Active Subscriptions widget, since
// subscription status itself has no history (see subscriptionSnapshotModel.js).
const recordDailySnapshot = async () => {
  try {
    const { weeklyCount, monthlyCount, trialCount } = await countActiveSubscriptionsByPlan();
    const date = todayCalendarDateUTC();
    await SubscriptionSnapshot.findOneAndUpdate(
      { date },
      { date, weeklyCount, monthlyCount, trialCount },
      { upsert: true }
    );
    console.log(`Recorded subscription snapshot for ${date.toISOString().split('T')[0]}: weekly=${weeklyCount}, monthly=${monthlyCount}, trial=${trialCount}`);
  } catch (error) {
    console.error('Error recording subscription snapshot:', error);
  }
};

// Runs once daily, late in the day so it captures that day's final state
// after both meal-subtraction cron runs have settled.
cron.schedule('55 23 * * *', recordDailySnapshot, {
  timezone: IST_ZONE
});

module.exports = { recordDailySnapshot };
