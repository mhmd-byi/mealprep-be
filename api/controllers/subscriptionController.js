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
const {
  currentISTMinutesSinceMidnight,
  todayCalendarDateUTC,
  parseCalendarDate,
  diffInCalendarDays,
  addCalendarDays,
  calendarDateKey,
  calendarDayOfWeek,
  istDayBoundsUTC
} = require('../utils/dateUtils');
const { requireAuth } = require('../utils/requireAuth');
const { requireAdmin } = require('../utils/requireAdmin');
const { sendWhatsAppMessage } = require('../utils/sendWhatsApp');

// Admin/staff accounts sometimes carry their own test subscription — never
// notify those, only real customers.
const notifyPurchase = async (userId, plan, mealCount, startDate) => {
  try {
    const user = await User.findById(userId);
    if (!user || user.role !== 'user') return;
    sendWhatsAppMessage({
      campaignEnvVar: 'AISENSY_SUBSCRIPTION_PURCHASED_CAMPAIGN',
      mobileNumber: user.mobile,
      customerName: user.firstName,
      templateParams: [user.firstName, plan, String(mealCount), calendarDateKey(startDate)]
    });
  } catch (notifyError) {
    console.error('Subscription-purchased WhatsApp send failed:', notifyError.message);
  }
};

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Lunch/dinner cutoff times, in minutes since IST midnight — shared by every
// function below that gates on "before 10:30 AM" / "before 4:00 PM".
const LUNCH_CUTOFF_MINUTES = 10.5 * 60; // 10:30 AM
const DINNER_CUTOFF_MINUTES = 16 * 60; // 4:00 PM

