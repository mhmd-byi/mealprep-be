const mongoose = require('mongoose');
const User = require('./api/models/userModel');
const Subscription = require('./api/models/subscriptionModel');
require('dotenv').config();

const email = 'ermoinzafar+test@byi.com';

async function run() {
  try {
    if (!process.env.MONGODB_URL) {
      console.error('MONGODB_URL not found in .env');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to Database');

    let user = await User.findOne({ email });
    if (!user) {
      console.log('Test user not found, creating new account...');
      user = new User({
        firstName: 'Test',
        lastName: 'Account',
        email: email,
        password: 'password123', // Will be hashed by pre-save hook
        confirmPassword: 'password123',
        mobile: '9876543210',
        postalAddress: '123 Testing Lane, Automation City',
        role: 'user'
      });
      await user.save();
      console.log('User created successfully');
    } else {
      console.log('User already exists, adding new subscription...');
    }

    // Define subscription data
    const subscription = new Subscription({
      userId: user._id,
      subscriptionStartDate: new Date(),
      plan: 'Monthly Plan',
      lunchMeals: 9999,
      dinnerMeals: 9999,
      nextDayLunchMeals: 0,
      nextDayDinnerMeals: 0,
      totalMeals: 19998,
      mealType: 'both',
      carbType: 'regular',
      mealStartDate: new Date().toISOString().split('T')[0],
      allergy: 'None'
    });

    await subscription.save();
    console.log(`Success! Added subscription to ${email}`);
    console.log('Lunch Meals: 9999');
    console.log('Dinner Meals: 9999');

    await mongoose.connection.close();
    console.log('DB Connection closed');
    process.exit(0);
  } catch (err) {
    console.error('Error executing script:', err);
    process.exit(1);
  }
}

run();
