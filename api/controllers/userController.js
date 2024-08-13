const moment = require('moment');
const User = require('../models/userModel');
const Subscription = require('../models/subscriptionModel');
const { sendEmail } = require('../utils/emailjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Token = require('../models/token');
const bcrypt = require('bcrypt');
const Meal = require('../models/mealModel');

const generateToken = (userId, expires, type) => {
  const payload = {
    sub: userId,
    iat: moment().unix(),
    exp: expires.unix(),
    type
  };
  return jwt.sign(payload, 'asdfghjkL007');
};

const saveToken = async (token, userId, expires, type, blacklisted = false) => {
  const tokenDoc = await Token.create({
    token,
    user: userId,
    expires: expires.toDate(),
    type,
    blacklisted
  });
  return tokenDoc;
};

const generateAuthTokens = async user => {
  const accessTokenExpires = moment().add(30, 'minutes');
  const accessToken = generateToken(user.id, accessTokenExpires, 'access');

  const refreshTokenExpires = moment().add(1, 'days');
  const refreshToken = generateToken(user.id, refreshTokenExpires, 'refresh');
  await saveToken(refreshToken, user.id, refreshTokenExpires, 'refresh');

  return {
    access: {
      token: accessToken,
      expires: accessTokenExpires.toDate()
    },
    refresh: {
      token: refreshToken,
      expires: refreshTokenExpires.toDate()
    }
  };
};

class ApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Create a new User API
const createUser = async function(req, res) {
  try {
    const emails = await User.find({ email: req.body.email });
    const mobiles = await User.find({ mobile: req.body.mobile });
    if (emails.length > 0) {
      throw new ApiError('Email already taken', 400);
    }
    if (mobiles.length > 0) {
      throw new ApiError('Phone number already taken', 400);
    }
    const newUser = new User({
      ...req.body,
      role: 'user'
    });
    newUser.save(async function(err, user) {
      if (err) {
        throw new ApiError('Database error on user creation', 500);
      }
      const tokens = await generateAuthTokens(user);
      const userData = { user, tokens };
      res.json(userData);
    });
  } catch (e) {
    res.status(e.statusCode || 500).send({ message: e.message });
  }
};

const validateUserCredentials = async (email, password) => {
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return null;
    }
    const isMatch = await bcrypt.compare(password, user.password);
    return isMatch ? user : null;
  } catch (err) {
    console.error('Error during authentication:', err);
    throw new Error('Authentication failed');
  }
};

