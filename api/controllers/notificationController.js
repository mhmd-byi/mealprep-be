const mongoose = require('mongoose');
const Notification = require('../models/notificationModel');
const UserNotification = require('../models/userNotificationModel');
const NotificationTemplate = require('../models/notificationTemplateModel');
const NotificationSetting = require('../models/notificationSettingModel');
const DeviceToken = require('../models/deviceTokenModel');
const User = require('../models/userModel');
const { requireAuth } = require('../utils/requireAuth');
const { requireAdmin } = require('../utils/requireAdmin');
const { resolveAudience, normalizeFilter, describeFilter } = require('../utils/notificationAudience');
const { claimAndDeliver, ALLOWED_ROUTES } = require('../utils/notificationSender');
const { sendPushMessages, isExpoToken } = require('../utils/pushService');
const { loadSettings, DEFAULT_REMINDERS, REMINDER_KEYS } = require('../utils/autoReminders');

const TITLE_MAX = 65;
const BODY_MAX = 240;
const MIN_SCHEDULE_LEAD_MS = 60 * 1000;
const ADMIN_CATEGORIES = ['announcement', 'service'];

const fail = (res, status, message) => res.status(status).json({ message });

const serverError = (res, label, error) => {
  console.error(label, error);
  return res.status(500).json({ message: 'Internal Server Error', error: error.message });
};

const adminName = (admin) => `${admin.firstName || ''} ${admin.lastName || ''}`.trim() || 'Admin';

const validateContent = (input) => {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!title) return { error: 'A title is required.' };
  if (title.length > TITLE_MAX) return { error: `The title must be ${TITLE_MAX} characters or fewer.` };
  if (!body) return { error: 'A message is required.' };
  if (body.length > BODY_MAX) return { error: `The message must be ${BODY_MAX} characters or fewer.` };
  const category = input.category || 'announcement';
  if (!ADMIN_CATEGORIES.includes(category)) return { error: 'Choose a valid notification type.' };
  const route = typeof input.route === 'string' ? input.route.trim() : '';
  if (!ALLOWED_ROUTES.includes(route)) return { error: 'That screen cannot be linked from a notification.' };
  return { value: { title, body, category, route } };
};

const previewAudience = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const category = ADMIN_CATEGORIES.includes(req.body.category) ? req.body.category : 'announcement';
    const { recipients, matched, skippedOptOut } = await resolveAudience(req.body.filter, category);
    res.json({
      matched,
      willReceive: recipients.length,
      withApp: recipients.filter((recipient) => recipient.hasDevice).length,
      skippedOptOut,
      sample: recipients.slice(0, 5).map((recipient) => `${recipient.firstName} ${recipient.lastName}`.trim())
    });
  } catch (error) {
    serverError(res, 'Error previewing notification audience:', error);
  }
};

const createNotification = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const checked = validateContent(req.body);
    if (checked.error) return fail(res, 400, checked.error);

    const filter = normalizeFilter(req.body.filter);
    let scheduledFor = null;
    if (req.body.scheduledFor) {
      scheduledFor = new Date(req.body.scheduledFor);
      if (Number.isNaN(scheduledFor.getTime())) return fail(res, 400, 'The scheduled time is not valid.');
      if (scheduledFor.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) {
        return fail(res, 400, 'Pick a time at least a minute from now, or leave it blank to send now.');
      }
    }

    if (!scheduledFor) {
      const { recipients } = await resolveAudience(filter, checked.value.category);
      if (recipients.length === 0) return fail(res, 400, 'No customers match this audience.');
    }

    const notification = await Notification.create({
      ...checked.value,
      filter,
      audienceSummary: describeFilter(filter),
      source: 'admin',
      status: scheduledFor ? 'scheduled' : 'sending',
      scheduledFor,
      createdBy: { userId: admin._id, name: adminName(admin) }
    });

    if (!scheduledFor) setImmediate(() => claimAndDeliver(notification._id).catch((error) => console.error('Notification send failed:', error)));
    res.status(201).json(notification);
  } catch (error) {
    serverError(res, 'Error creating notification:', error);
  }
};

const withOpenCounts = async (notifications) => {
  if (notifications.length === 0) return [];
  const opened = await UserNotification.aggregate([
    { $match: { notificationId: { $in: notifications.map((notification) => notification._id) }, readAt: { $ne: null } } },
    { $group: { _id: '$notificationId', count: { $sum: 1 } } }
  ]);
  const counts = new Map(opened.map((entry) => [String(entry._id), entry.count]));
  return notifications.map((notification) => ({ ...notification, openedCount: counts.get(String(notification._id)) || 0 }));
};

