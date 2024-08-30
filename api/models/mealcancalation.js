const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const mealCancellationSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  mealType: {
    type: String,
    enum: ['lunch', 'dinner'],
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('MealCancellation', mealCancellationSchema);
