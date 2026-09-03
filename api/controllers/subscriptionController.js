const User = require('../models/userModel');
const Subscription = require('../models/subscriptionModel');
const MealCancellation = require('../models/mealcancellation');
const MealDelivery = require('../models/mealDeliveryModel');
const MealDietaryPreference = require('../models/mealDietaryPreferenceModel');
const Holiday = require('../models/holidayModel');
const Activity = require('../models/activityModel');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Helper function to adjust meal counts based on current time and subscription start date
const adjustMealCountsForTime = (meals, lunchDinner = 'both', subscriptionStartDate = null) => {
  // Get current date and time in IST
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentHour = nowIST.getHours();
  const currentMinutes = nowIST.getMinutes();
  const currentTimeInMinutes = currentHour * 60 + currentMinutes;

  // Get current date in IST (YYYY-MM-DD) — must NOT use .toISOString() here as that
  // converts back to UTC, causing an off-by-one error around midnight IST.
  const currentDateYear = nowIST.getFullYear();
  const currentDateMonth = String(nowIST.getMonth() + 1).padStart(2, '0');
  const currentDateDay = String(nowIST.getDate()).padStart(2, '0');
  const currentDate = `${currentDateYear}-${currentDateMonth}-${currentDateDay}`;

  // Parse the subscription start date as a local-date string (YYYY-MM-DD) to avoid UTC
  // midnight shift. `new Date("YYYY-MM-DD")` is parsed as UTC, which would shift the
  // date one day back in IST (UTC+5:30) at midnight.
  const rawStartDate = subscriptionStartDate instanceof Date
    ? subscriptionStartDate
    : new Date(subscriptionStartDate);
  const sdYear = rawStartDate.getUTCFullYear();
  const sdMonth = String(rawStartDate.getUTCMonth() + 1).padStart(2, '0');
  const sdDay = String(rawStartDate.getUTCDate()).padStart(2, '0');
  const startDate = `${sdYear}-${sdMonth}-${sdDay}`;

  let lunchMeals = 0;
  let dinnerMeals = 0;
  let nextDayLunchMeals = 0;
  let nextDayDinnerMeals = 0;

  // Distribute meals based on meal type
  if (lunchDinner === 'lunch') {
    lunchMeals = meals;
  } else if (lunchDinner === 'dinner') {
    dinnerMeals = meals;
  } else {
    // Default: split meals between lunch and dinner
    lunchMeals = meals / 2;
    dinnerMeals = meals / 2;
  }

  // If no subscription start date provided, return meals as is
  if (!subscriptionStartDate) {
    return {
      lunchMeals,
      dinnerMeals,
      nextDayLunchMeals: 0,
      nextDayDinnerMeals: 0,
      lunchTimePassed: false,
      dinnerTimePassed: false,
      adjustedForTime: false
    };
  }

  const subscriptionStartsToday = startDate === currentDate;
  const subscriptionStartsInFuture = startDate > currentDate;

  // CASE 1: If subscription start date is GREATER than current date (future date)
  // Move ALL meals to next day
  if (subscriptionStartsInFuture) {
    console.log(`Subscription starts in future (${startDate}), moving all meals to next day`);
    return {
      lunchMeals: 0,
      dinnerMeals: 0,
      nextDayLunchMeals: lunchMeals,
      nextDayDinnerMeals: dinnerMeals,
      lunchTimePassed: false,
      dinnerTimePassed: false,
      adjustedForTime: true,
      reason: 'Subscription starts in the future - all meals moved to next day'
    };
  }

  // CASE 2: If subscription start date is SAME as current date
  // Apply time-based rules
  if (subscriptionStartsToday) {
    // Check if lunch time has passed (10:30 AM = 10.5 * 60 = 630 minutes)
    const lunchTimePassed = currentTimeInMinutes > 10.5 * 60;
    
    // Check if dinner time has passed (4:00 PM = 16 * 60 = 960 minutes)
    const dinnerTimePassed = currentTimeInMinutes > 16 * 60;

    // If lunch time has passed (after 9 AM), move lunch meals to next day
    if (lunchTimePassed && lunchMeals > 0) {
      nextDayLunchMeals = lunchMeals;
      lunchMeals = 0;
      console.log(`Current time after 9 AM, moving ${nextDayLunchMeals} lunch meals to next day`);
    }

    // If dinner time has passed (after 4 PM), move dinner meals to next day
    if (dinnerTimePassed && dinnerMeals > 0) {
      nextDayDinnerMeals = dinnerMeals;
      dinnerMeals = 0;
      console.log(`Current time after 4 PM, moving ${nextDayDinnerMeals} dinner meals to next day`);
    }

    console.log(`Subscription starts today (${startDate}), time-based adjustment applied`);
    return {
      lunchMeals,
      dinnerMeals,
      nextDayLunchMeals,
      nextDayDinnerMeals,
      lunchTimePassed,
      dinnerTimePassed,
      adjustedForTime: lunchTimePassed || dinnerTimePassed,
      reason: 'Subscription starts today - time-based adjustment applied'
    };
  }

  // CASE 3: If subscription started in the PAST
  // Keep meals in current day slots
  console.log(`Subscription already started (${startDate}), keeping meals in current day`);
  return {
    lunchMeals,
    dinnerMeals,
    nextDayLunchMeals: 0,
    nextDayDinnerMeals: 0,
    lunchTimePassed: false,
    dinnerTimePassed: false,
    adjustedForTime: false,
    reason: 'Subscription already started'
  };
};

