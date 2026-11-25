const { MailtrapClient } = require('mailtrap');
const User = require('../models/userModel');

const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || 'ermoinzafarsheikh@hotmail.com';
const SENDER = { email: 'hello@app.mealprep.co.in', name: 'Mealprep' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const trialTemplate = (customerName) => ({
  subject: 'Your Mealprep Trial is Confirmed! 🍽️ Get Ready to Eat Healthy',
  text: `Hi ${customerName},

Great choice! 🎉

Your Mealprep Trial Meal is officially confirmed, and we're excited for you to experience what clean, delicious, and hassle-free eating really feels like.

Here's what's coming your way:
✔️ Freshly prepared, nutrition-balanced meals
✔️ High-quality ingredients, zero compromise
✔️ Designed to fit your health goals effortlessly

🚀 This is just the beginning…

Most of our customers start with a trial—and quickly upgrade once they feel the difference.

👉 Upgrade & Save More:

Weekly Plans – Perfect for staying consistent without commitment

Monthly Plans – Best value + exclusive discounts + priority delivery

💥 Special Offer Just for You:
Upgrade within the next 48 hours and get exclusive discounts on your first subscription!

We can't wait for you to try your first meal. Trust us—your body will thank you.

Stay healthy,
Team Mealprep

📩 Need help? Just reply to this email—we've got you covered!`
});

const weeklyTemplate = (customerName) => ({
  subject: "You're All Set for a Healthy Week!!",
  text: `Hi ${customerName},

Welcome to a healthier routine! 💪

Your Mealprep Weekly Plan is now active, and your meals are being prepped with care to keep you on track all week long.

Here's what you've unlocked:
✔️ Consistent, portion-controlled meals
✔️ Time saved on cooking & planning
✔️ Progress toward your fitness goals

🔥 Want even better results (and savings)?

Customers on our Monthly Plan see the best transformation—not just physically, but in habit-building too.

👉 Why go Monthly?

Bigger savings 💰

Priority scheduling 🚚

Long-term consistency = real results

🎁 Limited Upgrade Perk:
Switch to a Monthly Plan today and get exclusive savings and free consultation!

Let's make this week count—and build something even stronger next month.

To your health,
Team Mealprep

📩 Questions? We're always here to help!`
});

const monthlyTemplate = (customerName) => ({
  subject: 'You Just Made the Best Health Decision! 🌟',
  text: `Hi ${customerName},

This is big. 🙌

You've just committed to your health with a Mealprep Monthly Plan, and that's exactly how real transformation begins.

Here's what you can expect:
✔️ Fully planned, stress-free nutrition
✔️ Visible results with consistency
✔️ Premium support from our team

💚 You're now part of the Mealprep inner circle.

As a monthly member, you get:

Priority meal prep & delivery

Exclusive offers & early access

Personalized support

🎉 Let's make it even more rewarding:
Refer a friend and both of you get exclusive rewards and discounts!

We're excited to be part of your journey—this is just the start of something amazing.

Stay committed, stay strong,
Team Mealprep

📩 Need assistance or customization? Just reply—we're here for you.`
});

const PLAN_TEMPLATES = {
  'Trial Meal Pack': trialTemplate,
  'Weekly Plan': weeklyTemplate,
  'Monthly Plan': monthlyTemplate
};

const fallbackTemplate = (customerName, planName) => ({
  subject: 'Your Mealprep Subscription is Confirmed!',
  text: `Hi ${customerName},

Thank you for subscribing to our ${planName}! 🥗 Your healthy meals are now taken care of.

Important Information:
✅ Mealprep Kitchen operates from Monday to Saturday.
✅ Meal Cancellation & Customization Requests:
Lunch: 12 Midnight – 10:30 AM
Dinner: 12 Midnight – 4:00 PM

For any assistance, feel free to reach out.
Wishing you a delicious and healthy journey!

Team Mealprep`
});

const activeEmailTemplate = (planName, customerName) => {
  const templateFn = PLAN_TEMPLATES[planName];
  return templateFn ? templateFn(customerName) : fallbackTemplate(customerName, planName);
};

const queuedEmailTemplate = (planName, customerName) => {
  const active = activeEmailTemplate(planName, customerName);
  return {
    subject: `Queued: ${active.subject}`,
    text: `Hi ${customerName},

Your current plan is still active — your new ${planName} has been queued and will activate automatically once your current meals run out. No action needed from your side!

─────────────────────────────
${active.text.replace(/^Hi \[?.+?\]?,\n\n/, '')}`
  };
};

const sendCustomerPlanEmail = async (userOrId, planName, isQueued) => {
  try {
    const user = userOrId && userOrId.email ? userOrId : await User.findById(userOrId);
    const email = (user?.email || '').trim();
    if (!EMAIL_PATTERN.test(email)) return;

    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer';
    const template = isQueued ? queuedEmailTemplate(planName, name) : activeEmailTemplate(planName, name);
    const cc = email.toLowerCase() === ADMIN_ALERT_EMAIL.toLowerCase() ? [] : [{ email: ADMIN_ALERT_EMAIL, name: 'Mealprep' }];

    const client = new MailtrapClient({ token: process.env.MAILTRAP_API_TOKEN });
    await client.send({
      from: SENDER,
      to: [{ email, name }],
      cc,
      subject: template.subject,
      text: template.text
    });
  } catch (error) {
    console.error('Customer plan email failed:', error.message);
  }
};

module.exports = { sendCustomerPlanEmail, activeEmailTemplate, queuedEmailTemplate };