const listNotifications = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const query = {};
    if (['scheduled', 'sending', 'sent', 'failed', 'cancelled'].includes(req.query.status)) query.status = req.query.status;
    if (['admin', 'auto'].includes(req.query.source)) query.source = req.query.source;

    const [notifications, total] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(query)
    ]);
    res.json({ notifications: await withOpenCounts(notifications), total, page, limit });
  } catch (error) {
    serverError(res, 'Error listing notifications:', error);
  }
};

const getNotification = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.notificationId)) return fail(res, 404, 'Notification not found.');

    const notification = await Notification.findById(req.params.notificationId).lean();
    if (!notification) return fail(res, 404, 'Notification not found.');

    const rows = await UserNotification.find({ notificationId: notification._id })
      .sort({ createdAt: 1 })
      .limit(300)
      .populate('userId', 'firstName lastName mobile')
      .lean();
    const [detail] = await withOpenCounts([notification]);

    res.json({
      ...detail,
      recipients: rows.map((row) => ({
        _id: row._id,
        name: row.userId ? `${row.userId.firstName || ''} ${row.userId.lastName || ''}`.trim() : 'Deleted customer',
        mobile: row.userId ? row.userId.mobile || '' : '',
        pushStatus: row.pushStatus,
        readAt: row.readAt
      }))
    });
  } catch (error) {
    serverError(res, 'Error fetching notification:', error);
  }
};

const cancelNotification = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.notificationId)) return fail(res, 404, 'Notification not found.');
    const cancelled = await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, status: 'scheduled' },
      { status: 'cancelled' },
      { new: true }
    );
    if (!cancelled) return fail(res, 400, 'Only a scheduled notification can be cancelled.');
    res.json(cancelled);
  } catch (error) {
    serverError(res, 'Error cancelling notification:', error);
  }
};

const sendTestNotification = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const checked = validateContent(req.body);
    if (checked.error) return fail(res, 400, checked.error);

    const statuses = await sendPushMessages([
      {
        userId: admin._id,
        title: checked.value.title.replace(/\{name\}/g, admin.firstName || 'there'),
        body: checked.value.body.replace(/\{name\}/g, admin.firstName || 'there'),
        data: { route: checked.value.route, test: true }
      }
    ]);
    const status = statuses.get(String(admin._id));
    if (status === 'no-device') {
      return fail(res, 400, 'No device is registered for your account. Log in to the Mealprep app on a custom build and allow notifications first.');
    }
    if (status === 'failed') return fail(res, 502, 'The push service did not accept the message. Please try again.');
    res.json({ message: 'Test notification sent to your device.' });
  } catch (error) {
    serverError(res, 'Error sending test notification:', error);
  }
};

const listTemplates = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.json(await NotificationTemplate.find().sort({ name: 1 }).collation({ locale: 'en', strength: 2 }).lean());
  } catch (error) {
    serverError(res, 'Error listing templates:', error);
  }
};

const saveTemplate = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) return fail(res, 400, 'A template name is required.');
    if (name.length > 60) return fail(res, 400, 'The template name must be 60 characters or fewer.');
    const checked = validateContent(req.body);
    if (checked.error) return fail(res, 400, checked.error);

    const duplicate = await NotificationTemplate.findOne({ name }).collation({ locale: 'en', strength: 2 });
    const templateId = req.params.templateId;
    if (duplicate && String(duplicate._id) !== String(templateId || '')) {
      return fail(res, 400, 'A template with that name already exists.');
    }

    if (templateId) {
      if (!mongoose.Types.ObjectId.isValid(templateId)) return fail(res, 404, 'Template not found.');
      const updated = await NotificationTemplate.findByIdAndUpdate(templateId, { name, ...checked.value }, { new: true });
      if (!updated) return fail(res, 404, 'Template not found.');
      return res.json(updated);
    }
    res.status(201).json(await NotificationTemplate.create({ name, ...checked.value }));
  } catch (error) {
    serverError(res, 'Error saving template:', error);
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.templateId)) return fail(res, 404, 'Template not found.');
    const removed = await NotificationTemplate.findByIdAndDelete(req.params.templateId);
    if (!removed) return fail(res, 404, 'Template not found.');
    res.json({ message: 'Template deleted.' });
  } catch (error) {
    serverError(res, 'Error deleting template:', error);
  }
};

