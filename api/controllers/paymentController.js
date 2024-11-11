const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/userModel');
const Subscription = require('../models/subscriptionModel');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const createPaymentOrder = async (req, res) => {
  try {
    const { userId, plan, meals } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get plan amount based on plan name
    let amount;
    switch (plan) {
      case 'Trial Meal Pack':
        amount = 279;
        break;
      case 'Weekly Plan':
        amount = 1750;
        break;
      case 'Monthly Plan':
        amount = 5700;
        break;
      default:
        return res.status(400).json({ message: 'Invalid plan selected' });
    }

    const options = {
      amount: amount * 100, // Convert to paise
      currency: 'INR',
      receipt: `order_${Date.now()}`,
      notes: {
        userId: userId,
        plan: plan,
        meals: meals
      }
    };

    const order = await razorpay.orders.create(options);
    res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      userId: userId
    });
  } catch (error) {
    console.error('Error creating payment order:', error);
    res.status(500).json({ message: 'Error creating payment order' });
  }
};

const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, plan, meals } = req.body;

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: 'Invalid payment signature' });
    }

    // Create subscription
    const subscription = new Subscription({
      userId,
      subscriptionStartDate: new Date(),
      plan,
      lunchMeals: meals / 2,
      dinnerMeals: meals / 2,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    });

    await subscription.save();

    res.status(200).json({
      success: true,
      message: 'Payment verified and subscription created successfully',
      subscription
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ message: 'Error verifying payment' });
  }
};

// Add these functions to your existing exports
module.exports = {
  // ... existing exports
  createPaymentOrder,
  verifyPayment
};
