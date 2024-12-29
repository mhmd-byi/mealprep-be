const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const activitesSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    date: {
      type: Date,
      required: true
    },
    description: {
      type: String,
      required: true,
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Activity', activitesSchema);
