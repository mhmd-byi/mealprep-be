const cron = require('node-cron');
const MealCancellation = require('../models/mealcancellation');
const Subscription = require('../models/subscriptionModel');

// Set timezone for cron jobs
const TIMEZONE = 'Asia/Kolkata'; // UTC+05:30 (Indian Standard Time)

async function subtractMealBalance(mealType) {
  // Create date in UTC to match database format
  const now = new Date();
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  console.log('this is now with ISO', utcDate.toISOString());
  console.log('this is now without ISO', utcDate);

  // Find all active cancellations for today and the specific meal type
  const cancellationsToday = await MealCancellation.find({
    startDate: { $lte: utcDate },
    endDate: { $gte: utcDate },
    $or: [
      { mealType: mealType },
      { mealType: 'both' }
    ]
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

// Schedule tasks to run every day at 10:45 AM and 4:45 PM IST, excluding sundays
cron.schedule('05 11 * * 1-6', () => {
  subtractMealBalance('lunch');
  console.log(`Subtracted lunch balances at 11:00 AM IST`); // changing time to 11am for testing
}, {
  timezone: TIMEZONE
});

cron.schedule('45 16 * * 1-6', () => {
  subtractMealBalance('dinner');
  console.log(`Subtracted dinner balances at 4:45 PM IST`);
}, {
  timezone: TIMEZONE
});