const getSettings = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.json(await loadSettings());
  } catch (error) {
    serverError(res, 'Error loading notification settings:', error);
  }
};

const updateSetting = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { key } = req.params;
    if (!REMINDER_KEYS.includes(key)) return fail(res, 404, 'Unknown reminder.');

    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (!title || title.length > TITLE_MAX) return fail(res, 400, `The title is required and must be ${TITLE_MAX} characters or fewer.`);
    if (!body || body.length > BODY_MAX) return fail(res, 400, `The message is required and must be ${BODY_MAX} characters or fewer.`);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.sendAt || '')) return fail(res, 400, 'Send time must look like 08:15.');

    let days = DEFAULT_REMINDERS[key].days;
    if (key === 'plan-ending') {
      days = [...new Set((Array.isArray(req.body.days) ? req.body.days : []).map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 30))].sort((a, b) => b - a);
      if (days.length === 0) return fail(res, 400, 'Choose at least one day before the plan ends.');
    }

    await NotificationSetting.findOneAndUpdate(
      { key },
      { key, enabled: Boolean(req.body.enabled), title, body, days, sendAt: req.body.sendAt },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json((await loadSettings()).find((setting) => setting.key === key));
  } catch (error) {
    serverError(res, 'Error updating notification setting:', error);
  }
};

const registerDevice = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!isExpoToken(token)) return fail(res, 400, 'That is not a valid push token.');
    const platform = ['android', 'ios'].includes(req.body.platform) ? req.body.platform : 'unknown';
    await DeviceToken.findOneAndUpdate(
      { token },
      { userId: user._id, token, platform, lastSeenAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ message: 'Device registered.' });
  } catch (error) {
    serverError(res, 'Error registering device:', error);
  }
};

const unregisterDevice = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (token) await DeviceToken.deleteOne({ token, userId: user._id });
    res.json({ message: 'Device removed.' });
  } catch (error) {
    serverError(res, 'Error removing device:', error);
  }
};

const getInbox = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const [items, total, unreadCount] = await Promise.all([
      UserNotification.find({ userId: user._id }, 'title body category route readAt createdAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      UserNotification.countDocuments({ userId: user._id }),
      UserNotification.countDocuments({ userId: user._id, readAt: null })
    ]);
    res.json({ items, total, unreadCount, page, limit });
  } catch (error) {
    serverError(res, 'Error loading inbox:', error);
  }
};

const markRead = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return fail(res, 404, 'Notification not found.');
    await UserNotification.updateOne({ _id: req.params.id, userId: user._id, readAt: null }, { readAt: new Date() });
    res.json({ message: 'Marked as read.' });
  } catch (error) {
    serverError(res, 'Error marking notification read:', error);
  }
};

const markCampaignRead = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.notificationId)) return fail(res, 404, 'Notification not found.');
    await UserNotification.updateOne({ notificationId: req.params.notificationId, userId: user._id, readAt: null }, { readAt: new Date() });
    res.json({ message: 'Marked as read.' });
  } catch (error) {
    serverError(res, 'Error marking notification read:', error);
  }
};

const markAllRead = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    await UserNotification.updateMany({ userId: user._id, readAt: null }, { readAt: new Date() });
    res.json({ message: 'All notifications marked as read.' });
  } catch (error) {
    serverError(res, 'Error marking all notifications read:', error);
  }
};

const getPreferences = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    res.json({ announcements: !(user.notificationPrefs && user.notificationPrefs.announcements === false) });
  } catch (error) {
    serverError(res, 'Error loading notification preferences:', error);
  }
};

const updatePreferences = async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;
    const announcements = Boolean(req.body.announcements);
    await User.updateOne({ _id: user._id }, { 'notificationPrefs.announcements': announcements });
    res.json({ announcements });
  } catch (error) {
    serverError(res, 'Error saving notification preferences:', error);
  }
};

module.exports = {
  previewAudience,
  createNotification,
  listNotifications,
  getNotification,
  cancelNotification,
  sendTestNotification,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  getSettings,
  updateSetting,
  registerDevice,
  unregisterDevice,
  getInbox,
  markRead,
  markCampaignRead,
  markAllRead,
  getPreferences,
  updatePreferences
};
