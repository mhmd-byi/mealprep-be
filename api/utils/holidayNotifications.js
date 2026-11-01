const { MailtrapClient } = require('mailtrap');
const Subscription = require('../models/subscriptionModel');
const User = require('../models/userModel');
const Activity = require('../models/activityModel');

const MEALS_LEFT = {
  $add: [
    { $ifNull: ['$lunchMeals', 0] },
    { $ifNull: ['$dinnerMeals', 0] },
    { $ifNull: ['$nextDayLunchMeals', 0] },
    { $ifNull: ['$nextDayDinnerMeals', 0] }
  ]
};

const notifyHolidayAdded = async (rangeLabel, description) => {
  try {
    const userIds = await Subscription.distinct('userId', {
      status: 'active',
      $expr: { $gt: [MEALS_LEFT, 0] }
    });
    if (userIds.length === 0) return;

    const today = new Date();
    await Activity.insertMany(
      userIds.map((userId) => ({
        userId,
        date: today,
        description: `Added a new holiday for ${rangeLabel}: ${description}`,
        category: 'holiday'
      }))
    );

    const users = await User.find({ _id: { $in: userIds } }, 'email firstName lastName').lean();
    const client = new MailtrapClient({ token: process.env.MAILTRAP_API_TOKEN });
    const sender = { email: 'hello@app.mealprep.co.in', name: 'Mealprep' };

    for (const user of users) {
      if (!user.email) continue;
      try {
        await client.send({
          from: sender,
          to: [{ email: user.email, name: `${user.firstName || ''} ${user.lastName || ''}`.trim() }],
          subject: 'New Holiday Added!',
          text:
            `Dear Customer,\n\n` +
            `We wanted to inform you that there is a holiday on ${rangeLabel}, due to ${description}. Please plan accordingly.\n\n` +
            `Team Mealprep\n`
        });
      } catch (error) {
        console.error('Holiday email failed for a customer:', error.message);
      }
    }
  } catch (error) {
    console.error('Holiday notifications failed:', error.message);
  }
};

module.exports = { notifyHolidayAdded };
