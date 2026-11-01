const { MailtrapClient } = require('mailtrap');
const User = require('../models/userModel');
const { calendarDateKey } = require('./dateUtils');
const { describeTastePreferences } = require('./tastePreferences');

const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || 'ermoinzafarsheikh@hotmail.com';

const LUNCH_DINNER_LABELS = {
  lunch: 'Only Lunch',
  dinner: 'Only Dinner',
  lunchAndDinner: 'Lunch and Dinner'
};

const sendAdminPurchaseAlert = async (subscription, lunchDinner, isQueued) => {
  try {
    const user = await User.findById(subscription.userId);
    if (!user) return;

    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer';
    const client = new MailtrapClient({ token: process.env.MAILTRAP_API_TOKEN });

    await client.send({
      from: { email: 'hello@app.mealprep.co.in', name: 'Mealprep' },
      to: [{ email: ADMIN_ALERT_EMAIL, name: 'Admin' }],
      subject: `${isQueued ? 'Queued Subscription' : 'New Subscription'}: ${name}`,
      text:
        `A new subscription has been ${isQueued ? 'queued' : 'received'} from the Mealprep mobile app.\n\n` +
        `--- CUSTOMER DETAILS ---\n` +
        `Name: ${name}\nEmail: ${user.email}\nMobile: ${user.mobile}\nUser ID: ${user._id}\n\n` +
        `--- SUBSCRIPTION DETAILS ---\n` +
        `Plan: ${subscription.plan}\n` +
        `Meals Total: ${subscription.totalMeals}\n` +
        `Meal Type: ${subscription.mealType}\n` +
        `Carb Type: ${subscription.carbType}\n` +
        `Preference: ${LUNCH_DINNER_LABELS[lunchDinner] || lunchDinner}\n` +
        `Start Date: ${calendarDateKey(subscription.subscriptionStartDate)}\n` +
        `Allergy Info: ${subscription.allergy || 'None'}\n` +
        `Taste Preference: ${describeTastePreferences({
          spiceLevel: subscription.spiceLevel || '',
          flavourPreferences: subscription.flavourPreferences || []
        })}\n` +
        `Payment ID: ${subscription.paymentId}\nOrder ID: ${subscription.orderId}\n\n` +
        (isQueued
          ? `This plan is QUEUED and will activate when the user's current plan runs out.`
          : `Please update the system accordingly.`)
    });
  } catch (error) {
    console.error('Admin purchase alert failed:', error.message);
  }
};

module.exports = { sendAdminPurchaseAlert };
