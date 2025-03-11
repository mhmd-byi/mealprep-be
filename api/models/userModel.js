const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const bcrypt = require('bcrypt');

const userSchema = new Schema({
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
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
    unique: true
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
  profileImageUrl: {
    type: String
  },
  age: {
    type: Number
  },
  created_date: {
    type: Date,
    default: Date.now
  },
  resetPasswordToken: {
    type: String,
    default: ''
  },
  resetPasswordExpires: {
    type: Date,
    default: ''
  }
});

// hash the password
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
      next();
    } catch (err) {
      return next(err);
    }
  } else {
    next();
  }
});

userSchema.methods.comparePassword = function(password, next) {
  let user = this;
  return bcrypt.compareSync(password, user.password);
};

module.exports = mongoose.model('Users', userSchema);
