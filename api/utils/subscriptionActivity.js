const Activity = require('../models/activityModel');
const Subscription = require('../models/subscriptionModel');
const { todayCalendarDateUTC } = require('./dateUtils');

const logSubscriptionActivity = async (subscription) => {
  try {
    const hadEarlierSubscription = await Subscription.exists({
      userId: subscription.userId,
      _id: { $ne: subscription._id }
    });
    const queuedNote = subscription.status === 'queued' ? ' (queued)' : '';
    await Activity.create({
      userId: subscription.userId,
      date: todayCalendarDateUTC(),
      description: hadEarlierSubscription
        ? `Renewed ${subscription.plan}${queuedNote}`
        : `Subscribed to ${subscription.plan}${queuedNote}`,
      category: hadEarlierSubscription ? 'renewal' : 'subscription'
    });
  } catch (error) {
    console.error('Error logging subscription activity:', error.message);
  }
};

module.exports = { logSubscriptionActivity };
