const mongoose = require('mongoose');
const Schema = mongoose.Schema;

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
    required: 'Kindly enter your email'
  },
  password: {
    type: String,
    required: 'Kindly enter your password'
  },
  mobile: {
    type: String,
    required: 'Kindly enter mobile number'
  },
  age: {
    type: Number,
  },
  created_date: {
    type: Date,
    default: Date.now
  },
});

module.exports = mongoose.model('Users', userSchema);
