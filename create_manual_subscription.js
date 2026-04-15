const mongoose = require('mongoose');
const User = require('./api/models/userModel');
const Subscription = require('./api/models/subscriptionModel');
require('dotenv').config();

const CONFIG = {
  // Fill either userId or userEmail. userId takes priority when both are provided.
  userId: '697223a03f4e3f001bd50dac',
  userEmail: 'arsonisacrime@gmail.com',

  // Required subscription details
  plan: 'Monthly Plan', // Trial Meal Pack | Weekly Plan | Monthly Plan
  subscriptionStartDate: '2026-04-10', // Stored in subscriptionStartDate
  mealStartDate: '2026-04-10', // Stored in mealStartDate
  totalMeals: 26,
  lunchDinner: 'dinner', // lunch | dinner | both
  mealType: 'non-veg', // Fill as needed by your app
  carbType: 'low', // Fill as needed by your app

  // Optional
  allergy: 'none',
  paymentId: 'pay_SdPUBztUHTWkh6',
  orderId: '',

  // Exact meal split override. Keep all as null to auto-calculate using latest logic.
  exactMeals: {
    lunchMeals: 0,
    dinnerMeals: 26,
    nextDayLunchMeals: 0,
    nextDayDinnerMeals: 0
  },

  // Safety switch. Review the output first, then set to false to insert in DB.
  dryRun: true
};

const VALID_PLANS = ['Trial Meal Pack', 'Weekly Plan', 'Monthly Plan'];
const VALID_LUNCH_DINNER = ['lunch', 'dinner', 'both'];

const adjustMealCountsForTime = (meals, lunchDinner = 'both', subscriptionStartDate = null) => {
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentHour = nowIST.getHours();
  const currentMinutes = nowIST.getMinutes();
  const currentTimeInMinutes = currentHour * 60 + currentMinutes;
  const currentDate = nowIST.toISOString().split('T')[0];

  let lunchMeals = 0;
  let dinnerMeals = 0;
  let nextDayLunchMeals = 0;
  let nextDayDinnerMeals = 0;

  if (lunchDinner === 'lunch') {
    lunchMeals = meals;
  } else if (lunchDinner === 'dinner') {
    dinnerMeals = meals;
  } else {
    lunchMeals = meals / 2;
    dinnerMeals = meals / 2;
  }

  if (!subscriptionStartDate) {
    return {
      lunchMeals,
      dinnerMeals,
      nextDayLunchMeals: 0,
      nextDayDinnerMeals: 0,
      adjustedForTime: false
    };
  }

  const startDate = new Date(subscriptionStartDate).toISOString().split('T')[0];
  const subscriptionStartsToday = startDate === currentDate;
  const subscriptionStartsInFuture = startDate > currentDate;

  if (subscriptionStartsInFuture) {
    return {
      lunchMeals: 0,
      dinnerMeals: 0,
      nextDayLunchMeals: lunchMeals,
      nextDayDinnerMeals: dinnerMeals,
      adjustedForTime: true
    };
  }

  if (subscriptionStartsToday) {
    const lunchTimePassed = currentTimeInMinutes > 10.5 * 60;
    const dinnerTimePassed = currentTimeInMinutes > 16 * 60;

    if (lunchTimePassed && lunchMeals > 0) {
      nextDayLunchMeals = lunchMeals;
      lunchMeals = 0;
    }

    if (dinnerTimePassed && dinnerMeals > 0) {
      nextDayDinnerMeals = dinnerMeals;
      dinnerMeals = 0;
    }

    return {
      lunchMeals,
      dinnerMeals,
      nextDayLunchMeals,
      nextDayDinnerMeals,
      adjustedForTime: lunchTimePassed || dinnerTimePassed
    };
  }

  return {
    lunchMeals,
    dinnerMeals,
    nextDayLunchMeals: 0,
    nextDayDinnerMeals: 0,
    adjustedForTime: false
  };
};

