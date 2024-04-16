const User = require('../models/userModel');
const { sendEmail } = require('../utils/emailjs');
const crypto = require('crypto');

// Create a new User API
const createUser = function(req, res) {
    const newUser = new User(req.body);
    newUser.save(function(err, user) {
    if (err) {
      res.send(err);
    }
    res.json(user);
  });
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
  User.findById(req.params.userId, function(err, user) {
      if (err) {
          res.send(err);
      } else if (!user) {
          res.status(404).send({ message: "User not found with id " + req.params.userId });
      } else {
          res.json(user);
      }
  });
};

// Update User API
const updateUser = async function(req, res) {
  try {
    const updatedUser = await User.findOneAndUpdate(
      { _id: req.params.userId }, 
      req.body, 
      { new: true } 
    );

    if (!updatedUser) {
      return res.status(404).send({ message: "User not found with id " + req.params.userId });
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
  console.log('this is user', user)
  if (user) {
    await sendEmail(user.email);
    res.send('email sent')
  } else {
    res.send('error sending email')
  }
};


module.exports = {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser,
    forgotPassword,
    // requestPasswordReset,
    // resetPassword,
}