const Subscription = require('../models/subscriptionModel');
const MealCancellation = require('../models/mealcancellation');
const Notification = require('../models/notificationModel');
const NotificationSetting = require('../models/notificationSettingModel');
const User = require('../models/userModel');
const { getExcludedUserIds } = require('./excludedAccounts');
const { projectExhaustionDate, loadHolidayKeys } = require('./planProjection');
const { deliverItems, render, clip } = require('./notificationSender');
const {
  nowIST,
  todayCalendarDateUTC,
  calendarDateKey,
  calendarDayOfWeek,
  diffInCalendarDays,
  calendarDateRangeUTC
} = require('./dateUtils');

const DEFAULT_REMINDERS = {
  'plan-ending': {
    label: 'Plan ending soon',
    description: 'Sent before a plan runs out, on each of the selected days. Placeholders: {name}, {plan}, {days}, {dayWord}, {date}.',
    enabled: false,
    title: 'Your {plan} ends in {days} {dayWord}',
    body: 'Hi {name}, you have about {days} {dayWord} of meals left (ends {date}). Renew now to keep your meals coming.',
    days: [7, 3, 1],
    sendAt: '08:15',
    route: '/plans'
  },
  'lunch-day': {
    label: "Lunch reminder",
    description: "Sent to customers with lunch coming today who haven't cancelled it. Placeholder: {name}.",
    enabled: false,
    title: 'Lunch is on its way today',
    body: 'Hi {name}, need to cancel or customise today\'s lunch? Do it before 10:30 AM.',
    days: [],
    sendAt: '09:30',
    route: '/cancel-meals'
  },
  'dinner-day': {
    label: 'Dinner reminder',
    description: "Sent to customers with dinner coming today who haven't cancelled it. Placeholder: {name}.",
    enabled: false,
    title: 'Dinner is on its way today',
    body: 'Hi {name}, need to cancel or customise today\'s dinner? Do it before 4:00 PM.',
    days: [],
    sendAt: '15:00',
    route: '/cancel-meals'
  }
};

const REMINDER_KEYS = Object.keys(DEFAULT_REMINDERS);

const loadSettings = async () => {
  const stored = await NotificationSetting.find({ key: { $in: REMINDER_KEYS } }).lean();
  const byKey = new Map(stored.map((entry) => [entry.key, entry]));
  return REMINDER_KEYS.map((key) => {
    const defaults = DEFAULT_REMINDERS[key];
    const saved = byKey.get(key);
    return {
      key,
      label: defaults.label,
      description: defaults.description,
      route: defaults.route,
      enabled: saved ? saved.enabled : defaults.enabled,
      title: saved ? saved.title : defaults.title,
      body: saved ? saved.body : defaults.body,
      days: saved && saved.days && saved.days.length ? saved.days : defaults.days,
      sendAt: saved ? saved.sendAt : defaults.sendAt,
      lastRunDate: saved ? saved.lastRunDate : ''
    };
  });
};

const createAutoCampaign = (key, label, setting) =>
  Notification.create({
    title: setting.title,
    body: setting.body,
    category: 'reminder',
    route: DEFAULT_REMINDERS[key].route,
    filter: {},
    audienceSummary: `Automatic: ${label}`,
    source: 'auto',
    autoKey: key,
    status: 'sending'
  });

const finishCampaign = async (campaign, result) => {
  campaign.stats = { ...result, skippedOptOut: 0 };
  campaign.status = 'sent';
  campaign.sentAt = new Date();
  await campaign.save();
};

const customerIds = async (userIds) => {
  const excluded = new Set((await getExcludedUserIds()).map(String));
  const users = await User.find({ _id: { $in: userIds }, role: 'user' }, 'firstName').lean();
  return new Map(users.filter((user) => !excluded.has(String(user._id))).map((user) => [String(user._id), user]));
};

