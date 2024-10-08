const User = require('../models/userModel');
const Subscription = require('../models/subscriptionModel');
const MealCancellation = require('../models/mealcancellation');

const createSubscription = async (req, res) => {
  try {
    const { userId, plan, startDate, meals } = req.body;

    if (!userId || !plan || !startDate || !meals) {
      return res
        .status(400)
        .json({ message: 'Missing required fields: userId, plan, meals and startDate are required.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const validPlans = ['Trial Meal Pack', 'Weekly Plan', 'Monthly Plan'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ message: 'Invalid plan' });
    }

    const subscriptionStartDate = new Date(startDate);

    // Creating subscription
    const subscription = new Subscription({
      userId,
      subscriptionStartDate,
      plan,
      lunchMeals: meals / 2,
      dinnerMeals: meals / 2,
    });

    const savedSubscription = await subscription.save();
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
    res.json({ isSubscribed: true, subscription });
  } catch (error) {
    console.error('Error getting subscription details:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const cancelMealRequest = async (req, res) => {
  try {
    const { userId, date, mealType } = req.body;

    if (!userId || !date || !mealType) {
      return res.status(400).json({ message: 'Missing required fields: userId, date, and mealType are required.' });
    }

    const cancellationDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (cancellationDate <= today) {
      return res.status(400).json({ message: 'Cannot cancel meals for today or past dates.' });
    }

    const newCancellation = new MealCancellation({
      userId,
      date: cancellationDate,
      mealType
    });

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
      return res.status(400).json({ message: 'Missing required fields: userId and date are required.' });
    }

    const cancelledMeals = await MealCancellation.find({ date: date }).exec();


    if (cancelledMeals.length === 0) {
      return res.status(404).json({ message: 'No cancelled meals found.' });
    }

    const userFetchPromises = cancelledMeals.map(meal =>
      User.findById(meal.userId).exec()
    );
    const users = await Promise.all(userFetchPromises);

    const formattedMeals = cancelledMeals.map((meal, index) => ({
      userId: meal.userId._id,
      name: `${users[index].firstName} ${users[index].lastName}`,
      date: meal.date,
      mealType: meal.mealType
    }));

    res.json(formattedMeals);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getUserForMealDelivery = async (req, res) => {
  try {
    const { date, mealType } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'Date is required.' });
    }

    if (!mealType) {
      return res.status(400).json({ message: 'Meal type is required.' });
    }

    const cancellationDate = new Date(date);
    // Find all cancellations for the given date
    const cancellations = await MealCancellation.find({
      date: cancellationDate,
      mealType: mealType,
    }).exec();

    // Get the user IDs from cancellations
    const cancelledUserIds = cancellations.map(c => c.userId);

    // Find all users who do not have a cancellation request for the given date
    const users = await User.find({
      _id: { $nin: cancelledUserIds } // $nin selects the documents where the value of _id is not in the cancelledUserIds array
    }).exec();

    const userDeliveries = users.map(user => ({
      userId: user._id,
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      address: user.postalAddress
    }));

    res.json(userDeliveries);
  } catch (error) {
    console.error('Error fetching users for meal delivery:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  createSubscription,
  getSubscriptionDetails,
  cancelMealRequest,
  getCancelledMeals,
  getUserForMealDelivery,
};
