const cron = require('node-cron');
const MealCancellation = require('../models/mealcancellation');
const Subscription = require('../models/subscriptionModel');
const Holiday = require('../models/holidayModel');
const MealDelivery = require('../models/mealDeliveryModel');
const Activity = require('../models/activityModel');
const mongoose = require('mongoose');
const {
  IST_ZONE,
  nowIST,
  currentISTMinutesSinceMidnight,
  todayCalendarDateUTC,
  parseCalendarDate,
  calendarDateKey,
  calendarDateRangeUTC
} = require('../utils/dateUtils');

// Set timezone for cron jobs
const TIMEZONE = IST_ZONE; // UTC+05:30 (Indian Standard Time)
const LUNCH_CUTOFF_MINUTES = 10.5 * 60; // 10:30 AM
const DINNER_CUTOFF_MINUTES = 16 * 60; // 4:00 PM

// Function to check if today is a holiday
async function isHoliday() {
  try {
    // Get current date in IST directly to ensure we align with business days
    const today = todayCalendarDateUTC();
    const { start: todayStartUTC, end: todayEndUTC } = calendarDateRangeUTC(today);
    const todayKey = calendarDateKey(today);

    console.log(`Checking for holiday on ${todayKey} (Query: ${todayStartUTC.toISOString()} - ${todayEndUTC.toISOString()})`);

    const holiday = await Holiday.findOne({
      date: {
        $gte: todayStartUTC,
        $lte: todayEndUTC
      }
    });

    if (holiday) {
      console.log(`Today (${todayKey}) is a holiday: ${holiday.description}`);
      return true;
    }

    console.log(`No holiday found for ${todayKey}`);
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
  // `now` is a real timestamp for the delivery/activity records below; `todayCalendar`
  // is the IST calendar day (explicit, portable regardless of the server's own
  // timezone) used for every date-only eligibility comparison.
  const now = new Date();
  const todayCalendar = todayCalendarDateUTC();

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
    if (!cancellation.startDate || !cancellation.endDate) {
      console.warn(`Skipping cancellation ${cancellation._id} — missing startDate/endDate`);
      continue;
    }
    const startDate = parseCalendarDate(cancellation.startDate);
    const endDate = parseCalendarDate(cancellation.endDate);
    // Check if today's date falls within the cancellation period
    if (todayCalendar >= startDate && todayCalendar <= endDate) {
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
    const subscriptionStartDate = parseCalendarDate(subscription.subscriptionStartDate);

    // Check if subscription has started
    if (subscriptionStartDate <= todayCalendar) {
      eligibleUsers.push(subscription);
    } else {
      skippedUsers.push({
        userId: subscription.userId,
        subscriptionStartDate: calendarDateKey(subscriptionStartDate),
        reason: 'Subscription has not started yet'
      });
    }
  }

  console.log(`Found ${eligibleUsers.length} eligible users for ${mealType} meal subtraction`);
  console.log('Eligible users:', eligibleUsers.map(user => ({
    userId: user.userId,
    [updateField]: user[updateField],
    subscriptionStartDate: calendarDateKey(parseCalendarDate(user.subscriptionStartDate))
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

  // Record a delivery for each user whose meal was actually deducted above.
  // Logged separately from the deduction so a logging failure never blocks it.
  if (eligibleUsers.length > 0) {
    try {
      const mealTypeLabel = mealType.charAt(0).toUpperCase() + mealType.slice(1);
      const todayLabel = nowIST().toFormat('EEE LLL dd yyyy');
      await MealDelivery.insertMany(eligibleUsers.map(sub => ({
        userId: sub.userId,
        subscriptionId: sub._id,
        date: now,
        mealType
      })));
      await Activity.insertMany(eligibleUsers.map(sub => ({
        userId: sub.userId,
        date: now,
        description: `${mealTypeLabel} meal delivered on ${todayLabel}`
      })));
      console.log(`Logged ${eligibleUsers.length} ${mealType} deliveries`);
    } catch (error) {
      console.error(`Error logging ${mealType} deliveries:`, error);
    }
  }
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
    const currentTimeInMinutes = currentISTMinutesSinceMidnight();
    const activationDate = todayCalendarDateUTC();

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

      const lunchTimePassed = currentTimeInMinutes > LUNCH_CUTOFF_MINUTES;
      const dinnerTimePassed = currentTimeInMinutes > DINNER_CUTOFF_MINUTES;

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
        subscriptionStartDate: activationDate,
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
    const currentDate = todayCalendarDateUTC();

    // Find all active subscriptions with next-day meals
    const subscriptionsWithNextDayMeals = await Subscription.find({
      status: 'active', // Never transfer meals on queued subscriptions
      $or: [
        { nextDayLunchMeals: { $gt: 0 } },
        { nextDayDinnerMeals: { $gt: 0 } }
      ]
    });

    for (const subscription of subscriptionsWithNextDayMeals) {
      const subscriptionStartDate = parseCalendarDate(subscription.subscriptionStartDate);

      // Check if subscription start date is less than or equal to current date (includes today)
      if (!subscription.subscriptionStartDate || subscriptionStartDate > currentDate) {
        console.log(`Skipping transfer for user ${subscription.userId} - subscriptionStartDate (${calendarDateKey(subscriptionStartDate)}) is after current date (${calendarDateKey(currentDate)})`);
        continue;
      }

      // Log when transferring for a subscription that starts today
      if (subscriptionStartDate.getTime() === currentDate.getTime()) {
        console.log(`Transferring meals for user ${subscription.userId} - subscription starts today (${calendarDateKey(subscriptionStartDate)})`);
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
