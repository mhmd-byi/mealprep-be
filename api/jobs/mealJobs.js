const cron = require('node-cron');
const MealCancellation = require('../models/mealcancellation');
const Subscription = require('../models/subscriptionModel');
const Holiday = require('../models/holidayModel');

// Set timezone for cron jobs
const TIMEZONE = 'Asia/Kolkata'; // UTC+05:30 (Indian Standard Time)

// Function to check if today is a holiday
async function isHoliday() {
  const today = new Date();
  // Get today's date at midnight UTC to match the database format
  const todayDate = today.toISOString().split('T')[0];
  const todayStartUTC = new Date(todayDate + 'T00:00:00.000Z');
  const todayEndUTC = new Date(todayDate + 'T23:59:59.999Z');
  
  try {
    const holiday = await Holiday.findOne({
      date: {
        $gte: todayStartUTC,
        $lte: todayEndUTC
      }
    });
    
    if (holiday) {
      console.log(`Today (${todayDate}) is a holiday: ${holiday.description}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error checking holiday status:', error);
    return false; // In case of error, proceed with normal operation
  }
}

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

// Function to transfer next-day meals to current day meals
async function transferNextDayMeals() {
  console.log('Transferring next-day meals to current day meals...');
  
  try {
    // Get current date in YYYY-MM-DD format
    const today = new Date();
    const currentDate = today.toISOString().split('T')[0];
    
    // Find all subscriptions with next-day meals
    const subscriptionsWithNextDayMeals = await Subscription.find({
      $or: [
        { nextDayLunchMeals: { $gt: 0 } },
        { nextDayDinnerMeals: { $gt: 0 } }
      ]
    });

    for (const subscription of subscriptionsWithNextDayMeals) {
      // Get subscription start date in YYYY-MM-DD format for comparison
      const subscriptionStartDate = subscription.subscriptionStartDate.toISOString().split('T')[0];
      
      // Check if subscription start date is less than or equal to current date
      if (!subscription.subscriptionStartDate || subscriptionStartDate > currentDate) {
        console.log(`Skipping transfer for user ${subscription.userId} - subscriptionStartDate (${subscriptionStartDate}) is after current date (${currentDate})`);
        continue;
      }
      
      const updates = {};
      
      // Transfer next-day lunch meals to current day
      if (subscription.nextDayLunchMeals > 0) {
        updates.lunchMeals = (subscription.lunchMeals || 0) + subscription.nextDayLunchMeals;
        updates.nextDayLunchMeals = 0;
        console.log(`Transferred ${subscription.nextDayLunchMeals} lunch meals to current day for user ${subscription.userId}`);
      }
      
      // Transfer next-day dinner meals to current day
      if (subscription.nextDayDinnerMeals > 0) {
        updates.dinnerMeals = (subscription.dinnerMeals || 0) + subscription.nextDayDinnerMeals;
        updates.nextDayDinnerMeals = 0;
        console.log(`Transferred ${subscription.nextDayDinnerMeals} dinner meals to current day for user ${subscription.userId}`);
      }
      
      // Update the subscription
      if (Object.keys(updates).length > 0) {
        await Subscription.findByIdAndUpdate(subscription._id, updates);
      }
    }
    
    console.log('Next-day meal transfer completed');
  } catch (error) {
    console.error('Error transferring next-day meals:', error);
  }
}

// Schedule task to transfer next-day meals at 12:00 AM IST (midnight)
cron.schedule('0 0 * * *', () => {
  transferNextDayMeals();
  console.log('Next-day meal transfer scheduled at 12:00 AM IST');
}, {
  timezone: TIMEZONE
});

// Schedule tasks to run every day at 10:45 AM and 4:45 PM IST, excluding sundays
cron.schedule('45 10 * * 1-6', async () => {
  const holidayToday = await isHoliday();
  if (holidayToday) {
    console.log('Skipping lunch meal subtraction due to holiday');
    return;
  }
  subtractMealBalance('lunch');
  console.log(`Subtracted lunch balances at 10:45 AM IST`);
}, {
  timezone: TIMEZONE
});

cron.schedule('45 16 * * 1-6', async () => {
  const holidayToday = await isHoliday();
  if (holidayToday) {
    console.log('Skipping dinner meal subtraction due to holiday');
    return;
  }
  subtractMealBalance('dinner');
  console.log(`Subtracted dinner balances at 4:45 PM IST`);
}, {
  timezone: TIMEZONE
});
