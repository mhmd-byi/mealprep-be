const cron = require('node-cron');
const MealCancellation = require('../models/mealcancellation');
const Subscription = require('../models/subscriptionModel');

// Set timezone for cron jobs
const TIMEZONE = 'Asia/Kolkata'; // UTC+05:30 (Indian Standard Time)

async function subtractMealBalance(mealType) {
  // Create start and end of current day in UTC
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  
  console.log('Start of day with ISO:', startOfDay.toISOString());
  console.log('End of day with ISO:', endOfDay.toISOString());
  console.log('Start of day:', startOfDay);
  console.log('End of day:', endOfDay);

  // Find all active cancellations for today and the specific meal type
  const cancellationsToday = await MealCancellation.find({
    $or: [
      // Case 1: Cancellation spans the entire current day
      {
        startDate: { $lte: startOfDay },
        endDate: { $gte: endOfDay }
      },
      // Case 2: Cancellation starts today
      {
        startDate: { $gte: startOfDay, $lt: endOfDay }
      },
      // Case 3: Cancellation ends today
      {
        endDate: { $gt: startOfDay, $lte: endOfDay }
      }
    ],
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
cron.schedule('31 11 * * 1-6', () => {
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
