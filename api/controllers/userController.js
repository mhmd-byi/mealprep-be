const User = require('../models/userModel');

const createUser = function(req, res) {
    const newUser = new User(req.body);
    newUser.save(function(err, user) {
    if (err) {
      res.send(err);
    }
    res.json(user);
  });
};

const getAllUsers = function(req, res) {
  User.find({}, function(err, users) {
      if (err) {
          res.status(500).send(err);
      } else {
          res.json(users);
      }
  });
};

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


module.exports = {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser,
}