const createSubscription = async (req, res) => {
  try {
    const { userId, plan, startDate, meals, allergy } = req.body;

    if (!userId || !plan || !startDate || !meals) {
      return res
        .status(400)
        .json({ message: 'Missing required fields: userId, plan, meals and startDate are required.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const validPlans = ['Trial Meal Pack', 'Trial Meal Plan', 'Weekly Plan', 'Monthly Plan'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ message: 'Invalid plan' });
    }

    const subscriptionStartDate = new Date(startDate);

    // Adjust meal counts based on current time and subscription start date
    const mealAdjustment = adjustMealCountsForTime(meals, 'both', subscriptionStartDate);

    const subscription = new Subscription({
      userId,
      subscriptionStartDate,
      plan,
      lunchMeals: mealAdjustment.lunchMeals,
      dinnerMeals: mealAdjustment.dinnerMeals,
      nextDayLunchMeals: mealAdjustment.nextDayLunchMeals,
      nextDayDinnerMeals: mealAdjustment.nextDayDinnerMeals,
      mealType: req.body.mealType || "",
      carbType: req.body.carbType || "",
      totalMeals: meals,
      allergy: allergy || ""
    });

    const savedSubscription = await subscription.save();
    
    // Include time adjustment information in response
    const response = {
      ...savedSubscription.toObject(),
      timeAdjustment: {
        lunchTimePassed: mealAdjustment.lunchTimePassed,
        dinnerTimePassed: mealAdjustment.dinnerTimePassed,
        adjustedForTime: mealAdjustment.adjustedForTime
      }
    };
    
    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ message: error.message });
  }
};

const getSubscriptionDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    // Fetch the active plan (status = 'active')
    const activeSub = await Subscription.findOne({ userId, status: 'active' }).sort({ createdAt: -1, _id: -1 });

    // Fetch the queued plan (status = 'queued'), oldest first so the earliest-queued activates next
    const queuedSub = await Subscription.findOne({ userId, status: 'queued' }).sort({ createdAt: 1, _id: 1 });

    if (!activeSub) {
      return res.json({ isSubscribed: false, currentPlan: null, nextPlan: queuedSub || null });
    }

    // Calculate meals for the active plan
    const currentLunchMeals = activeSub.lunchMeals || 0;
    const currentDinnerMeals = activeSub.dinnerMeals || 0;
    const nextDayLunchMeals = activeSub.nextDayLunchMeals || 0;
    const nextDayDinnerMeals = activeSub.nextDayDinnerMeals || 0;

    const currentMeals = currentLunchMeals + currentDinnerMeals;
    const nextDayMeals = nextDayLunchMeals + nextDayDinnerMeals;
    const totalMeals = currentMeals + nextDayMeals;

    const response = {
      isSubscribed: totalMeals > 0,
      // Keep 'subscription' key for backward compat with existing frontend code
      subscription: {
        ...activeSub.toObject(),
        currentLunchMeals,
        currentDinnerMeals,
        nextDayLunchMeals,
        nextDayDinnerMeals,
        totalCurrentMeals: currentMeals,
        totalNextDayMeals: nextDayMeals,
        totalAvailableMeals: totalMeals
      },
      // Explicit currentPlan and nextPlan for new UI
      currentPlan: {
        ...activeSub.toObject(),
        currentLunchMeals,
        currentDinnerMeals,
        nextDayLunchMeals,
        nextDayDinnerMeals,
        totalCurrentMeals: currentMeals,
        totalNextDayMeals: nextDayMeals,
        totalAvailableMeals: totalMeals
      },
      nextPlan: queuedSub ? queuedSub.toObject() : null
    };

    res.json(response);
  } catch (error) {
    console.error('Error getting subscription details:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const cancelMealRequest = async (req, res) => {
  try {
    const { userId, startDate, endDate, mealType } = req.body;

    if (!userId || !startDate || !endDate || !mealType) {
      return res.status(400).json({ 
        message: 'Missing required fields: userId, startDate, endDate, and mealType are required.' 
      });
    }

    // Duplicate cancellation check
    const duplicate = await MealCancellation.findOne({
      userId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      mealType
    });
    if (duplicate) {
      return res.status(400).json({
        message: 'You have already cancelled this meal for the selected date and meal type.'
      });
    }

    // Create dates in IST
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Get current date and time in IST
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const todayIST = new Date(nowIST);
    todayIST.setHours(0, 0, 0, 0);

    // Convert current time to minutes (IST)
    const currentHour = nowIST.getHours();
    const currentMinutes = nowIST.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinutes;

    // Format start date to compare with today
    const startDate0Hour = new Date(start);
    startDate0Hour.setHours(0, 0, 0, 0);

    // Check if the start date is today
    const isStartDateToday = startDate0Hour.getTime() === todayIST.getTime();
    
    // If it's a future date, allow the cancellation
    if (startDate0Hour > todayIST) {
      // Process normally for future dates
    } 
    // If it's today, apply time restrictions
    else if (isStartDateToday) {
      if (mealType === 'both') {
        const errors = [];

        // Check lunch restriction (after 10:30 AM)
        if (currentTimeInMinutes > 10.5 * 60) {
          errors.push('Lunch cancellation for today must be done before 10:30 AM');
        }

        // Check dinner restriction (after 4:00 PM)
        if (currentTimeInMinutes > 16 * 60) {
          errors.push('Dinner cancellation for today must be done before 4:00 PM');
        }

        if (errors.length > 0) {
          return res.status(400).json({
            message: 'Time restriction errors',
            errors: errors
          });
        }
      }
      else if (mealType === 'lunch' && currentTimeInMinutes > 10.5 * 60) {
        return res.status(400).json({
          message: 'Lunch cancellation for today must be done before 10:30 AM'
        });
      }
      else if (mealType === 'dinner' && currentTimeInMinutes > 16 * 60) {
        return res.status(400).json({
          message: 'Dinner cancellation for today must be done before 4:00 PM'
        });
      }
    }
    // If it's a past date, reject the cancellation
    else {
      return res.status(400).json({ 
        message: 'Cannot cancel meals for past dates' 
      });
    }

    if (end < start) {
      return res.status(400).json({ 
        message: 'Invalid date range. End date must be after start date.' 
      });
    }

    const newCancellation = new MealCancellation({
      userId,
      startDate: start,
      endDate: end,
      mealType
    });

    const activityData = new Activity({
      userId,
      date: new Date(),
      description: `Meal cancellation request for ${mealType} meal from ${start.toDateString()} to ${end.toDateString()}`
    });

    await activityData.save();
    await newCancellation.save();
    res.json({ message: 'Meal cancellation request submitted successfully' });
  } catch (error) {
    console.error('Error cancelling meal:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const getCancelledMeals = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'Missing required date.' });
    }

    const queryDate = new Date(date);

    const cancelledMeals = await MealCancellation.find({
      startDate: { $lte: queryDate },
      endDate: { $gte: queryDate }
    }).exec();

    if (cancelledMeals.length === 0) {
      return res.status(404).json({ message: 'No cancelled meals found.' });
    }

    const userFetchPromises = cancelledMeals.map(meal => User.findById(meal.userId).exec());
    const users = await Promise.all(userFetchPromises);

    const formattedMeals = cancelledMeals.map((meal, index) => ({
      userId: meal.userId._id,
      name: `${users[index].firstName} ${users[index].lastName}`,
      startDate: meal.startDate,
      endDate: meal.endDate,
      mealType: meal.mealType,
      createdAt: meal.createdAt,
      mobile: users[index].mobile
    }));

    res.json(formattedMeals);
  } catch (error) {
    console.error('Error fetching cancelled meals:', error);
    res.status(404).json({ message: error.message });
  }
};

const getDeliveredMeals = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'Missing required date.' });
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const deliveredMeals = await MealDelivery.find({
      date: { $gte: startOfDay, $lte: endOfDay }
    }).exec();

    if (deliveredMeals.length === 0) {
      return res.json([]);
    }

    const userFetchPromises = deliveredMeals.map(meal => User.findById(meal.userId).exec());
    const users = await Promise.all(userFetchPromises);

    const formattedMeals = deliveredMeals.map((meal, index) => ({
      userId: meal.userId,
      name: users[index] ? `${users[index].firstName} ${users[index].lastName}` : 'Unknown User',
      mobile: users[index]?.mobile || '',
      date: meal.date,
      mealType: meal.mealType,
      createdAt: meal.createdAt
    }));

    res.json(formattedMeals);
  } catch (error) {
    console.error('Error fetching delivered meals:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ── Dietary preference (veg / non-veg per day, for "both" meal-type plans) ──
// A day is locked (unchangeable) once it's within this many days of today, so
// the client always has a guaranteed clean runway of confirmed counts to shop against.
const DIET_LOCK_DAYS = 3;
// Safety ceiling on the schedule window — the real size is derived from remaining
// meals (see getMealSchedule), this just guards against bad/anomalous data (e.g.
// a manually-granted test subscription with an unrealistic meal count) causing a
// runaway date range.
const DIET_SCHEDULE_WINDOW_DAYS_CAP = 60;

const getISTNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

// Local (not UTC) date parts — avoids the day drifting near the IST midnight boundary.
const formatDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isDateLocked = (date, todayStart) => {
  const diffDays = Math.round((startOfDay(date) - todayStart) / (24 * 60 * 60 * 1000));
  return diffDays < DIET_LOCK_DAYS;
};

const getMealSchedule = async (req, res) => {
  try {
    const { userId } = req.params;

    const activeSub = await Subscription.findOne({ userId, status: 'active' }).sort({ createdAt: -1, _id: -1 });
    if (!activeSub || activeSub.mealType !== 'both') {
      return res.json({ applicable: false, days: [] });
    }

    const remainingLunch = (activeSub.lunchMeals || 0) + (activeSub.nextDayLunchMeals || 0);
    const remainingDinner = (activeSub.dinnerMeals || 0) + (activeSub.nextDayDinnerMeals || 0);
    const hasLunch = remainingLunch > 0;
    const hasDinner = remainingDinner > 0;

    // Lunch+dinner both selected delivers both on the same day (not spread across
    // more days), so the window is however many calendar days the remaining meals
    // actually cover — not a fixed number. It naturally shrinks as meals get used.
    const mealsPerDay = (hasLunch ? 1 : 0) + (hasDinner ? 1 : 0);
    if (mealsPerDay === 0) {
      return res.json({ applicable: true, days: [] });
    }
    const scheduleWindowDays = Math.min(
      Math.ceil((remainingLunch + remainingDinner) / mealsPerDay),
      DIET_SCHEDULE_WINDOW_DAYS_CAP
    );

    const todayStart = startOfDay(getISTNow());
    const subStart = startOfDay(activeSub.subscriptionStartDate);
    // A plan bought today for a future start date has no deliveries before that
    // start date — the window (and lock check) must never begin earlier than it.
    const windowStart = subStart > todayStart ? subStart : todayStart;
    // Query a generously padded raw span — Sundays (and any holidays) inside the
    // window consume calendar days without producing a delivery day, so covering
    // `scheduleWindowDays` real days needs more than that many raw days.
    const rawSpanDays = scheduleWindowDays * 2;
    const windowEnd = addDays(windowStart, rawSpanDays);

    const holidays = await Holiday.find({ date: { $gte: windowStart, $lte: windowEnd } });
    const holidayKeys = new Set(holidays.map(h => formatDateKey(h.date)));

    const prefRows = await MealDietaryPreference.find({
      userId,
      date: { $gte: windowStart, $lte: windowEnd }
    });
    const prefMap = new Map();
    prefRows.forEach(r => prefMap.set(`${formatDateKey(r.date)}_${r.mealSlot}`, r.preference));

    const days = [];
    for (let i = 0; i < rawSpanDays && days.length < scheduleWindowDays; i++) {
      const date = addDays(windowStart, i);
      if (date.getDay() === 0) continue; // no delivery on Sundays
      const dateKey = formatDateKey(date);
      if (holidayKeys.has(dateKey)) continue; // no delivery on holidays

      const dayEntry = { date: dateKey, locked: isDateLocked(date, todayStart) };
      if (hasLunch) {
        dayEntry.lunch = prefMap.get(`${dateKey}_lunch`) || 'veg';
      }
      if (hasDinner) {
        dayEntry.dinner = prefMap.get(`${dateKey}_dinner`) || 'veg';
      }
      days.push(dayEntry);
    }

    res.json({ applicable: true, days });
  } catch (error) {
    console.error('Error fetching meal schedule:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const updateMealSchedule = async (req, res) => {
  try {
    const { userId, date, mealSlot, preference } = req.body;

    if (!userId || !date || !mealSlot || !preference) {
      return res.status(400).json({ message: 'userId, date, mealSlot and preference are required.' });
    }
    if (!['lunch', 'dinner'].includes(mealSlot)) {
      return res.status(400).json({ message: 'mealSlot must be "lunch" or "dinner".' });
    }
    if (!['veg', 'non-veg'].includes(preference)) {
      return res.status(400).json({ message: 'preference must be "veg" or "non-veg".' });
    }

    const activeSub = await Subscription.findOne({ userId, status: 'active' }).sort({ createdAt: -1, _id: -1 });
    if (!activeSub || activeSub.mealType !== 'both') {
      return res.status(400).json({ message: 'This user does not have an active "Both" meal-type subscription.' });
    }

    const hasSlot = mealSlot === 'lunch'
      ? ((activeSub.lunchMeals || 0) > 0 || (activeSub.nextDayLunchMeals || 0) > 0)
      : ((activeSub.dinnerMeals || 0) > 0 || (activeSub.nextDayDinnerMeals || 0) > 0);
    if (!hasSlot) {
      return res.status(400).json({ message: `This plan does not include ${mealSlot}.` });
    }

    const requestedDate = startOfDay(new Date(date));
    const todayStart = startOfDay(getISTNow());
    const subStart = startOfDay(activeSub.subscriptionStartDate);

    if (requestedDate < todayStart) {
      return res.status(400).json({ message: 'Cannot set a preference for a past date.' });
    }
    if (requestedDate < subStart) {
      return res.status(400).json({ message: 'Cannot set a preference before the plan\'s start date.' });
    }
    if (isDateLocked(requestedDate, todayStart)) {
      return res.status(400).json({
        message: `This day is locked — it's within ${DIET_LOCK_DAYS} days of delivery and stock has already been planned against it. You can still change any day ${DIET_LOCK_DAYS}+ days out.`
      });
    }

    await MealDietaryPreference.findOneAndUpdate(
      { userId, date: requestedDate, mealSlot },
      { userId, subscriptionId: activeSub._id, date: requestedDate, mealSlot, preference },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ message: 'Preference updated successfully.' });
  } catch (error) {
    console.error('Error updating meal schedule:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const getDietaryStockReport = async (req, res) => {
  try {
    const todayStart = startOfDay(getISTNow());
    const windowEnd = addDays(todayStart, DIET_LOCK_DAYS - 1);

    const holidays = await Holiday.find({ date: { $gte: todayStart, $lte: windowEnd } });
    const holidayKeys = new Set(holidays.map(h => formatDateKey(h.date)));

    const reportDates = [];
    for (let i = 0; i < DIET_LOCK_DAYS; i++) {
      const date = addDays(todayStart, i);
      if (date.getDay() === 0) continue;
      const dateKey = formatDateKey(date);
      if (holidayKeys.has(dateKey)) continue;
      reportDates.push(date);
    }

    const activeSubs = await Subscription.find({ status: 'active' });

    const cancellations = await MealCancellation.find({
      startDate: { $lte: reportDates[reportDates.length - 1] || todayStart },
      endDate: { $gte: todayStart }
    });
    const isCancelled = (userId, date, mealSlot) => cancellations.some(c =>
      c.userId.toString() === userId.toString() &&
      startOfDay(c.startDate) <= date && startOfDay(c.endDate) >= date &&
      (c.mealType === mealSlot || c.mealType === 'both')
    );

    const bothUserIds = activeSubs.filter(s => s.mealType === 'both').map(s => s.userId);
    const prefRows = await MealDietaryPreference.find({
      userId: { $in: bothUserIds },
      date: { $gte: todayStart, $lte: windowEnd }
    });
    const prefMap = new Map();
    prefRows.forEach(r => prefMap.set(`${r.userId}_${formatDateKey(r.date)}_${r.mealSlot}`, r.preference));

    // Running remaining-meal projection per subscription across the report window —
    // a subscription that's about to run out shouldn't be counted on days past its last meal.
    const remaining = new Map();
    activeSubs.forEach(sub => remaining.set(sub._id.toString(), {
      lunch: (sub.lunchMeals || 0) + (sub.nextDayLunchMeals || 0),
      dinner: (sub.dinnerMeals || 0) + (sub.nextDayDinnerMeals || 0)
    }));

    const report = reportDates.map(date => {
      const dateKey = formatDateKey(date);
      const counts = {
        date: dateKey,
        lunch: { veg: 0, nonVeg: 0 },
        dinner: { veg: 0, nonVeg: 0 }
      };

      for (const sub of activeSubs) {
        if (startOfDay(sub.subscriptionStartDate) > date) continue;

        const subRemaining = remaining.get(sub._id.toString());
        const resolvePreference = (mealSlot) => {
          if (sub.mealType === 'veg') return 'veg';
          if (sub.mealType === 'non-veg') return 'non-veg';
          return prefMap.get(`${sub.userId}_${dateKey}_${mealSlot}`) || 'veg';
        };

        const wantsLunch = subRemaining.lunch > 0 && !isCancelled(sub.userId, date, 'lunch');
        const wantsDinner = subRemaining.dinner > 0 && !isCancelled(sub.userId, date, 'dinner');

        if (wantsLunch) {
          counts.lunch[resolvePreference('lunch') === 'non-veg' ? 'nonVeg' : 'veg']++;
          subRemaining.lunch -= 1;
        }
        if (wantsDinner) {
          counts.dinner[resolvePreference('dinner') === 'non-veg' ? 'nonVeg' : 'veg']++;
          subRemaining.dinner -= 1;
        }
      }

      return counts;
    });

    res.json(report);
  } catch (error) {
    console.error('Error building dietary stock report:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const getUserForMealDelivery = async (req, res) => {
  try {
    const { date, mealType } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'Date is required.' });
    }

    if (!mealType || (mealType !== 'lunch' && mealType !== 'dinner')) {
      return res.status(400).json({ message: 'Valid meal type is required (lunch or dinner).' });
    }

    const deliveryDate = new Date(date);

    // Find all cancellations for this date and mealType (including 'both')
    const cancellations = await MealCancellation.find({
      startDate: { $lte: deliveryDate },
      endDate: { $gte: deliveryDate },
      $or: [
        { mealType: mealType },
        { mealType: 'both' }
      ]
    }).exec();

    // Ensure all IDs are ObjectId type
    const cancelledUserIds = cancellations.map(c => 
      typeof c.userId === 'string' ? mongoose.Types.ObjectId(c.userId) : c.userId
    );


    const mealKey = mealType + 'Meals';
    const nextDayMealKey = 'nextDay' + mealType.charAt(0).toUpperCase() + mealType.slice(1) + 'Meals';

    // `deliveryDate` (a plain new Date("YYYY-MM-DD")) is already UTC midnight of that
    // calendar day, matching how subscriptionStartDate is stored (also a raw
    // new Date("YYYY-MM-DD") — see verifyPayment/handleRazorpayWebhook/
    // activateNextQueuedPlan). Calling .setHours(0,0,0,0) on it here previously
    // re-normalized using the SERVER's local timezone (IST, UTC+5:30), shifting it
    // back ~5.5 hours and making a subscription starting "today" fail this $lte
    // check on its actual start date — it only appeared the following day.
    const query = {
      userId: { $nin: cancelledUserIds },
      subscriptionStartDate: { $lte: deliveryDate },
      status: 'active', // Only deliver meals for active subscriptions, never queued ones
      $or: [
        { [mealKey]: { $gt: 0 } },
        { [nextDayMealKey]: { $gt: 0 } }
      ]
    };

    const usersWithMeals = await Subscription.find(query)
      .populate('userId', 'firstName lastName email mobile postalAddress role')
      .exec();

    // Filter users to only include those with role 'user'
    const filteredUsersWithMeals = usersWithMeals.filter(subscription => 
      subscription.userId && subscription.userId.role === 'user'
    );

    // For "Both" subscribers, resolve today's actual Veg/Non-Veg pick so kitchen
    // staff know what to pack — "Both" alone doesn't say what THIS delivery is.
    const bothUserIds = filteredUsersWithMeals
      .filter(s => s.mealType === 'both')
      .map(s => s.userId._id);
    const prefRows = await MealDietaryPreference.find({
      userId: { $in: bothUserIds },
      // MealDietaryPreference.date is stored via startOfDay() (local-midnight
      // normalized, see updateMealSchedule) — a different convention from
      // subscriptionStartDate's raw UTC-midnight, so it needs its own normalization
      // here rather than reusing `deliveryDate` directly.
      date: startOfDay(deliveryDate),
      mealSlot: mealType
    });
    const prefMap = new Map();
    prefRows.forEach(r => prefMap.set(r.userId.toString(), r.preference));

    const userDeliveries = filteredUsersWithMeals.map(subscription => ({
      userId: subscription.userId._id,
      name: `${subscription.userId.firstName} ${subscription.userId.lastName}`,
      email: subscription.userId.email,
      address: subscription.userId.postalAddress,
      mobile: subscription.userId.mobile,
      mealType: subscription.mealType || '',
      dietaryPreference: subscription.mealType === 'both'
        ? (prefMap.get(subscription.userId._id.toString()) || 'veg')
        : subscription.mealType,
      carbType: subscription.carbType || '',
      plan: subscription.plan || '',
      allergy: subscription.allergy || '',
      lunchMeals: subscription.lunchMeals || 0,
      dinnerMeals: subscription.dinnerMeals || 0,
      nextDayLunchMeals: subscription.nextDayLunchMeals || 0,
      nextDayDinnerMeals: subscription.nextDayDinnerMeals || 0,
    }));

    res.json(userDeliveries);
  } catch (error) {
    console.error('Error fetching users for meal delivery:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};


const createRazorpayOrder = async (req, res) => {
  try {
    const { amount, plan, meals, userId, carbType, mealType, lunchDinner, mealStartDate, allergy } = req.body;

    const options = {
      amount: amount * 100,
      currency: 'INR',
      receipt: `order_${Date.now()}`,
      notes: {
        userId: userId,
        plan: plan,
        meals: meals,
        carbType: carbType,
        mealType: mealType,
        lunchDinner: lunchDinner,
        mealStartDate,
        allergy,
      }
    };

    const order = await razorpay.orders.create(options);
    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ message: 'Error creating payment order' });
  }
};

const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, plan, startDate, meals, mealType, carbType, lunchDinner, mealStartDate, allergy } = req.body;

    console.log('Verifying payment for order:', razorpay_order_id);

    const shasum = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const digest = shasum.digest('hex');

    if (digest !== razorpay_signature) {
      console.error('Signature mismatch for order:', razorpay_order_id);
      return res.status(400).json({ message: 'Transaction not legit!' });
    }

    // Check if subscription already exists for this orderId (idempotency guard)
    const existingSub = await Subscription.findOne({ orderId: razorpay_order_id });
    if (existingSub) {
      console.log(`Subscription for order ${razorpay_order_id} already exists, skipping creation.`);
      return res.status(201).json(existingSub);
    }

    // Determine if user already has an active subscription with meals remaining
    const existingActiveSub = await Subscription.findOne({ userId, status: 'active' });
    const hasActiveMeals = existingActiveSub &&
      ((existingActiveSub.lunchMeals || 0) + (existingActiveSub.dinnerMeals || 0) +
       (existingActiveSub.nextDayLunchMeals || 0) + (existingActiveSub.nextDayDinnerMeals || 0)) > 0;

    const newStatus = hasActiveMeals ? 'queued' : 'active';
    console.log(`User ${userId} has active meals: ${hasActiveMeals}. Saving new subscription as '${newStatus}'.`);

    const mealCount = Number(meals);

    // For queued plans: do NOT adjust meal counts yet — they will be recalculated on activation day.
    // For active plans: apply the normal time-based adjustment.
    let lunchMeals = 0, dinnerMeals = 0, nextDayLunchMeals = 0, nextDayDinnerMeals = 0;
    let timeAdjustment = { lunchTimePassed: false, dinnerTimePassed: false, adjustedForTime: false };

    if (newStatus === 'active') {
      const mealAdjustment = adjustMealCountsForTime(mealCount, lunchDinner, new Date(mealStartDate || startDate));
      lunchMeals = mealAdjustment.lunchMeals;
      dinnerMeals = mealAdjustment.dinnerMeals;
      nextDayLunchMeals = mealAdjustment.nextDayLunchMeals;
      nextDayDinnerMeals = mealAdjustment.nextDayDinnerMeals;
      timeAdjustment = {
        lunchTimePassed: mealAdjustment.lunchTimePassed,
        dinnerTimePassed: mealAdjustment.dinnerTimePassed,
        adjustedForTime: mealAdjustment.adjustedForTime
      };
    } else {
      // Queued: store raw meal counts; the cron job will distribute them on activation
      if (lunchDinner === 'lunch') {
        lunchMeals = mealCount;
      } else if (lunchDinner === 'dinner') {
        dinnerMeals = mealCount;
      } else {
        lunchMeals = mealCount / 2;
        dinnerMeals = mealCount / 2;
      }
    }

    const subscription = new Subscription({
      userId,
      subscriptionStartDate: mealStartDate || new Date(),
      plan,
      lunchMeals,
      dinnerMeals,
      nextDayLunchMeals,
      nextDayDinnerMeals,
      totalMeals: mealCount,
      mealType,
      carbType,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      allergy: allergy || '',
      status: newStatus
    });

    const savedSubscription = await subscription.save();
    console.log(`Subscription saved as '${newStatus}' for order:`, razorpay_order_id);

    res.status(201).json({
      ...savedSubscription.toObject(),
      isQueued: newStatus === 'queued',
      timeAdjustment
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ message: 'Error verifying payment' });
  }
};

const getActiveSubscriptionCounts = async (req, res) => {
  try {
    const activeSubscriptions = await Subscription.find({
      status: 'active',
      $expr: {
        $gt: [
          {
            $add: [
              { $ifNull: ['$lunchMeals', 0] },
              { $ifNull: ['$dinnerMeals', 0] },
              { $ifNull: ['$nextDayLunchMeals', 0] },
              { $ifNull: ['$nextDayDinnerMeals', 0] }
            ]
          },
          0
        ]
      }
    }).populate('userId');

    let weeklyCount = 0;
    let monthlyCount = 0;
    let trialCount = 0;

    activeSubscriptions.forEach(sub => {
      if (sub.userId && sub.userId.role === 'user' && sub.plan) {
        if (/Weekly/i.test(sub.plan)) {
          weeklyCount++;
        } else if (/Monthly/i.test(sub.plan)) {
          monthlyCount++;
        } else if (/Trial/i.test(sub.plan) || sub.plan === 'Trial Meal Pack') {
          trialCount++;
        }
      }
    });

    res.json({ weeklyCount, monthlyCount, trialCount });
  } catch (error) {
    console.error('Error getting active subscription counts:', error);
    res.status(500).json({ message: error.message });
  }
};

const handleRazorpayWebhook = async (req, res) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const signature = req.headers['x-razorpay-signature'];
  const body = req.rawBody; // Use the raw buffer captured in server.js

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  if (signature !== expectedSignature) {
    console.error('Invalid Webhook Signature');
    return res.status(400).send('Invalid signature');
  }

  const { event, payload } = req.body;

  if (event === 'payment.captured') {
    const payment = payload.payment.entity;
    const orderId = payment.order_id;

    // Idempotency: skip if already processed
    const existingSub = await Subscription.findOne({ orderId });
    if (existingSub) {
      console.log(`Subscription for order ${orderId} already exists.`);
      return res.status(200).send('Already processed');
    }

    try {
      const order = await razorpay.orders.fetch(orderId);
      const notes = order.notes;

      if (!notes || !notes.userId) {
        console.error('No notes found for order:', orderId);
        return res.status(200).send('No notes found');
      }

      const { userId, plan, meals, mealType, carbType, lunchDinner, mealStartDate, allergy } = notes;

      // Determine status: queued if the user already has an active sub with meals left
      const existingActiveSub = await Subscription.findOne({ userId, status: 'active' });
      const hasActiveMeals = existingActiveSub &&
        ((existingActiveSub.lunchMeals || 0) + (existingActiveSub.dinnerMeals || 0) +
         (existingActiveSub.nextDayLunchMeals || 0) + (existingActiveSub.nextDayDinnerMeals || 0)) > 0;

      const newStatus = hasActiveMeals ? 'queued' : 'active';
      const mealCount = Number(meals);

      let lunchMeals = 0, dinnerMeals = 0, nextDayLunchMeals = 0, nextDayDinnerMeals = 0;

      if (newStatus === 'active') {
        const mealAdjustment = adjustMealCountsForTime(mealCount, lunchDinner, new Date(mealStartDate || new Date()));
        lunchMeals = mealAdjustment.lunchMeals;
        dinnerMeals = mealAdjustment.dinnerMeals;
        nextDayLunchMeals = mealAdjustment.nextDayLunchMeals;
        nextDayDinnerMeals = mealAdjustment.nextDayDinnerMeals;
      } else {
        // Queued: raw counts stored; activation cron will redistribute
        if (lunchDinner === 'lunch') {
          lunchMeals = mealCount;
        } else if (lunchDinner === 'dinner') {
          dinnerMeals = mealCount;
        } else {
          lunchMeals = mealCount / 2;
          dinnerMeals = mealCount / 2;
        }
      }

      const subscription = new Subscription({
        userId,
        subscriptionStartDate: mealStartDate,
        plan,
        lunchMeals,
        dinnerMeals,
        nextDayLunchMeals,
        nextDayDinnerMeals,
        totalMeals: mealCount,
        mealType,
        carbType,
        paymentId: payment.id,
        orderId,
        allergy: allergy || '',
        status: newStatus
      });

      await subscription.save();
      console.log(`Webhook: saved subscription as '${newStatus}' for user ${userId}, order ${orderId}`);
    } catch (error) {
      console.error('Error processing webhook payment:', error);
      return res.status(500).send('Processing error');
    }
  }

  res.status(200).send('Webhook received');
};

// Admin: cancel a queued subscription (user cannot cancel their own queued plan)
const cancelQueuedPlan = async (req, res) => {
  try {
    const { subscriptionId } = req.params;

    const sub = await Subscription.findById(subscriptionId);
    if (!sub) {
      return res.status(404).json({ message: 'Subscription not found' });
    }
    if (sub.status !== 'queued') {
      return res.status(400).json({
        message: `Only queued subscriptions can be cancelled via this endpoint. Current status: '${sub.status}'`
      });
    }

    // Trigger Razorpay Refund
    let refundInfo = null;
    if (sub.paymentId) {
      try {
        // A full refund is initiated if no amount is specified
        const refund = await razorpay.payments.refund(sub.paymentId, {
          notes: {
            reason: 'Queued plan cancelled by admin',
            subscriptionId: sub._id.toString()
          }
        });
        refundInfo = refund;
        sub.refundId = refund.id;
        console.log(`Refund initiated for payment ${sub.paymentId}: ${refund.id}`);
      } catch (refundError) {
        console.error('Razorpay refund failed:', refundError);
        // Map common Razorpay errors
        const errorMsg = refundError.error ? refundError.error.description : (refundError.description || refundError.message);
        return res.status(500).json({ 
          message: 'Failed to initiate Razorpay refund. Cancellation aborted.', 
          error: errorMsg 
        });
      }
    } else {
      console.warn(`No paymentId found for queued subscription ${sub._id}. Proceeding with cancellation only.`);
    }

    // Soft delete / Update status
    sub.status = 'cancelled';
    // Zero out meals so it is treated as exhausted/invalid
    sub.lunchMeals = 0;
    sub.dinnerMeals = 0;
    sub.nextDayLunchMeals = 0;
    sub.nextDayDinnerMeals = 0;
    await sub.save();

    console.log(`Admin cancelled and refunded queued subscription ${subscriptionId} for user ${sub.userId}`);
    res.json({ 
      message: 'Queued subscription cancelled and refund initiated successfully', 
      subscription: sub,
      refund: refundInfo
    });
  } catch (error) {
    console.error('Error cancelling queued subscription:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  createSubscription,
  getSubscriptionDetails,
  cancelMealRequest,
  getCancelledMeals,
  getDeliveredMeals,
  getMealSchedule,
  updateMealSchedule,
  getDietaryStockReport,
  getUserForMealDelivery,
  createRazorpayOrder,
  verifyPayment,
  getActiveSubscriptionCounts,
  handleRazorpayWebhook,
  cancelQueuedPlan
};
