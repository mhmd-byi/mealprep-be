const cron = require('node-cron');
const Notification = require('../models/notificationModel');
const { claimAndDeliver } = require('../utils/notificationSender');
const { runDueAutoReminders } = require('../utils/autoReminders');
const { IST_ZONE } = require('../utils/dateUtils');

let running = false;

const sendDueScheduled = async () => {
  const due = await Notification.find({ status: 'scheduled', scheduledFor: { $lte: new Date() } }, '_id').lean();
  for (const notification of due) await claimAndDeliver(notification._id);
};

const STUCK_AFTER_MS = 30 * 60 * 1000;

const failStuckSends = () =>
  Notification.updateMany(
    { status: 'sending', updatedAt: { $lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    { status: 'failed', errorMessage: 'The server stopped before this finished sending.' }
  );

const tick = async () => {
  if (running) return;
  running = true;
  try {
    await failStuckSends();
    await sendDueScheduled();
    await runDueAutoReminders();
  } catch (error) {
    console.error('Notification job tick failed:', error);
  } finally {
    running = false;
  }
};

cron.schedule('* * * * *', tick, { timezone: IST_ZONE });

module.exports = { tick, sendDueScheduled };