function validateConfig() {
  if (!process.env.MONGODB_URL) {
    throw new Error('MONGODB_URL not found in .env');
  }

  if (!CONFIG.userId && !CONFIG.userEmail) {
    throw new Error('Fill either CONFIG.userId or CONFIG.userEmail');
  }

  if (!VALID_PLANS.includes(CONFIG.plan)) {
    throw new Error(`Invalid plan. Allowed values: ${VALID_PLANS.join(', ')}`);
  }

  if (!VALID_LUNCH_DINNER.includes(CONFIG.lunchDinner)) {
    throw new Error(`Invalid lunchDinner. Allowed values: ${VALID_LUNCH_DINNER.join(', ')}`);
  }

  if (!CONFIG.subscriptionStartDate || Number.isNaN(new Date(CONFIG.subscriptionStartDate).getTime())) {
    throw new Error('CONFIG.subscriptionStartDate must be a valid date');
  }

  if (!CONFIG.mealStartDate) {
    throw new Error('CONFIG.mealStartDate is required');
  }

  if (typeof CONFIG.totalMeals !== 'number' || CONFIG.totalMeals <= 0) {
    throw new Error('CONFIG.totalMeals must be a number greater than 0');
  }
}

async function findUser() {
  if (CONFIG.userId) {
    const user = await User.findById(CONFIG.userId);
    if (!user) {
      throw new Error(`User not found for userId: ${CONFIG.userId}`);
    }
    return user;
  }

  const user = await User.findOne({ email: CONFIG.userEmail });
  if (!user) {
    throw new Error(`User not found for userEmail: ${CONFIG.userEmail}`);
  }
  return user;
}

function getMealBreakup() {
  const { exactMeals } = CONFIG;
  const hasExactOverride = Object.values(exactMeals).some(value => value !== null);

  if (hasExactOverride) {
    const lunchMeals = Number(exactMeals.lunchMeals || 0);
    const dinnerMeals = Number(exactMeals.dinnerMeals || 0);
    const nextDayLunchMeals = Number(exactMeals.nextDayLunchMeals || 0);
    const nextDayDinnerMeals = Number(exactMeals.nextDayDinnerMeals || 0);
    const total = lunchMeals + dinnerMeals + nextDayLunchMeals + nextDayDinnerMeals;

    if (total !== CONFIG.totalMeals) {
      throw new Error(
        `Exact meal split total (${total}) does not match CONFIG.totalMeals (${CONFIG.totalMeals})`
      );
    }

    return {
      lunchMeals,
      dinnerMeals,
      nextDayLunchMeals,
      nextDayDinnerMeals,
      adjustedForTime: false,
      source: 'manual override'
    };
  }

  return {
    ...adjustMealCountsForTime(
      CONFIG.totalMeals,
      CONFIG.lunchDinner,
      new Date(CONFIG.subscriptionStartDate)
    ),
    source: 'auto-calculated'
  };
}

async function run() {
  try {
    validateConfig();

    await mongoose.connect(process.env.MONGODB_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to Database');

    const user = await findUser();
    const mealBreakup = getMealBreakup();

    const subscriptionData = {
      userId: user._id,
      subscriptionStartDate: new Date(CONFIG.subscriptionStartDate),
      plan: CONFIG.plan,
      lunchMeals: mealBreakup.lunchMeals,
      dinnerMeals: mealBreakup.dinnerMeals,
      nextDayLunchMeals: mealBreakup.nextDayLunchMeals,
      nextDayDinnerMeals: mealBreakup.nextDayDinnerMeals,
      totalMeals: CONFIG.totalMeals,
      mealType: CONFIG.mealType,
      carbType: CONFIG.carbType,
      mealStartDate: CONFIG.mealStartDate,
      allergy: CONFIG.allergy || ''
    };

    if (CONFIG.paymentId) {
      subscriptionData.paymentId = CONFIG.paymentId;
    }

    if (CONFIG.orderId) {
      subscriptionData.orderId = CONFIG.orderId;
    }

    console.log('User found:', {
      id: String(user._id),
      email: user.email,
      name: `${user.firstName} ${user.lastName}`
    });
    console.log('Meal calculation mode:', mealBreakup.source);
    console.log('Subscription payload:');
    console.log(JSON.stringify(subscriptionData, null, 2));

    if (CONFIG.dryRun) {
      console.log('Dry run enabled. No subscription inserted.');
      return;
    }

    const subscription = new Subscription(subscriptionData);
    const savedSubscription = await subscription.save();

    console.log('Subscription created successfully');
    console.log('Subscription ID:', String(savedSubscription._id));
  } catch (error) {
    console.error('Error creating manual subscription:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log('DB Connection closed');
  }
}

run();
