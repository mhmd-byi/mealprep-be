const cron = require('node-cron');
const MealCancellation = require('../models/mealcancellation');
const Subscription = require('../models/subscriptionModel');

async function subtractMealBalance(mealType) {
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Normalize time to start of day

  // Find all cancellations for today and the specific meal type
  const cancellationsToday = await MealCancellation.find({
    date: now,
    mealType: mealType
  });

  // Get user IDs to exclude
  const userIdsToExclude = cancellationsToday.map(cancel => cancel.userId);

  // Subtract meal from users who haven't cancelled
  await Subscription.updateMany(
    { _id: { $nin: userIdsToExclude } },
    { $inc: { meals: -1 } } // Assume meal cost is 1 unit
  );
}

// Schedule tasks to run every day at 9 AM for lunch and 4 PM for dinner
cron.schedule('0 9 * * *', () => {
  subtractMealBalance('lunch');
  console.log('Subtracted lunch balances at 9 AM');
});

cron.schedule('0 16 * * *', () => {
  subtractMealBalance('dinner');
  console.log('Subtracted dinner balances at 4 PM');
});
