const { DateTime } = require('luxon');
const { IST_ZONE, parseCalendarDate, addCalendarDays, calendarDateKey, calendarDayOfWeek } = require('./dateUtils');

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

const currentMonthKey = () => DateTime.now().setZone(IST_ZONE).toFormat('yyyy-MM');

const monthBounds = (monthKey) => {
  const start = DateTime.fromFormat(monthKey, 'yyyy-MM', { zone: IST_ZONE }).startOf('month');
  const end = start.endOf('month');
  return {
    from: start.toJSDate(),
    to: end.toJSDate(),
    firstKey: start.toFormat('yyyy-MM-dd'),
    lastKey: end.toFormat('yyyy-MM-dd'),
    label: start.toFormat('LLL yyyy')
  };
};

const deliveryDayKeys = (firstKey, lastKey) => {
  const keys = [];
  const last = parseCalendarDate(lastKey);
  for (let cursor = parseCalendarDate(firstKey); cursor <= last; cursor = addCalendarDays(cursor, 1)) {
    if (calendarDayOfWeek(cursor) !== 0) keys.push(calendarDateKey(cursor));
  }
  return keys;
};

const dayKeyOf = (value) => calendarDateKey(parseCalendarDate(value));

const planWindow = (subscriptions) => {
  const started = subscriptions.filter((sub) => sub.status !== 'queued' && sub.subscriptionStartDate);
  if (started.length === 0) return null;
  const from = started.map((sub) => dayKeyOf(sub.subscriptionStartDate)).sort()[0];
  const stillRunning = subscriptions.some((sub) => sub.status === 'active' || sub.status === 'queued');
  if (stillRunning) return { from, to: null };
  const to = started
    .map((sub) => calendarDateKey(parseCalendarDate(sub.endedAt || sub.updatedAt || sub.subscriptionStartDate)))
    .sort()
    .pop();
  return { from, to };
};

const inWindow = (window, key) => Boolean(window) && key >= window.from && (!window.to || key <= window.to);

const mealsLeft = (sub) => (sub.lunchMeals || 0) + (sub.dinnerMeals || 0) + (sub.nextDayLunchMeals || 0) + (sub.nextDayDinnerMeals || 0);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const planProgress = (sub, loggedDeliveries, trackingStartKey) => {
  const total = Number(sub.totalMeals) || 0;
  if (total <= 0) return null;
  if (sub.status === 'queued') return { consumed: 0, total };
  if (sub.status === 'active') return { consumed: clamp(total - mealsLeft(sub), 0, total), total };

  const startKey = sub.subscriptionStartDate ? dayKeyOf(sub.subscriptionStartDate) : '';
  if (trackingStartKey && startKey && startKey >= trackingStartKey) return { consumed: Math.min(loggedDeliveries.get(String(sub._id)) || 0, total), total };
  return sub.status === 'completed' ? { consumed: total, total } : null;
};

const summarisePlans = (subscriptions, loggedDeliveries, trackingStartKey) => {
  const running = subscriptions.filter((sub) => sub.status === 'active');
  const latest = [...subscriptions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const current = running.length > 0 ? running : latest ? [latest] : [];

  const parts = current.map((sub) => planProgress(sub, loggedDeliveries, trackingStartKey)).filter(Boolean);
  if (parts.length === 0) return { percent: null, consumed: 0, total: 0, label: '' };

  const consumed = parts.reduce((sum, part) => sum + part.consumed, 0);
  const total = parts.reduce((sum, part) => sum + part.total, 0);
  return {
    percent: Math.round((consumed / total) * 100),
    consumed,
    total,
    label: current.length === 1 ? current[0].plan || '' : `${current.length} active plans`
  };
};

const cancelledMeals = (cancellations, dayKeys, holidayKeys, window) => {
  const slots = new Set();
  cancellations.forEach((cancellation) => {
    if (!cancellation.startDate || !cancellation.endDate) return;
    const from = dayKeyOf(cancellation.startDate);
    const to = dayKeyOf(cancellation.endDate);
    const meals = cancellation.mealType === 'both' ? ['lunch', 'dinner'] : [cancellation.mealType];
    dayKeys.forEach((key) => {
      if (key < from || key > to || holidayKeys.has(key) || !inWindow(window, key)) return;
      meals.forEach((meal) => slots.add(`${key}|${meal}`));
    });
  });
  const days = new Set([...slots].map((slot) => slot.split('|')[0]));
  return { meals: slots.size, days: days.size, requests: cancellations.length };
};

const buildTrackingSummary = ({ monthKey, subscriptions, deliveries, cancellations, holidays, loggedDeliveries, trackingStart }) => {
  const bounds = monthBounds(monthKey);
  const dayKeys = deliveryDayKeys(bounds.firstKey, bounds.lastKey);
  const window = planWindow(subscriptions);
  const holidayKeys = new Set(holidays.map((holiday) => dayKeyOf(holiday.date)));
  const trackingStartKey = trackingStart ? DateTime.fromJSDate(new Date(trackingStart), { zone: IST_ZONE }).toFormat('yyyy-MM-dd') : '';

  const lunch = deliveries.filter((delivery) => delivery.mealType === 'lunch').length;
  const dinner = deliveries.filter((delivery) => delivery.mealType === 'dinner').length;
  const holidayDays = dayKeys.filter((key) => holidayKeys.has(key) && inWindow(window, key)).length;

  return {
    month: monthKey,
    monthLabel: bounds.label,
    delivered: { total: lunch + dinner, lunch, dinner },
    cancelled: cancelledMeals(cancellations, dayKeys, holidayKeys, window),
    holidays: { days: holidayDays },
    plan: summarisePlans(subscriptions, loggedDeliveries, trackingStartKey)
  };
};

module.exports = { MONTH_KEY, currentMonthKey, monthBounds, buildTrackingSummary };
