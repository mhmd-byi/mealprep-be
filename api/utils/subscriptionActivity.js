const Activity = require('../models/activityModel');
const { todayCalendarDateUTC } = require('./dateUtils');

const logSubscriptionActivity = async (userId, plan) => {
  try {
    await Activity.create({
      userId,
      date: todayCalendarDateUTC(),
      description: `Subscribed to ${plan}`,
      category: 'subscription'
    });
  } catch (error) {
    console.error('Error logging subscription activity:', error.message);
  }
};

module.exports = { logSubscriptionActivity };
