const User = require('../models/userModel');
const Subscription = require('../models/subscriptionModel');
const MealCancellation = require('../models/mealcancellation');
const Activity = require('../models/activityModel');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const createSubscription = async (req, res) => {
  try {
    const { userId, plan, startDate, meals } = req.body;

    if (!userId || !plan || !startDate || !meals) {
      console.log('Error: Missing required fields');
      return res
        .status(400)
        .json({ message: 'Missing required fields: userId, plan, meals and startDate are required.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.log('Error: User not found');
      return res.status(404).json({ message: 'User not found' });
    }

    const validPlans = ['Trial Meal Pack', 'Weekly Plan', 'Monthly Plan'];
    if (!validPlans.includes(plan)) {
      console.log('Error: Invalid plan');
      return res.status(400).json({ message: 'Invalid plan' });
    }

    const subscriptionStartDate = new Date(startDate);

    const subscription = new Subscription({
      userId,
      subscriptionStartDate,
      plan,
      lunchMeals: meals / 2,
      dinnerMeals: meals / 2
    });

    const savedSubscription = await subscription.save();
    console.log('Success: Subscription created');
    res.status(201).json(savedSubscription);
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ message: error.message });
  }
};

const getSubscriptionDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const subscription = await Subscription.findOne({ userId: userId });
    
    if (!subscription) {
      return res.json({ isSubscribed: false });
    }
    if (subscription && subscription.meals <= 0) {
      return res.json({ isSubscribed: false });
    }
    res.json({ isSubscribed: true, subscription });
  } catch (error) {
    console.error('Error getting subscription details:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const cancelMealRequest = async (req, res) => {
  try {
    const { userId, startDate, endDate, mealType } = req.body;

    if (!userId || !startDate || !endDate || !mealType) {
      console.log('Error: Missing required fields');
      return res.status(400).json({ message: 'Missing required fields: userId, startDate, endDate, and mealType are required.' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (start <= today || end < start) {
      console.log('Error: Invalid date range');
      return res.status(400).json({ message: 'Invalid date range. Start date must be in the future and end date must be after start date.' });
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
    console.log('Success: Meal cancellation request submitted');
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
      console.log('Error: Missing required fields');
      return res.status(400).json({ message: 'Missing required date.' });
    }

    const queryDate = new Date(date);

    const cancelledMeals = await MealCancellation.find({
      startDate: { $lte: queryDate },
      endDate: { $gte: queryDate }
    }).exec();

    if (cancelledMeals.length === 0) {
      console.log('Success: No cancelled meals found');
      return res.status(404).json({ message: 'No cancelled meals found.' });
    }

    const userFetchPromises = cancelledMeals.map(meal => User.findById(meal.userId).exec());
    const users = await Promise.all(userFetchPromises);

    const formattedMeals = cancelledMeals.map((meal, index) => ({
      userId: meal.userId._id,
      name: `${users[index].firstName} ${users[index].lastName}`,
      startDate: meal.startDate,
      endDate: meal.endDate,
      mealType: meal.mealType
    }));

    console.log('Success: Cancelled meals fetched');
    res.json(formattedMeals);
  } catch (error) {
    console.error('Error fetching cancelled meals:', error);
    res.status(404).json({ message: error.message });
  }
};

const getUserForMealDelivery = async (req, res) => {
  try {
    const { date, mealType } = req.query;

    if (!date) {
      console.log('Error: Missing required fields');
      return res.status(400).json({ message: 'Date is required.' });
    }

    if (!mealType || (mealType !== 'lunch' && mealType !== 'dinner')) {
      return res.status(400).json({ message: 'Valid meal type is required (lunch or dinner).' });
    }

    const cancellationDate = new Date(date);
    const cancellations = await MealCancellation.find({
      date: cancellationDate,
      mealType: mealType
    }).exec();

    const cancelledUserIds = cancellations.map(c => c.userId);
    

    const mealKey = mealType + 'Meals';
    const query = {
      _id: { $nin: cancelledUserIds },
      [mealKey]: { $gt: 0 }
    };

    const usersWithMeals = await Subscription.find(query)
      .populate('userId', 'firstName lastName email mobile postalAddress')
      .exec();

    const userDeliveries = usersWithMeals.map(subscription => ({
      userId: subscription.userId._id,
      name: `${subscription.userId.firstName} ${subscription.userId.lastName}`,
      email: subscription.userId.email,
      address: subscription.userId.postalAddress,
      mobile: subscription.userId.mobile,
      mealType: subscription.mealType || '',
      carbType: subscription.carbType || '',
    }));

    res.json(userDeliveries);
  } catch (error) {
    console.error('Error fetching users for meal delivery:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};


const createRazorpayOrder = async (req, res) => {
  try {
    const { amount, plan, meals, userId, carbType, mealType } = req.body;

    const options = {
      amount: amount * 100,
      currency: 'INR',
      receipt: `order_${Date.now()}`,
      notes: {
        userId: userId,
        plan: plan,
        meals: meals,
        carbType: carbType,
        mealType: mealType
      }
    };

    const order = await razorpay.orders.create(options);
    console.log('Success: Razorpay order created');
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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, plan, startDate, meals, mealType, carbType } = req.body;
    const shasum = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const digest = shasum.digest('hex');

    if (digest !== razorpay_signature) {
      console.log('Error: Transaction not legit');
      return res.status(400).json({ message: 'Transaction not legit!' });
    }

    const subscription = new Subscription({
      userId,
      subscriptionStartDate: startDate,
      plan,
      lunchMeals: meals / 2,
      dinnerMeals: meals / 2,
      mealType: mealType,
      carbType: carbType,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    });

    const savedSubscription = await subscription.save();
    res.status(201).json(savedSubscription);
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ message: 'Error verifying payment' });
  }
};

module.exports = {
  createSubscription,
  getSubscriptionDetails,
  cancelMealRequest,
  getCancelledMeals,
  getUserForMealDelivery,
  createRazorpayOrder,
  verifyPayment
};
