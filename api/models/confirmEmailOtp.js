const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const confirmEmailOtp = new Schema({
    email: {
        type: String,
        required: true
    },
    otp: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 300
    }
})

module.exports = mongoose.model('ConfirmEmailOtp', confirmEmailOtp);
