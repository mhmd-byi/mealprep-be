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

  // Build a dynamic update object based on mealType
  let updateField = `${mealType}Meals`; // Assumes the field names are 'lunchMeals' and 'dinnerMeals'

  // Subtract meal from users who haven't cancelled and have at least one meal left
  await Subscription.updateMany(
    {
      _id: { $nin: userIdsToExclude },
      [updateField]: { $gt: 0 } // Use dynamic field for checking if meals are greater than zero
    },
    { $inc: { [updateField]: -1 } } // Dynamically decrement the appropriate meal field
  );
}

// Schedule tasks to run every day at 9 AM for lunch and 4 PM for dinner, excluding sundays
cron.schedule('0 10 * * 1-6', () => {
  subtractMealBalance('lunch');
  console.log('Subtracted lunch balances at 10 AM');
});

cron.schedule('45 16 * * 1-6', () => {
  subtractMealBalance('dinner');
  console.log('Subtracted dinner balances at 4:45 PM');
});