// Helper function to adjust meal counts based on current time and subscription start date
const adjustMealCountsForTime = (meals, lunchDinner = 'both', subscriptionStartDate = null) => {
  const currentTimeInMinutes = currentISTMinutesSinceMidnight();

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

  const startDate = parseCalendarDate(subscriptionStartDate);
  const today = todayCalendarDateUTC();
  const dayDiff = diffInCalendarDays(startDate, today); // > 0 future, 0 today, < 0 past

  // CASE 1: If subscription start date is GREATER than current date (future date)
  // Move ALL meals to next day
  if (dayDiff > 0) {
    console.log(`Subscription starts in future (${calendarDateKey(startDate)}), moving all meals to next day`);
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
  if (dayDiff === 0) {
    // Check if lunch time has passed (10:30 AM)
    const lunchTimePassed = currentTimeInMinutes > LUNCH_CUTOFF_MINUTES;

    // Check if dinner time has passed (4:00 PM)
    const dinnerTimePassed = currentTimeInMinutes > DINNER_CUTOFF_MINUTES;

    // If lunch time has passed, move lunch meals to next day
    if (lunchTimePassed && lunchMeals > 0) {
      nextDayLunchMeals = lunchMeals;
      lunchMeals = 0;
      console.log(`Current time after 10:30 AM, moving ${nextDayLunchMeals} lunch meals to next day`);
    }

    // If dinner time has passed, move dinner meals to next day
    if (dinnerTimePassed && dinnerMeals > 0) {
      nextDayDinnerMeals = dinnerMeals;
      dinnerMeals = 0;
      console.log(`Current time after 4:00 PM, moving ${nextDayDinnerMeals} dinner meals to next day`);
    }

    console.log(`Subscription starts today (${calendarDateKey(startDate)}), time-based adjustment applied`);
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
  console.log(`Subscription already started (${calendarDateKey(startDate)}), keeping meals in current day`);
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

// Whether a subscription (or a not-yet-created purchase's lunchDinner choice)
// covers lunch / dinner, based on remaining meal counts (current + next-day).
const getMealCoverage = (sub) => ({
  lunch: (sub.lunchMeals || 0) + (sub.nextDayLunchMeals || 0) > 0,
  dinner: (sub.dinnerMeals || 0) + (sub.nextDayDinnerMeals || 0) > 0
});

const getPurchaseCoverage = (lunchDinner) => ({
  lunch: lunchDinner === 'lunch' || lunchDinner === 'lunchAndDinner',
  dinner: lunchDinner === 'dinner' || lunchDinner === 'lunchAndDinner'
});

// A new purchase only needs to queue if it shares a meal-type track with an
// already-active subscription — e.g. buying dinner while only lunch is active
// does NOT overlap and can go active immediately, running alongside the
// existing plan; buying lunch while lunch is already active does overlap and
// still queues, exactly as before. A "Both" purchase (either side) always
// overlaps, since it covers both tracks.
const purchaseOverlapsActiveSubs = (lunchDinner, activeSubs) => {
  const newCoverage = getPurchaseCoverage(lunchDinner);
  const activeLunch = activeSubs.some(s => getMealCoverage(s).lunch);
  const activeDinner = activeSubs.some(s => getMealCoverage(s).dinner);
  return (newCoverage.lunch && activeLunch) || (newCoverage.dinner && activeDinner);
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

    const subscriptionStartDate = parseCalendarDate(startDate);

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

// Enriches one subscription document with the same computed meal-count fields
// the frontend has always relied on.
const enrichSubscription = (sub) => {
  const currentLunchMeals = sub.lunchMeals || 0;
  const currentDinnerMeals = sub.dinnerMeals || 0;
  const nextDayLunchMeals = sub.nextDayLunchMeals || 0;
  const nextDayDinnerMeals = sub.nextDayDinnerMeals || 0;
  const currentMeals = currentLunchMeals + currentDinnerMeals;
  const nextDayMeals = nextDayLunchMeals + nextDayDinnerMeals;
  return {
    ...sub.toObject(),
    currentLunchMeals,
    currentDinnerMeals,
    nextDayLunchMeals,
    nextDayDinnerMeals,
    totalCurrentMeals: currentMeals,
    totalNextDayMeals: nextDayMeals,
    totalAvailableMeals: currentMeals + nextDayMeals
  };
};

const getSubscriptionDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    // A user can now have more than one active subscription at once (e.g. a
    // lunch-only plan and a separately-active dinner-only plan) — fetch all of
    // them, newest first.
    const activeSubs = await Subscription.find({ userId, status: 'active' }).sort({ createdAt: -1, _id: -1 });

    // Fetch the queued plan (status = 'queued'), oldest first so the earliest-queued activates next
    const queuedSub = await Subscription.findOne({ userId, status: 'queued' }).sort({ createdAt: 1, _id: 1 });

    if (activeSubs.length === 0) {
      return res.json({ isSubscribed: false, currentPlan: null, currentPlans: [], nextPlan: queuedSub || null });
    }

    const enrichedPlans = activeSubs.map(enrichSubscription);

    // Backward-compat single `currentPlan`: when there's genuinely only one
    // active plan (the overwhelming majority of accounts) this is identical to
    // what every existing consumer (Header badge, Sidebar gating, customise-meal
    // dropdown, etc.) has always received. When there are two, it's a merged
    // view — meal counts summed (so "do I have meals" / "how many" stay
    // correct everywhere without those call sites needing to change), other
    // fields taken from the newest plan since they're just for display there.
    const totalAvailableMeals = enrichedPlans.reduce((sum, p) => sum + p.totalAvailableMeals, 0);
    const currentPlan = enrichedPlans.length === 1
      ? enrichedPlans[0]
      : {
          ...enrichedPlans[0],
          currentLunchMeals: enrichedPlans.reduce((s, p) => s + p.currentLunchMeals, 0),
          currentDinnerMeals: enrichedPlans.reduce((s, p) => s + p.currentDinnerMeals, 0),
          nextDayLunchMeals: enrichedPlans.reduce((s, p) => s + p.nextDayLunchMeals, 0),
          nextDayDinnerMeals: enrichedPlans.reduce((s, p) => s + p.nextDayDinnerMeals, 0),
          totalCurrentMeals: enrichedPlans.reduce((s, p) => s + p.totalCurrentMeals, 0),
          totalNextDayMeals: enrichedPlans.reduce((s, p) => s + p.totalNextDayMeals, 0),
          totalAvailableMeals,
          lunchMeals: enrichedPlans.reduce((s, p) => s + (p.lunchMeals || 0), 0),
          dinnerMeals: enrichedPlans.reduce((s, p) => s + (p.dinnerMeals || 0), 0),
          mealType: 'both'
        };

    const cancellations = await MealCancellation.find({
      userId,
      endDate: { $gte: todayCalendarDateUTC() }
    }).sort({ startDate: 1 }).lean();

    const holidays = await Holiday.find({
      date: { $gte: todayCalendarDateUTC() }
    }).sort({ date: 1 }).lean();

    const response = {
      isSubscribed: totalAvailableMeals > 0,
      // Keep 'subscription' key for backward compat with existing frontend code
      subscription: currentPlan,
      // Explicit currentPlan (merged, backward-compat) and currentPlans (full
      // detail, one entry per active plan) for new UI
      currentPlan,
      currentPlans: enrichedPlans,
      nextPlan: queuedSub ? queuedSub.toObject() : null,
      cancellations,
      holidays
    };

    res.json(response);
  } catch (error) {
    console.error('Error getting subscription details:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const cancelMealRequest = async (req, res) => {
  try {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const { userId, startDate, endDate, mealType } = req.body;

    if (!userId || !startDate || !endDate || !mealType) {
      return res.status(400).json({
        message: 'Missing required fields: userId, startDate, endDate, and mealType are required.'
      });
    }

    // A customer can only cancel their own meals; an admin can cancel on
    // behalf of any customer.
    if (caller.role !== 'admin' && caller._id.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You can only cancel your own meals.' });
    }

    // Duplicate cancellation check
    const duplicate = await MealCancellation.findOne({
      userId,
      startDate: parseCalendarDate(startDate),
      endDate: parseCalendarDate(endDate),
      mealType
    });
    if (duplicate) {
      return res.status(400).json({
        message: 'You have already cancelled this meal for the selected date and meal type.'
      });
    }

    const start = parseCalendarDate(startDate);
    const end = parseCalendarDate(endDate);
    const today = todayCalendarDateUTC();
    const currentTimeInMinutes = currentISTMinutesSinceMidnight();
    const dayDiff = diffInCalendarDays(start, today); // > 0 future, 0 today, < 0 past

    // If it's a future date, allow the cancellation
    if (dayDiff > 0) {
      // Process normally for future dates
    }
    // If it's today, apply time restrictions
    else if (dayDiff === 0) {
      if (mealType === 'both') {
        const errors = [];

        // Check lunch restriction (after 10:30 AM)
        if (currentTimeInMinutes > LUNCH_CUTOFF_MINUTES) {
          errors.push('Lunch cancellation for today must be done before 10:30 AM');
        }

        // Check dinner restriction (after 4:00 PM)
        if (currentTimeInMinutes > DINNER_CUTOFF_MINUTES) {
          errors.push('Dinner cancellation for today must be done before 4:00 PM');
        }

        if (errors.length > 0) {
          return res.status(400).json({
            message: 'Time restriction errors',
            errors: errors
          });
        }
      }
      else if (mealType === 'lunch' && currentTimeInMinutes > LUNCH_CUTOFF_MINUTES) {
        return res.status(400).json({
          message: 'Lunch cancellation for today must be done before 10:30 AM'
        });
      }
      else if (mealType === 'dinner' && currentTimeInMinutes > DINNER_CUTOFF_MINUTES) {
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
      description: `Meal cancellation request for ${mealType} meal from ${start.toDateString()} to ${end.toDateString()}`,
      category: 'cancellation'
    });

    await activityData.save();
    await newCancellation.save();

    (async () => {
      try {
        // caller is already the target customer's own user doc in the
        // common (self-cancel) case; only look it up again when an admin is
        // cancelling on behalf of someone else.
        const targetUser = caller._id.toString() === userId.toString() ? caller : await User.findById(userId);
        if (!targetUser || targetUser.role !== 'user') return;
        sendWhatsAppMessage({
          campaignEnvVar: 'AISENSY_CANCELLATION_CAMPAIGN',
          mobileNumber: targetUser.mobile,
          customerName: targetUser.firstName,
          templateParams: [targetUser.firstName, mealType, calendarDateKey(start), calendarDateKey(end)]
        });
      } catch (notifyError) {
        console.error('Cancellation WhatsApp send failed:', notifyError.message);
      }
    })();

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

    const queryDate = parseCalendarDate(date);

    const cancelledMeals = await MealCancellation.find({
      startDate: { $lte: queryDate },
      endDate: { $gte: queryDate }
    }).exec();

    if (cancelledMeals.length === 0) {
      return res.status(404).json({ message: 'No cancelled meals found.' });
    }

    const userIds = cancelledMeals.map(meal => meal.userId);
    const [users, activeSubs] = await Promise.all([
      User.find({ _id: { $in: userIds } }),
      Subscription.find({ userId: { $in: userIds }, status: 'active' })
    ]);
    const userById = new Map(users.map(u => [u._id.toString(), u]));

    const activeSubsByUser = {};
    activeSubs.forEach(sub => {
      const key = sub.userId.toString();
      (activeSubsByUser[key] = activeSubsByUser[key] || []).push(sub);
    });

    // A cancellation only still matters if the customer actually has an
    // active plan that would otherwise deliver this meal type — a refunded/
    // cancelled subscription leaves the old MealCancellation record behind,
    // but it shouldn't keep showing up here once there's nothing left to cancel.
    const hasActiveCoverage = (userId, mealType) => {
      const subs = activeSubsByUser[userId.toString()] || [];
      return subs.some(sub => {
        const lunchLeft = (sub.lunchMeals || 0) + (sub.nextDayLunchMeals || 0);
        const dinnerLeft = (sub.dinnerMeals || 0) + (sub.nextDayDinnerMeals || 0);
        if (mealType === 'lunch') return lunchLeft > 0;
        if (mealType === 'dinner') return dinnerLeft > 0;
        return lunchLeft > 0 || dinnerLeft > 0; // 'both'
      });
    };

    const formattedMeals = cancelledMeals
      .filter(meal => hasActiveCoverage(meal.userId, meal.mealType))
      .map(meal => {
        const user = userById.get(meal.userId.toString());
        return {
          userId: meal.userId,
          name: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
          startDate: meal.startDate,
          endDate: meal.endDate,
          mealType: meal.mealType,
          createdAt: meal.createdAt,
          mobile: user?.mobile
        };
      });

    if (formattedMeals.length === 0) {
      return res.status(404).json({ message: 'No cancelled meals found.' });
    }

    res.json(formattedMeals);
  } catch (error) {
    console.error('Error fetching cancelled meals:', error);
    res.status(404).json({ message: error.message });
  }
};

// Historical log of what actually went out on a given day (any past day, not
// just today) — distinct from getUserForMealDelivery's forward-looking "who's
// scheduled" prep list, which is projected from current remaining meal
// counts and can't answer "what happened on a day that's already passed."
const getDeliveredMeals = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'Missing required date.' });
    }

    // MealDelivery.date is a real timestamp (when the cron actually fired), not a
    // calendar-day-only value, so this needs an explicit IST-day range rather than
    // a point comparison.
    const { start: dayStart, end: dayEnd } = istDayBoundsUTC(date);

    const [deliveredMeals, endedSubscriptions] = await Promise.all([
      MealDelivery.find({ date: { $gte: dayStart, $lte: dayEnd } }).exec(),
      // "Ended that day" mirrors getSubscriptionEndLabel elsewhere: a plan's
      // end date isn't a stored field, it's inferred as updatedAt once status
      // flips to completed/cancelled.
      Subscription.find({
        status: { $in: ['completed', 'cancelled'] },
        updatedAt: { $gte: dayStart, $lte: dayEnd }
      }).populate('userId', 'firstName lastName mobile role').exec()
    ]);

    const userIds = [...new Set(deliveredMeals.map((m) => m.userId.toString()))];
    const subscriptionIds = [...new Set(deliveredMeals.map((m) => m.subscriptionId.toString()))];
    const [users, subscriptions, prefRows] = await Promise.all([
      User.find({ _id: { $in: userIds } }, 'firstName lastName mobile role').exec(),
      Subscription.find({ _id: { $in: subscriptionIds } }, 'userId mealType').exec(),
      MealDietaryPreference.find({ userId: { $in: userIds }, date: parseCalendarDate(date) }).exec()
    ]);
    const userById = new Map(users.map((u) => [u._id.toString(), u]));
    const subById = new Map(subscriptions.map((s) => [s._id.toString(), s]));
    const prefMap = new Map(prefRows.map((r) => [`${r.userId}_${r.mealSlot}`, r.preference]));

    // A "both" meal-type plan's veg/non-veg choice is per-day, so it has to be
    // resolved per delivery rather than read off the subscription itself.
    const resolveDietaryType = (meal, sub) => {
      if (sub?.mealType === 'veg') return 'veg';
      if (sub?.mealType === 'non-veg') return 'non-veg';
      return prefMap.get(`${meal.userId}_${meal.mealType}`) || 'veg';
    };

    // Admin accounts sometimes carry their own subscription for testing the
    // customer flow — those are never real deliveries and shouldn't appear
    // here alongside actual customers.
    const lunch = [];
    const dinner = [];
    deliveredMeals.forEach((meal) => {
      const user = userById.get(meal.userId.toString());
      if (user && user.role !== 'user') return;
      const sub = subById.get(meal.subscriptionId.toString());
      const row = {
        userId: meal.userId,
        name: user ? `${user.firstName} ${user.lastName}` : 'Unknown User',
        mobile: user?.mobile || '',
        dietaryType: resolveDietaryType(meal, sub),
        date: meal.date,
        createdAt: meal.createdAt
      };
      (meal.mealType === 'lunch' ? lunch : dinner).push(row);
    });

    const endedList = endedSubscriptions
      .filter((sub) => !sub.userId || sub.userId.role === 'user')
      .map((sub) => ({
        userId: sub.userId?._id || null,
        name: sub.userId ? `${sub.userId.firstName} ${sub.userId.lastName}` : 'Unknown User',
        mobile: sub.userId?.mobile || '',
        plan: sub.plan,
        status: sub.status,
        endedAt: sub.updatedAt
      }));

    res.json({
      date,
      lunch: { count: lunch.length, deliveries: lunch },
      dinner: { count: dinner.length, deliveries: dinner },
      endedSubscriptions: endedList
    });
  } catch (error) {
    console.error('Error fetching delivered meals:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ── Dietary preference (veg / non-veg per day, for "both" meal-type plans) ──
// Locking now mirrors cancellation/customisation exactly: a future day is
// always open, and today's own lunch/dinner choice locks only once that
// meal's real cutoff has passed (10:30 AM lunch, 4:00 PM dinner) — not a
// blanket multi-day advance lock.
// Safety ceiling on the schedule window — the real size is derived from remaining
// meals (see getMealSchedule), this just guards against bad/anomalous data (e.g.
// a manually-granted test subscription with an unrealistic meal count) causing a
// runaway date range.
const DIET_SCHEDULE_WINDOW_DAYS_CAP = 60;

const isDateLocked = (date, mealSlot, todayStart) => {
  const daysFromToday = diffInCalendarDays(date, todayStart);
  if (daysFromToday !== 0) return daysFromToday < 0; // future = always open, past = locked
  const cutoff = mealSlot === 'lunch' ? LUNCH_CUTOFF_MINUTES : DINNER_CUTOFF_MINUTES;
  return currentISTMinutesSinceMidnight() > cutoff;
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

    const todayStart = todayCalendarDateUTC();
    const subStart = parseCalendarDate(activeSub.subscriptionStartDate);
    // A plan bought today for a future start date has no deliveries before that
    // start date — the window (and lock check) must never begin earlier than it.
    const windowStart = subStart > todayStart ? subStart : todayStart;
    // Query a generously padded raw span — Sundays (and any holidays) inside the
    // window consume calendar days without producing a delivery day, so covering
    // `scheduleWindowDays` real days needs more than that many raw days.
    const rawSpanDays = scheduleWindowDays * 2;
    const windowEnd = addCalendarDays(windowStart, rawSpanDays);

    const holidays = await Holiday.find({ date: { $gte: windowStart, $lte: windowEnd } });
    const holidayKeys = new Set(holidays.map(h => calendarDateKey(h.date)));

    const prefRows = await MealDietaryPreference.find({
      userId,
      date: { $gte: windowStart, $lte: windowEnd }
    });
    const prefMap = new Map();
    prefRows.forEach(r => prefMap.set(`${calendarDateKey(r.date)}_${r.mealSlot}`, r.preference));

    const days = [];
    for (let i = 0; i < rawSpanDays && days.length < scheduleWindowDays; i++) {
      const date = addCalendarDays(windowStart, i);
      if (calendarDayOfWeek(date) === 0) continue; // no delivery on Sundays
      const dateKey = calendarDateKey(date);
      if (holidayKeys.has(dateKey)) continue; // no delivery on holidays

      const dayEntry = { date: dateKey };
      if (hasLunch) {
        dayEntry.lunch = prefMap.get(`${dateKey}_lunch`) || 'veg';
        dayEntry.lunchLocked = isDateLocked(date, 'lunch', todayStart);
      }
      if (hasDinner) {
        dayEntry.dinner = prefMap.get(`${dateKey}_dinner`) || 'veg';
        dayEntry.dinnerLocked = isDateLocked(date, 'dinner', todayStart);
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

    const requestedDate = parseCalendarDate(date);
    const todayStart = todayCalendarDateUTC();
    const subStart = parseCalendarDate(activeSub.subscriptionStartDate);

    if (requestedDate < todayStart) {
      return res.status(400).json({ message: 'Cannot set a preference for a past date.' });
    }
    if (requestedDate < subStart) {
      return res.status(400).json({ message: 'Cannot set a preference before the plan\'s start date.' });
    }
    if (isDateLocked(requestedDate, mealSlot, todayStart)) {
      const cutoffLabel = mealSlot === 'lunch' ? '10:30 AM' : '4:00 PM';
      return res.status(400).json({
        message: `Too late to change today's ${mealSlot} — the ${cutoffLabel} cutoff has already passed.`
      });
    }

    await MealDietaryPreference.findOneAndUpdate(
      { userId, date: requestedDate, mealSlot },
      { userId, subscriptionId: activeSub._id, date: requestedDate, mealSlot, preference },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const preferenceLabel = preference === 'non-veg' ? 'Non-Veg' : 'Veg';
    const mealSlotLabel = mealSlot.charAt(0).toUpperCase() + mealSlot.slice(1);
    await Activity.create({
      userId,
      date: todayStart,
      description: `Changed ${mealSlotLabel} preference for ${calendarDateKey(requestedDate)} to ${preferenceLabel}`,
      category: 'diet'
    });

    (async () => {
      try {
        const user = await User.findById(userId);
        if (!user || user.role !== 'user') return;
        sendWhatsAppMessage({
          campaignEnvVar: 'AISENSY_MEAL_PREFERENCE_CAMPAIGN',
          mobileNumber: user.mobile,
          customerName: user.firstName,
          templateParams: [user.firstName, mealSlotLabel, calendarDateKey(requestedDate), preferenceLabel]
        });
      } catch (notifyError) {
        console.error('Meal-preference WhatsApp send failed:', notifyError.message);
      }
    })();

    res.json({ message: 'Preference updated successfully.' });
  } catch (error) {
    console.error('Error updating meal schedule:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Safety ceiling on how far ahead the admin can pull this report, and the
// default/minimum window shown — independent of the dietary-preference lock
// rule above (that's about when a "both" subscriber's own choice stops being
// editable, not about how many days this report spans).
const DIETARY_REPORT_MAX_DAYS = 30;
const DEFAULT_REPORT_DAYS = 3;

const getDietaryStockReport = async (req, res) => {
  try {
    const todayStart = todayCalendarDateUTC();
    const requestedDays = Math.min(
      DIETARY_REPORT_MAX_DAYS,
      Math.max(DEFAULT_REPORT_DAYS, Number(req.query.days) || DEFAULT_REPORT_DAYS)
    );
    const windowEnd = addCalendarDays(todayStart, requestedDays - 1);

    const holidays = await Holiday.find({ date: { $gte: todayStart, $lte: windowEnd } });
    const holidayKeys = new Set(holidays.map(h => calendarDateKey(h.date)));

    const reportDates = [];
    for (let i = 0; i < requestedDays; i++) {
      const date = addCalendarDays(todayStart, i);
      if (calendarDayOfWeek(date) === 0) continue;
      const dateKey = calendarDateKey(date);
      if (holidayKeys.has(dateKey)) continue;
      reportDates.push(date);
    }

    // Admin accounts sometimes carry their own active subscription for testing
    // the customer flow — exclude those so they don't inflate the projected
    // veg/non-veg counts kitchen staff actually prepare for.
    const adminUsers = await User.find({ role: 'admin' }, '_id').lean();
    const adminUserIds = adminUsers.map((u) => u._id);
    const activeSubs = await Subscription.find({ status: 'active', userId: { $nin: adminUserIds } });

    const cancellations = await MealCancellation.find({
      startDate: { $lte: reportDates[reportDates.length - 1] || todayStart },
      endDate: { $gte: todayStart }
    });
    const isCancelled = (userId, date, mealSlot) => cancellations.some(c =>
      c.userId.toString() === userId.toString() &&
      parseCalendarDate(c.startDate) <= date && parseCalendarDate(c.endDate) >= date &&
      (c.mealType === mealSlot || c.mealType === 'both')
    );

    const bothUserIds = activeSubs.filter(s => s.mealType === 'both').map(s => s.userId);
    const prefRows = await MealDietaryPreference.find({
      userId: { $in: bothUserIds },
      date: { $gte: todayStart, $lte: windowEnd }
    });
    const prefMap = new Map();
    prefRows.forEach(r => prefMap.set(`${r.userId}_${calendarDateKey(r.date)}_${r.mealSlot}`, r.preference));

    // Running remaining-meal projection per subscription across the report window —
    // a subscription that's about to run out shouldn't be counted on days past its last meal.
    const remaining = new Map();
    activeSubs.forEach(sub => remaining.set(sub._id.toString(), {
      lunch: (sub.lunchMeals || 0) + (sub.nextDayLunchMeals || 0),
      dinner: (sub.dinnerMeals || 0) + (sub.nextDayDinnerMeals || 0)
    }));

    const report = reportDates.map(date => {
      const dateKey = calendarDateKey(date);
      const counts = {
        date: dateKey,
        lunchLocked: isDateLocked(date, 'lunch', todayStart),
        dinnerLocked: isDateLocked(date, 'dinner', todayStart),
        lunch: { veg: 0, nonVeg: 0 },
        dinner: { veg: 0, nonVeg: 0 }
      };

      for (const sub of activeSubs) {
        if (parseCalendarDate(sub.subscriptionStartDate) > date) continue;

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

    // "YYYY-MM-DD" parsed to UTC midnight — the same calendar-day convention used
    // for every calendar-day-only field in this app (subscriptionStartDate,
    // MealCancellation dates, MealDietaryPreference.date), so it compares directly
    // against all of them with no further normalization.
    const deliveryDate = parseCalendarDate(date);

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
      date: deliveryDate,
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

    // A purchase only queues if it overlaps an already-active plan's meal-type
    // coverage (e.g. buying dinner while only lunch is active goes active
    // immediately instead of queuing behind an unrelated meal type).
    const activeSubs = await Subscription.find({ userId, status: 'active' });
    const overlapsActive = purchaseOverlapsActiveSubs(lunchDinner, activeSubs);

    const newStatus = overlapsActive ? 'queued' : 'active';
    console.log(`User ${userId} purchase (${lunchDinner}) overlaps active coverage: ${overlapsActive}. Saving new subscription as '${newStatus}'.`);

    const mealCount = Number(meals);

    // For queued plans: do NOT adjust meal counts yet — they will be recalculated on activation day.
    // For active plans: apply the normal time-based adjustment.
    let lunchMeals = 0, dinnerMeals = 0, nextDayLunchMeals = 0, nextDayDinnerMeals = 0;
    let timeAdjustment = { lunchTimePassed: false, dinnerTimePassed: false, adjustedForTime: false };

    if (newStatus === 'active') {
      const mealAdjustment = adjustMealCountsForTime(mealCount, lunchDinner, parseCalendarDate(mealStartDate || startDate));
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
      subscriptionStartDate: mealStartDate ? parseCalendarDate(mealStartDate) : new Date(),
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
    notifyPurchase(userId, plan, mealCount, savedSubscription.subscriptionStartDate);

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

      // A purchase only queues if it overlaps an already-active plan's meal-type
      // coverage (see purchaseOverlapsActiveSubs) — a non-overlapping purchase
      // (e.g. dinner bought while only lunch is active) goes active immediately.
      const activeSubs = await Subscription.find({ userId, status: 'active' });
      const overlapsActive = purchaseOverlapsActiveSubs(lunchDinner, activeSubs);

      const newStatus = overlapsActive ? 'queued' : 'active';
      const mealCount = Number(meals);

      let lunchMeals = 0, dinnerMeals = 0, nextDayLunchMeals = 0, nextDayDinnerMeals = 0;

      if (newStatus === 'active') {
        const mealAdjustment = adjustMealCountsForTime(mealCount, lunchDinner, mealStartDate ? parseCalendarDate(mealStartDate) : new Date());
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
        subscriptionStartDate: mealStartDate ? parseCalendarDate(mealStartDate) : undefined,
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
      notifyPurchase(userId, plan, mealCount, subscription.subscriptionStartDate);
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
    const admin = await requireAdmin(req, res);
    if (!admin) return;

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

// Returns the user's own upcoming/active cancellation records so the frontend
// can skip cancelled dates when computing "Next Delivery".
const getUserCancellations = async (req, res) => {
  try {
    const { userId } = req.params;
    const today = todayCalendarDateUTC();
    const cancellations = await MealCancellation.find({
      userId,
      endDate: { $gte: today }
    }).sort({ startDate: 1 }).lean();
    res.json(cancellations);
  } catch (error) {
    console.error('Error fetching user cancellations:', error);
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
  cancelQueuedPlan,
  getUserCancellations,
  // Shared with adminSubscriptionController / reminderJobs — same rules
  // customer checkout uses
  adjustMealCountsForTime,
  purchaseOverlapsActiveSubs,
  getMealCoverage,
  LUNCH_CUTOFF_MINUTES,
  DINNER_CUTOFF_MINUTES
};