const runPlanEnding = async (setting) => {
  const today = todayCalendarDateUTC();
  const holidayKeys = await loadHolidayKeys(60);
  const activeSubs = await Subscription.find({ status: 'active' }).lean();
  const users = await customerIds(activeSubs.map((sub) => sub.userId));

  const items = [];
  activeSubs.forEach((sub) => {
    const user = users.get(String(sub.userId));
    if (!user) return;
    const remaining = Math.max(
      (sub.lunchMeals || 0) + (sub.nextDayLunchMeals || 0),
      (sub.dinnerMeals || 0) + (sub.nextDayDinnerMeals || 0)
    );
    if (remaining <= 0) return;
    const exhaustion = projectExhaustionDate(remaining, holidayKeys);
    const daysUntil = diffInCalendarDays(exhaustion, today);
    if (!setting.days.includes(daysUntil)) return;

    const values = {
      name: user.firstName || 'there',
      plan: sub.plan,
      days: daysUntil,
      dayWord: daysUntil === 1 ? 'day' : 'days',
      date: new Date(exhaustion).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    };
    items.push({
      userId: sub.userId,
      title: clip(render(setting.title, values), 65),
      body: clip(render(setting.body, values), 240),
      dedupeKey: `plan-ending:${sub._id}:${daysUntil}`
    });
  });
  return items;
};

const runMealDay = async (slot, setting) => {
  const today = todayCalendarDateUTC();
  if (calendarDayOfWeek(today) === 0) return [];
  const todayKey = calendarDateKey(today);
  const holidayKeys = await loadHolidayKeys(1);
  if (holidayKeys.has(todayKey)) return [];

  const left = slot === 'lunch' ? ['lunchMeals', 'nextDayLunchMeals'] : ['dinnerMeals', 'nextDayDinnerMeals'];
  const activeSubs = await Subscription.find({ status: 'active' }).lean();
  const started = activeSubs.filter((sub) => {
    const remaining = (sub[left[0]] || 0) + (sub[left[1]] || 0);
    const startKey = sub.subscriptionStartDate ? calendarDateKey(new Date(sub.subscriptionStartDate)) : todayKey;
    return remaining > 0 && startKey <= todayKey;
  });

  const { start, end } = calendarDateRangeUTC(todayKey);
  const cancellations = await MealCancellation.find({
    userId: { $in: started.map((sub) => sub.userId) },
    startDate: { $lte: end },
    endDate: { $gte: start },
    mealType: { $in: [slot, 'both'] }
  }).lean();
  const cancelled = new Set(cancellations.map((entry) => String(entry.userId)));

  const eligible = started.filter((sub) => !cancelled.has(String(sub.userId)));
  const users = await customerIds(eligible.map((sub) => sub.userId));

  return eligible
    .filter((sub) => users.has(String(sub.userId)))
    .map((sub) => {
      const values = { name: users.get(String(sub.userId)).firstName || 'there' };
      return {
        userId: sub.userId,
        title: clip(render(setting.title, values), 65),
        body: clip(render(setting.body, values), 240),
        dedupeKey: `meal-day:${slot}:${todayKey}`
      };
    });
};

const runReminder = async (setting) => {
  const items =
    setting.key === 'plan-ending'
      ? await runPlanEnding(setting)
      : await runMealDay(setting.key === 'lunch-day' ? 'lunch' : 'dinner', setting);
  if (items.length === 0) return;

  const campaign = await createAutoCampaign(setting.key, setting.label, setting);
  try {
    const result = await deliverItems(campaign, items);
    await finishCampaign(campaign, result);
  } catch (error) {
    console.error(`Automatic reminder "${setting.key}" failed:`, error);
    campaign.status = 'failed';
    campaign.errorMessage = String(error.message || error).slice(0, 300);
    await campaign.save();
  }
};

const minutesOf = (hhmm) => {
  const [hours, minutes] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};

const CATCH_UP_MINUTES = 180;

const isDue = (setting, nowMinutes, todayKey) => {
  if (!setting.enabled || setting.lastRunDate === todayKey) return false;
  const target = minutesOf(setting.sendAt);
  return target !== null && nowMinutes >= target && nowMinutes < target + CATCH_UP_MINUTES;
};

const runDueAutoReminders = async () => {
  const now = nowIST();
  const todayKey = now.toFormat('yyyy-MM-dd');
  const nowMinutes = now.hour * 60 + now.minute;
  const settings = await loadSettings();

  for (const setting of settings) {
    if (!isDue(setting, nowMinutes, todayKey)) continue;
    await NotificationSetting.findOneAndUpdate(
      { key: setting.key },
      { $set: { lastRunDate: todayKey }, $setOnInsert: { enabled: setting.enabled, title: setting.title, body: setting.body, days: setting.days, sendAt: setting.sendAt } },
      { upsert: true }
    );
    await runReminder(setting);
  }
};

module.exports = { DEFAULT_REMINDERS, REMINDER_KEYS, loadSettings, runDueAutoReminders, runReminder, isDue, minutesOf };
