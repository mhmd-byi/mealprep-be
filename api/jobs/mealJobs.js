const cron = require('node-cron');
const MealCancellation = require('../models/mealcancellation');
const Subscription = require('../models/subscriptionModel');

// Set timezone for cron jobs
const TIMEZONE = 'Asia/Kolkata'; // UTC+05:30 (Indian Standard Time)

async function subtractMealBalance(mealType) {
  // Get today's date in YYYY-MM-DD format
  const today = new Date();
  const todayDate = today.toISOString().split('T')[0];

  // Get all active cancellations
  const allCancellations = await MealCancellation.find({
    $or: [
      { mealType: mealType },
      { mealType: 'both' }
    ]
  });

  // Get user IDs to exclude based on date comparison
  const userIdsToExclude = [];
  
  for (const cancellation of allCancellations) {
    const startDate = cancellation.startDate.toISOString().split('T')[0];
    const endDate = cancellation.endDate.toISOString().split('T')[0];
    // Check if today's date falls within the cancellation period
    if (todayDate >= startDate && todayDate <= endDate) {
      userIdsToExclude.push(cancellation.userId); // Keep as ObjectId
    }
  }


  // Build a dynamic update object based on mealType
  let updateField = `${mealType}Meals`; // Assumes the field names are 'lunchMeals' and 'dinnerMeals'

  // Log the query we're about to execute
  const query = {
    userId: { $nin: userIdsToExclude },
    [updateField]: { $gt: 0 }
  };

  // First, let's check which users will be affected
  const usersToUpdate = await Subscription.find(query);
  console.log('Users that will be updated:', usersToUpdate.map(user => user.userId));

  // Subtract meal from users who haven't cancelled and have at least one meal left
  const result = await Subscription.updateMany(
    query,
    { $inc: { [updateField]: -1 } } // Dynamically decrement the appropriate meal field
  );

  console.log('Update result:', result);
}

// Schedule tasks to run every day at 10:45 AM and 4:45 PM IST, excluding sundays
cron.schedule('45 10 * * 1-6', () => {
  subtractMealBalance('lunch');
  console.log(`Subtracted lunch balances at 10:45 AM IST`);
}, {
  timezone: TIMEZONE
});

cron.schedule('45 16 * * 1-6', () => {
  subtractMealBalance('dinner');
  console.log(`Subtracted dinner balances at 4:45 PM IST`);
}, {
  timezone: TIMEZONE
});
