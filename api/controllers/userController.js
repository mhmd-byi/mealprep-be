const moment = require('moment');
const User = require('../models/userModel');
const { sendEmail } = require('../utils/emailjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Token = require('../models/token');
const bcrypt = require('bcrypt');

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
    const newUser = new User(req.body);
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
        userId: user.id
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
  console.log('this is iser id', req.params)
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
  let updateData = {...req.body};

  // Check if the password is provided and needs updating
  if (updateData.password) {
    const salt = await bcrypt.genSalt(10); // Generate salt
    updateData.password = await bcrypt.hash(updateData.password, salt); // Hash the new password
  }

  updateData = Object.fromEntries(Object.entries(updateData).filter(([_, v]) => v != null && v !== ''));

  try {
    const updatedUser = await User.findOneAndUpdate(
      { _id: req.params.userId },
      updateData,
      { new: true }
    );

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
    const updatedToken = await Token.findOneAndUpdate(
      { token: refreshToken },
      { blacklisted: true },
      { new: true }
    );

    if (!updatedToken) {
      return res.status(404).json({ message: 'Refresh token not found' });
    }

    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
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
  logout
  // requestPasswordReset,
  // resetPassword,
};
