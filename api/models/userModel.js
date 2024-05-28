const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const bcrypt = require('bcrypt-nodejs');

const userSchema = new Schema({
  firstName: {
    type: String,
    required: 'Kindly enter your first name'
  },
  lastName: {
    type: String,
    required: 'Kindly enter your last name'
  },
  email: {
    type: String,
    required: 'Kindly enter your email',
    unique: true,
  },
  password: {
    type: String,
    required: 'Kindly enter your password'
  },
  confirmPassword: {
    type: String,
    required: 'Kindly confirm your password'
  },
  // Token to reset password
  resetLink: {
    data: String,
    default: ''
  },
  mobile: {
    type: String,
    required: 'Kindly enter mobile number'
  },
  postalAddress: {
    type: String,
    required: 'Kindly enter your postal address'
  },
  age: {
    type: Number
  },
  created_date: {
    type: Date,
    default: Date.now
  }
});

// hash the password
userSchema.pre("save", function(next) {
  let user = this;
  if (this.isModified("password") || this.isNew) {
    bcrypt.genSalt(10, function(err, salt) {
      if (err) {
        return next(err);
      }

      bcrypt.hash(user.password, salt, null, function(err, hash) {
        if (err) {
          return next(err);
        }

        user.password = hash;
        next();
      });
    });
  } else {
    return next();
  }
});

userSchema.methods.comparePassword = function(password, next) {
  let user = this;
  return bcrypt.compareSync(password, user.password);
};


module.exports = mongoose.model('Users', userSchema);