// Login User API
const getUserByEmailAndPassword = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await validateUserCredentials(email, password);

    if (user) {
      const tokens = await generateAuthTokens(user);
      res.json({
        message: 'Login successful',
        tokens,
        userId: user.id,
        role: user.role
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Get All Users API
const getAllUsers = function(req, res) {
  User.find({}, function(err, users) {
    if (err) {
      res.status(500).send(err);
    } else {
      res.json(users);
    }
  });
};

// Get User By ID API
const getUserById = function(req, res) {
  console.log('this is iser id', req.params);
  User.findById(req.params.userId, function(err, user) {
    if (err) {
      res.send(err);
    } else if (!user) {
      res.status(404).send({ message: 'User not found with id ' + req.params.userId });
    } else {
      res.json(user);
    }
  });
};

// Update User API
const updateUser = async function(req, res) {
  let updateData = { ...req.body };

  if (updateData.password) {
    const salt = await bcrypt.genSalt(10);
    updateData.password = await bcrypt.hash(updateData.password, salt);
  }

  updateData = Object.fromEntries(Object.entries(updateData).filter(([_, v]) => v != null && v !== ''));

  try {
    const updatedUser = await User.findOneAndUpdate({ _id: req.params.userId }, updateData, { new: true });

    if (!updatedUser) {
      return res.status(404).send({ message: 'User not found with id ' + req.params.userId });
    }
    res.json(updatedUser);
  } catch (err) {
    res.status(500).send(err);
  }
};

// Delete User API
const deleteUser = function(req, res) {
  User.remove(
    {
      _id: req.params.userId
    },
    function(err, user) {
      if (err) {
        res.send(err);
      }
      res.json({ message: 'User deleted Successfully' });
    }
  );
};

// Forgot and Reset Password API
const forgotPassword = async function(req, res) {
  const user = await User.findOne({ email: req.body.email });
  console.log('this is user', user);
  if (user) {
    await sendEmail(user.email);
    res.send('email sent');
  } else {
    res.send('error sending email');
  }
};

// Logout API
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    console.log('Received refreshToken:', refreshToken);

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }
    const updatedToken = await Token.findOneAndUpdate({ token: refreshToken }, { blacklisted: true }, { new: true });

    if (!updatedToken) {
      return res.status(404).json({ message: 'Refresh token not found' });
    }

    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const createSubscription = async (req, res) => {
  try {
    const { userId, plan, startDate } = req.body;

    if (!userId || !plan || !startDate) {
      return res.status(400).json({ message: 'Missing required fields: userId, plan, and startDate are required.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const validPlans = ['Trial Meal Pack', 'Weekly Plan', 'Monthly Plan'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ message: 'Invalid plan' });
    }

    // Calculating subscription end date
    let subscriptionDuration;
    switch (plan) {
      case 'Trial Meal Pack':
        subscriptionDuration = 2; // 2 days
        break;
      case 'Weekly Plan':
        subscriptionDuration = 7; // 7 days
        break;
      case 'Monthly Plan':
        subscriptionDuration = 30; // 30 days
        break;
    }

    const subscriptionStartDate = new Date(startDate);
    const subscriptionEndDate = new Date(subscriptionStartDate.getTime() + subscriptionDuration * 24 * 60 * 60 * 1000);

    // Creating subscription
    const subscription = new Subscription({
      userId,
      subscriptionStartDate,
      subscriptionEndDate,
      plan
    });

    const savedSubscription = await subscription.save();
    res.status(201).json(savedSubscription);
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
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

// Add meal Api
const createMeal = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided or token is malformed' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, 'asdfghjkL007');
    } catch (error) {
      return res.status(401).json({ message: 'Invalid Token' });
    }

    const { userId, date, mealType, items } = req.body;
    const user = await User.findById(decoded.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can create meals' });
    }

    if (!userId || !date || !mealType || !items || items.length === 0) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const meal = new Meal({
      userId,
      date,
      mealType,
      items
    });

    const savedMeal = await meal.save();
    res.status(201).json(savedMeal);
  } catch (error) {
    console.error('Error creating meal:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Fetch Meal API

const getMeal = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided or token is malformed' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, 'asdfghjkL007');
    } catch (error) {
      return res.status(401).json({ message: 'Invalid Token' });
    }

    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'Date parameter is required' });
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch all meals for the given date, regardless of userId
    const meals = await Meal.find({
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    res.json(meals);
  } catch (error) {
    console.error('Error fetching meals:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

//  Remove Meal Api
const removeMealItem = async (req, res) => {
  try {
    const { mealId, itemId } = req.params;
    const meal = await Meal.findById(mealId);

    if (!meal) {
      return res.status(404).json({ message: 'Meal not found' });
    }

    meal.items = meal.items.filter(item => item._id.toString() !== itemId);

    if (meal.items.length === 0) {
      await Meal.findByIdAndDelete(mealId);
    } else {
      await meal.save();
    }

    res.json({ message: 'Item removed successfully' });
  } catch (error) {
    console.error('Error removing meal item:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};
module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  forgotPassword,
  getUserByEmailAndPassword,
  logout,
  createSubscription,
  getSubscriptionDetails,
  // requestPasswordReset,
  // resetPassword,
  createMeal,
  getMeal,
  removeMealItem
};
