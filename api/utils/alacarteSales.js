const { DateTime } = require('luxon');
const {
  IST_ZONE,
  parseCalendarDate,
  addCalendarDays,
  calendarDateKey,
  diffInCalendarDays,
  todayCalendarDateUTC,
  istDayBoundsUTC
} = require('./dateUtils');
const { roundMoney } = require('./alacarteRules');

const PAID_STATUSES = ['placed', 'confirmed', 'out_for_delivery', 'delivered'];
const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const parseKey = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return null;
  const date = parseCalendarDate(value);
  return Number.isNaN(date.getTime()) || calendarDateKey(date) !== value ? null : date;
};

const resolveRange = (startDate, endDate) => {
  const end = parseKey(endDate, todayCalendarDateUTC());
  const start = parseKey(startDate, end && addCalendarDays(end, -(DEFAULT_RANGE_DAYS - 1)));
  if (!start || !end) return { error: 'Enter a valid start date and end date.' };
  if (start > end) return { error: 'The start date must be on or before the end date.' };
  if (diffInCalendarDays(end, start) + 1 > MAX_RANGE_DAYS) return { error: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.` };

  const startKey = calendarDateKey(start);
  const endKey = calendarDateKey(end);
  return { startKey, endKey, from: istDayBoundsUTC(startKey).start, to: istDayBoundsUTC(endKey).end };
};

const istDayKey = (timestamp) => DateTime.fromJSDate(new Date(timestamp)).setZone(IST_ZONE).toFormat('yyyy-LL-dd');

const emptyTotals = () => ({ orders: 0, items: 0, subtotal: 0, deliveryFee: 0, total: 0 });

const emptyDay = (date) => ({ date, ...emptyTotals() });

const buildDailySales = (orders, startKey, endKey) => {
  const byDay = new Map();
  const last = parseCalendarDate(endKey);
  for (let cursor = parseCalendarDate(startKey); cursor <= last; cursor = addCalendarDays(cursor, 1)) {
    const key = calendarDateKey(cursor);
    byDay.set(key, emptyDay(key));
  }

  const totals = emptyTotals();
  orders.forEach((order) => {
    const day = byDay.get(istDayKey(order.paidAt));
    if (!day) return;
    const items = (order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
    [day, totals].forEach((row) => {
      row.orders += 1;
      row.items += items;
      row.subtotal += order.subtotal || 0;
      row.deliveryFee += order.deliveryFee || 0;
      row.total += order.total || 0;
    });
  });

  const rounded = (row) => ({
    ...row,
    subtotal: roundMoney(row.subtotal),
    deliveryFee: roundMoney(row.deliveryFee),
    total: roundMoney(row.total)
  });

  const days = [...byDay.values()].map(rounded);
  const best = days.reduce((top, day) => (day.total > (top ? top.total : 0) ? day : top), null);
  const summary = rounded(totals);

  return {
    days,
    totals: { ...summary, averageOrder: summary.orders > 0 ? roundMoney(summary.total / summary.orders) : 0 },
    bestDay: best ? { date: best.date, total: best.total, orders: best.orders } : null
  };
};

module.exports = { PAID_STATUSES, MAX_RANGE_DAYS, DEFAULT_RANGE_DAYS, resolveRange, buildDailySales, istDayKey };
