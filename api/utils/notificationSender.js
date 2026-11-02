const Notification = require('../models/notificationModel');
const UserNotification = require('../models/userNotificationModel');
const { sendPushMessages } = require('./pushService');
const { resolveAudience } = require('./notificationAudience');

const INSERT_CHUNK = 500;

const ALLOWED_ROUTES = ['', '/home', '/my-plan', '/menu', '/meals', '/plans', '/cancel-meals', '/customise-meal', '/help', '/profile'];

const render = (template, values) =>
  String(template || '').replace(/\{(\w+)\}/g, (match, key) => (values[key] !== undefined ? String(values[key]) : match));

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const groupIdsByStatus = (statusByUser) => {
  const groups = { sent: [], failed: [], 'no-device': [] };
  statusByUser.forEach((status, userId) => groups[status].push(userId));
  return groups;
};

const deliverItems = async (notification, items) => {
  const unique = new Map();
  items.forEach((item) => unique.set(String(item.userId), item));
  const rows = [...unique.values()];

  const fresh = [];
  if (rows.some((row) => row.dedupeKey)) {
    const existing = await UserNotification.find(
      { dedupeKey: { $in: rows.map((row) => row.dedupeKey).filter(Boolean) } },
      'userId dedupeKey'
    ).lean();
    const taken = new Set(existing.map((entry) => `${entry.userId}:${entry.dedupeKey}`));
    rows.forEach((row) => {
      if (!row.dedupeKey || !taken.has(`${row.userId}:${row.dedupeKey}`)) fresh.push(row);
    });
  } else {
    fresh.push(...rows);
  }

  for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
    const slice = fresh.slice(i, i + INSERT_CHUNK);
    await UserNotification.insertMany(
      slice.map((row) => ({
        userId: row.userId,
        notificationId: notification._id,
        title: row.title,
        body: row.body,
        category: notification.category,
        route: notification.route,
        ...(row.dedupeKey ? { dedupeKey: row.dedupeKey } : {})
      })),
      { ordered: false }
    );
  }

  const statusByUser = await sendPushMessages(
    fresh.map((row) => ({
      userId: row.userId,
      title: row.title,
      body: row.body,
      data: { route: notification.route, notificationId: String(notification._id) }
    }))
  );

  const groups = groupIdsByStatus(statusByUser);
  for (const [status, userIds] of Object.entries(groups)) {
    if (userIds.length === 0) continue;
    await UserNotification.updateMany({ notificationId: notification._id, userId: { $in: userIds } }, { pushStatus: status });
  }

  return {
    recipients: fresh.length,
    pushSent: groups.sent.length,
    pushFailed: groups.failed.length,
    noDevice: groups['no-device'].length
  };
};

const deliverCampaign = async (notificationId) => {
  const notification = await Notification.findById(notificationId);
  if (!notification) return;
  try {
    const { recipients, skippedOptOut } = await resolveAudience(notification.filter, notification.category);
    const items = recipients.map((recipient) => {
      const values = { name: recipient.firstName || 'there' };
      return {
        userId: recipient.id,
        title: clip(render(notification.title, values), 65),
        body: clip(render(notification.body, values), 240)
      };
    });
    const result = await deliverItems(notification, items);
    notification.stats = { ...result, skippedOptOut };
    notification.status = 'sent';
    notification.sentAt = new Date();
    await notification.save();
  } catch (error) {
    console.error('Notification delivery failed:', error);
    notification.status = 'failed';
    notification.errorMessage = String(error.message || error).slice(0, 300);
    await notification.save();
  }
};

const claimAndDeliver = async (notificationId) => {
  const claimed = await Notification.findOneAndUpdate(
    { _id: notificationId, status: { $in: ['scheduled', 'sending'] }, sentAt: null },
    { status: 'sending' },
    { new: true }
  );
  if (claimed) await deliverCampaign(claimed._id);
};

module.exports = { deliverItems, deliverCampaign, claimAndDeliver, render, clip, ALLOWED_ROUTES };
