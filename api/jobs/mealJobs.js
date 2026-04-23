const cron = require('node-cron');
const MealCancellation = require('../models/mealcancellation');
const Subscription = require('../models/subscriptionModel');
const Holiday = require('../models/holidayModel');
const mongoose = require('mongoose');

// Set timezone for cron jobs
const TIMEZONE = 'Asia/Kolkata'; // UTC+05:30 (Indian Standard Time)

// Function to check if today is a holiday
async function isHoliday() {
  try {
    // Get current date in IST directly to ensure we align with business days
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
    const todayDate = nowIST.toISOString().split('T')[0];

    // Construct UTC query range for the entire day (00:00:00 to 23:59:59)
    const todayStartUTC = new Date(todayDate + 'T00:00:00.000Z');
    const todayEndUTC = new Date(todayDate + 'T23:59:59.999Z');

    console.log(`Checking for holiday on ${todayDate} (Query: ${todayStartUTC.toISOString()} - ${todayEndUTC.toISOString()})`);

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

    console.log(`No holiday found for ${todayDate}`);
    return false;
  } catch (error) {
    console.error('CRITICAL ERROR checking holiday status:', error);
    // Fail safe: If we can't check holiday status, we probably shouldn't deduct meals automatically?
    // However, failing open (return false) is standard to avoid service disruption.
    // We will stick to return false but log loudly.
    return false;
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

  console.log(`Excluding ${userIdsToExclude.length} users due to meal cancellations for ${mealType}:`, userIdsToExclude);

  // Build a dynamic update object based on mealType
  let updateField = `${mealType}Meals`; // Assumes the field names are 'lunchMeals' and 'dinnerMeals'

  // Build query to:
  // 1. Exclude users with active cancellations
  // 2. Only include users whose subscription has started (subscriptionStartDate <= today)
  // 3. Only include users with meals remaining
  // 4. Only touch ACTIVE subscriptions — never queued ones
  const query = {
    userId: { $nin: userIdsToExclude },
    status: 'active',
    [updateField]: { $gt: 0 }
  };

  // First, let's check which users will be affected
  const usersToUpdate = await Subscription.find(query);

  // Filter users based on subscriptionStartDate
  const eligibleUsers = [];
  const skippedUsers = [];

  for (const subscription of usersToUpdate) {
    const subscriptionStartDate = subscription.subscriptionStartDate.toISOString().split('T')[0];

    // Check if subscription has started
    if (subscriptionStartDate <= todayDate) {
      eligibleUsers.push(subscription);
    } else {
      skippedUsers.push({
        userId: subscription.userId,
        subscriptionStartDate: subscriptionStartDate,
        reason: 'Subscription has not started yet'
      });
    }
  }

  console.log(`Found ${eligibleUsers.length} eligible users for ${mealType} meal subtraction`);
  console.log('Eligible users:', eligibleUsers.map(user => ({
    userId: user.userId,
    [updateField]: user[updateField],
    subscriptionStartDate: user.subscriptionStartDate.toISOString().split('T')[0]
  })));

  if (skippedUsers.length > 0) {
    console.log(`Skipped ${skippedUsers.length} users whose subscriptions haven't started:`, skippedUsers);
  }

  // Update only eligible users (subscription started and not cancelled)
  const finalQuery = {
    _id: { $in: eligibleUsers.map(user => user._id) },
    [updateField]: { $gt: 0 }
  };

  // Subtract meal from eligible users who have at least one meal left
  const result = await Subscription.updateMany(
    finalQuery,
    { $inc: { [updateField]: -1 } } // Dynamically decrement the appropriate meal field
  );

  console.log(`${mealType} meal subtraction result:`, {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    excludedDueToCancellations: userIdsToExclude.length,
    skippedDueToStartDate: skippedUsers.length
  });
}

/**
 * After each meal deduction cycle, check if any active subscription has reached 0 meals.
 * If so, mark it 'completed' and activate the oldest queued plan for that user.
 * The activation applies adjustMealCountsForTime using the real activation time (today).
 */
async function activateNextQueuedPlan() {
  try {
    console.log('Checking for exhausted active subscriptions to activate queued plans...');

    // Find all active subscriptions with no meals remaining
    const exhausted = await Subscription.find({
      status: 'active',
      lunchMeals: 0,
      dinnerMeals: 0,
      nextDayLunchMeals: 0,
      nextDayDinnerMeals: 0
    });

    if (exhausted.length === 0) {
      console.log('No exhausted active subscriptions found.');
      return;
    }

    // Get current time in IST for meal adjustment
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
    const currentHour = nowIST.getHours();
    const currentMinutes = nowIST.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinutes;
    const activationDateStr = nowIST.toISOString().split('T')[0];

    for (const sub of exhausted) {
      // Mark the exhausted plan as completed
      await Subscription.findByIdAndUpdate(sub._id, { status: 'completed' });
      console.log(`Marked subscription ${sub._id} as 'completed' for user ${sub.userId}`);

      // Find the oldest queued plan for this user
      const queuedSub = await Subscription.findOne({ userId: sub.userId, status: 'queued' }).sort({ createdAt: 1, _id: 1 });
      if (!queuedSub) {
        console.log(`No queued subscription found for user ${sub.userId}`);
        continue;
      }

      // Re-distribute meal counts based on lunchDinner preference and current real time
      // mealStartDate stored in queuedSub is the intended date; since it's activating NOW,
      // use today's date as the effective start
      const totalMeals = queuedSub.totalMeals || 0;
      // Detect lunchDinner preference from stored raw counts
      let lunchDinner = 'both';
      const rawLunch = queuedSub.lunchMeals || 0;
      const rawDinner = queuedSub.dinnerMeals || 0;
      if (rawLunch > 0 && rawDinner === 0) lunchDinner = 'lunch';
      else if (rawDinner > 0 && rawLunch === 0) lunchDinner = 'dinner';

      // Determine meal split
      let lunchMeals = rawLunch;
      let dinnerMeals = rawDinner;
      let nextDayLunchMeals = 0;
      let nextDayDinnerMeals = 0;

      const lunchTimePassed = currentTimeInMinutes > 10.5 * 60; // 10:30 AM
      const dinnerTimePassed = currentTimeInMinutes > 16 * 60;  // 4:00 PM

      // If lunch delivery has already happened today, move lunch to nextDay
      if (lunchTimePassed && lunchMeals > 0) {
        nextDayLunchMeals = lunchMeals;
        lunchMeals = 0;
        console.log(`Activation after 10:30 AM — moving ${nextDayLunchMeals} lunch meals to nextDay for user ${sub.userId}`);
      }
      // If dinner delivery has already happened today, move dinner to nextDay
      if (dinnerTimePassed && dinnerMeals > 0) {
        nextDayDinnerMeals = dinnerMeals;
        dinnerMeals = 0;
        console.log(`Activation after 4:00 PM — moving ${nextDayDinnerMeals} dinner meals to nextDay for user ${sub.userId}`);
      }

      await Subscription.findByIdAndUpdate(queuedSub._id, {
        status: 'active',
        subscriptionStartDate: new Date(activationDateStr),
        lunchMeals,
        dinnerMeals,
        nextDayLunchMeals,
        nextDayDinnerMeals
      });

      console.log(`Activated queued subscription ${queuedSub._id} (plan: ${queuedSub.plan}) for user ${sub.userId}`);
    }
  } catch (error) {
    console.error('Error activating queued plans:', error);
  }
}

// Function to transfer next-day meals to current day meals
async function transferNextDayMeals() {
  console.log('Transferring next-day meals to current day meals...');

  try {
    // Get current date in YYYY-MM-DD format
    const today = new Date();
    const currentDate = today.toISOString().split('T')[0];

    // Find all active subscriptions with next-day meals
    const subscriptionsWithNextDayMeals = await Subscription.find({
      status: 'active', // Never transfer meals on queued subscriptions
      $or: [
        { nextDayLunchMeals: { $gt: 0 } },
        { nextDayDinnerMeals: { $gt: 0 } }
      ]
    });

    for (const subscription of subscriptionsWithNextDayMeals) {
      // Get subscription start date in YYYY-MM-DD format for comparison
      const subscriptionStartDate = subscription.subscriptionStartDate.toISOString().split('T')[0];

      // Check if subscription start date is less than or equal to current date (includes today)
      if (!subscription.subscriptionStartDate || subscriptionStartDate > currentDate) {
        console.log(`Skipping transfer for user ${subscription.userId} - subscriptionStartDate (${subscriptionStartDate}) is after current date (${currentDate})`);
        continue;
      }

      // Log when transferring for a subscription that starts today
      if (subscriptionStartDate === currentDate) {
        console.log(`Transferring meals for user ${subscription.userId} - subscription starts today (${subscriptionStartDate})`);
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

// Schedule task to transfer next-day meals at 5:30 AM IST
cron.schedule('30 5 * * *', () => {
  transferNextDayMeals();
  console.log('Next-day meal transfer scheduled at 5:30 AM IST');
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
  await subtractMealBalance('lunch');
  // After deducting, activate any queued plans for users whose active plan just hit 0
  await activateNextQueuedPlan();
  console.log(`Subtracted lunch balances and checked queued plans at 10:45 AM IST`);
}, {
  timezone: TIMEZONE
});

cron.schedule('45 16 * * 1-6', async () => {
  const holidayToday = await isHoliday();
  if (holidayToday) {
    console.log('Skipping dinner meal subtraction due to holiday');
    return;
  }
  await subtractMealBalance('dinner');
  // After deducting, activate any queued plans for users whose active plan just hit 0
  await activateNextQueuedPlan();
  console.log(`Subtracted dinner balances and checked queued plans at 4:45 PM IST`);
}, {
  timezone: TIMEZONE
});
