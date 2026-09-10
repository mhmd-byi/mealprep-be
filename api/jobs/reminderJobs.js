const cron = require('node-cron');
const { DateTime } = require('luxon');
const { MailtrapClient } = require('mailtrap');
const Subscription = require('../models/subscriptionModel');
const Holiday = require('../models/holidayModel');
const { getMealCoverage } = require('../controllers/subscriptionController');
const {
  IST_ZONE,
  todayCalendarDateUTC,
  parseCalendarDate,
  addCalendarDays,
  calendarDateKey,
  calendarDayOfWeek,
  diffInCalendarDays
} = require('../utils/dateUtils');
require('dotenv').config();

const TIMEZONE = IST_ZONE;
const THRESHOLD_FIELD = { 7: 'sevenDay', 3: 'threeDay', 1: 'oneDay' };
const REMINDER_THRESHOLDS = Object.keys(THRESHOLD_FIELD).map(Number);
// Meals-remaining is the day-proxy (see checkAndSendExpirationReminders), so a
// plan can never have more runway than this many delivery days.
const SIMULATION_SAFETY_CAP_DAYS = 3650;

const sendReminderEmail = async (toEmail, toName, subject, text) => {
  const client = new MailtrapClient({ token: process.env.MAILTRAP_API_TOKEN });
  const sender = { email: 'hello@app.mealprep.co.in', name: 'Mealprep' };
  await client.send({
    from: sender,
    to: [{ email: toEmail, name: toName }],
    cc: [{ email: 'ermoinzafarsheikh@hotmail.com', name: 'Mealprep' }],
    subject,
    text
  });
};

// Walks forward day by day from today, skipping Sundays and any date already
// on the Holiday calendar, counting off `remaining` delivery days. Returns the
// calendar date of the LAST delivery — the day this meal bucket hits zero.
// (Per-user meal cancellations on future dates aren't factored in — this is
// an approximation, same as the rest of the "meals remaining" day-proxy.)
const projectExhaustionDate = (remaining, holidayDateKeys) => {
  let date = todayCalendarDateUTC();
  let daysLeft = remaining;
  for (let i = 0; i < SIMULATION_SAFETY_CAP_DAYS; i++) {
    const isSunday = calendarDayOfWeek(date) === 0;
    const isHoliday = holidayDateKeys.has(calendarDateKey(date));
    if (!isSunday && !isHoliday) {
      daysLeft -= 1;
      if (daysLeft === 0) return date;
    }
    date = addCalendarDays(date, 1);
  }
  return date;
};

const formatDateLabel = (date) =>
  DateTime.fromJSDate(date, { zone: 'utc' }).toFormat('EEE, dd LLL yyyy');

const buildReminderEmail = (daysUntil, planName, customerName, exhaustionDate, nextPlan) => {
  const dayWord = daysUntil === 1 ? 'day' : 'days';
  const dateLabel = formatDateLabel(exhaustionDate);
  const subject = `Your ${planName} ends in ${daysUntil} ${dayWord}`;

  const text = nextPlan
    ? `Hi ${customerName},\n\n` +
      `Your ${planName} has about ${daysUntil} ${dayWord} of meals left and will end on ${dateLabel}.\n\n` +
      `Good news — your next plan (${nextPlan.plan}) is already queued up and will activate automatically ` +
      `as soon as this one ends, so your meals continue without any gap. No action needed on your part!\n\n` +
      `Stay healthy,\nTeam Mealprep`
    : `Hi ${customerName},\n\n` +
      `Your ${planName} has about ${daysUntil} ${dayWord} of meals left and will end on ${dateLabel}.\n\n` +
      `Renew now to keep your meals coming without interruption — just head to the Plans page and pick your next plan.\n\n` +
      `Stay healthy,\nTeam Mealprep`;

  return { subject, text };
};

async function checkAndSendExpirationReminders() {
  try {
    console.log('Checking active subscriptions for expiration reminders...');

    const today = todayCalendarDateUTC();
    // 60-day horizon comfortably covers the longest plan (Monthly, 26 meals)
    // even with several holidays stretching it out.
    const horizonEnd = addCalendarDays(today, 60);
    const upcomingHolidays = await Holiday.find({ date: { $gte: today, $lte: horizonEnd } });
    const holidayDateKeys = new Set(
      upcomingHolidays.map((h) => calendarDateKey(parseCalendarDate(h.date)))
    );

    const activeSubs = await Subscription.find({ status: 'active' })
      .populate('userId', 'firstName lastName email');
    if (activeSubs.length === 0) {
      console.log('No active subscriptions to check.');
      return;
    }

    const queuedSubs = await Subscription.find({ status: 'queued' });
    const queuedByUser = {};
    queuedSubs.forEach((q) => {
      const key = q.userId.toString();
      (queuedByUser[key] = queuedByUser[key] || []).push(q);
    });

    let sentCount = 0;

    for (const sub of activeSubs) {
      if (!sub.userId || !sub.userId.email) {
        console.warn(`Skipping subscription ${sub._id} — no populated user/email`);
        continue;
      }

      const lunchRemaining = (sub.lunchMeals || 0) + (sub.nextDayLunchMeals || 0);
      const dinnerRemaining = (sub.dinnerMeals || 0) + (sub.nextDayDinnerMeals || 0);
      // A subscription only completes once BOTH buckets hit zero (see
      // activateNextQueuedPlan in mealJobs.js), so the slower bucket is what
      // actually determines when this plan ends.
      const remaining = Math.max(lunchRemaining, dinnerRemaining);
      if (remaining <= 0) continue;

      const exhaustionDate = projectExhaustionDate(remaining, holidayDateKeys);
      const daysUntil = diffInCalendarDays(exhaustionDate, today);
      if (!REMINDER_THRESHOLDS.includes(daysUntil)) continue;

      const fieldKey = THRESHOLD_FIELD[daysUntil];
      if (sub.remindersSent && sub.remindersSent[fieldKey]) continue;

      const subCoverage = getMealCoverage(sub);
      const userQueued = queuedByUser[sub.userId._id.toString()] || [];
      const nextPlan = userQueued.find((q) => {
        const qCoverage = getMealCoverage(q);
        return (subCoverage.lunch && qCoverage.lunch) || (subCoverage.dinner && qCoverage.dinner);
      });

      const customerName = `${sub.userId.firstName} ${sub.userId.lastName}`;
      const { subject, text } = buildReminderEmail(daysUntil, sub.plan, customerName, exhaustionDate, nextPlan);

      try {
        await sendReminderEmail(sub.userId.email, customerName, subject, text);
        await Subscription.findByIdAndUpdate(sub._id, { [`remindersSent.${fieldKey}`]: true });
        sentCount++;
        console.log(`Sent ${daysUntil}-day expiration reminder to ${sub.userId.email} for subscription ${sub._id}`);
      } catch (error) {
        console.error(`Failed to send ${daysUntil}-day reminder for subscription ${sub._id}:`, error.message);
      }
    }

    console.log(`Expiration reminder check complete. Sent ${sentCount} email(s).`);
  } catch (error) {
    console.error('Error checking expiration reminders:', error);
  }
}

// Runs once daily, ahead of the 10:45 AM meal-subtraction cron, so "meals
// remaining" reflects a stable, already-settled count for the simulation.
cron.schedule('0 8 * * *', async () => {
  await checkAndSendExpirationReminders();
}, {
  timezone: TIMEZONE
});

module.exports = {
  checkAndSendExpirationReminders,
  projectExhaustionDate
};
