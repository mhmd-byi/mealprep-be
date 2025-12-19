const moment = require('moment');
const User = require('../models/userModel');
const Subscription = require('../models/subscriptionModel');
const jwt = require('jsonwebtoken');
const Token = require('../models/token');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { MailtrapClient } = require('mailtrap');
const confirmMobileOtp = require('../models/confirmMobileOtp');
require('dotenv').config();

const generateToken = (userId, expires, type) => {
  const payload = {
    sub: userId,
    iat: moment().unix(),
    exp: expires.unix(),
    type
  };
  return jwt.sign(payload, process.env.JWT_SECRET);
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
const createUser = async function (req, res) {
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
    newUser.save(async function (err, user) {
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

const getUserByMobileNumberAndOtp = async (req, res) => {
  const { mobile, otp } = req.body;
  const user = await User.findOne({ mobile });
  if (!user) {
    return res.status(401).json({ message: 'User not found' });
  }
  const verifyOtp = await confirmMobileOtp.findOne({ mobileNumber: mobile, otp: otp });
  if (!verifyOtp) {
    return res.status(401).json({ message: 'Invalid OTP' });
  }
  const tokens = await generateAuthTokens(user);
  res.json({
    message: 'Login successful',
    tokens,
    userId: user.id,
    role: user.role,
    email: user.email
  });
};

// Get All Users API
const getAllUsers = async (req, res) => {
  try {
    const response = await User.find({});
    res.status(200).json({
      users: response
    });
  } catch (e) {
    res.status(401).json({ message: 'Error fetching users' });
  }
};

const getAllUsersWithMealCounts = async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).lean();
    const userMealCounts = await Promise.all(users.map(async (user) => {
      const subscriptions = await Subscription.find({ userId: user._id }).exec();
      const mealCounts = subscriptions.reduce((acc, curr) => {
        acc.lunchMeals += curr.lunchMeals;
        acc.dinnerMeals += curr.dinnerMeals;
        acc.nextDayLunchMeals += curr.nextDayLunchMeals;
        acc.nextDayDinnerMeals += curr.nextDayDinnerMeals;
        return acc;
      }, { lunchMeals: 0, dinnerMeals: 0, nextDayLunchMeals: 0, nextDayDinnerMeals: 0 });

      return {
        ...user,
        mealCounts,
        subscriptions,
      };
    }));

    res.json(userMealCounts);
  } catch (e) {
    console.error('Error fetching users with meal counts:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Get User By ID API
const getUserById = function (req, res) {
  User.findById(req.params.userId, function (err, user) {
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
const updateUser = async function (req, res) {
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
const deleteUser = function (req, res) {
  User.remove(
    {
      _id: req.params.userId
    },
    function (err, user) {
      if (err) {
        res.send(err);
      }
      res.json({ message: 'User deleted Successfully' });
    }
  );
};

// Forgot and Reset Password API
const forgotPassword = async function (req, res) {
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return res.status(200).json({ message: 'If the email exists, a reset link has been sent.' });
  }
  // Generate token and hash it
  const token = crypto.randomBytes(20).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
  await user.save();

  // Send email via Mailtrap
  const resetUrl = `https://app.mealprep.co.in/reset-password/${token}`;
  const client = new MailtrapClient({ token: process.env.MAILTRAP_API_TOKEN });
  const sender = {
    email: "hello@app.mealprep.co.in",
    name: "Mealprep",
  };

  client
    .send({
      from: sender,
      to: [{ email: user.email }],
      subject: 'Password Reset Request',
      html: `Click <a href="${resetUrl}">here</a> to reset your password. Link expires in 1 hour.`,
    })
  res.status(200).json({ message: 'Password reset email sent.' });
};

// Logout API
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;


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

const resetPassword = async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({ message: 'Invalid or expired token.' });
  }

  // Update password and clear reset fields
  user.password = password;
  user.confirmPassword = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.status(200).json({ message: 'Password updated successfully.' });
};

const getUserByMobileNumber = async (mobile) => {
  const user = await User.findOne({ mobile });
  return user ? user.firstName : null;
}


module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  forgotPassword,
  getUserByEmailAndPassword,
  logout,
  getAllUsersWithMealCounts,
  resetPassword,
  getUserByMobileNumberAndOtp,
  getUserByMobileNumber,
};
