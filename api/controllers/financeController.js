const { DateTime } = require('luxon');
const Subscription = require('../models/subscriptionModel');
const Expense = require('../models/expenseModel');
const ExpenseCategory = require('../models/expenseCategoryModel');
const { requireAdmin } = require('../utils/requireAdmin');
const { computeNetRevenue } = require('../utils/planPricing');
const {
  IST_ZONE,
  todayCalendarDateUTC,
  parseCalendarDate,
  addCalendarDays,
  calendarDateKey,
  calendarDayOfWeek,
  diffInCalendarDays
} = require('../utils/dateUtils');

const OTHER_COLOR = '#898781';
// Categories beyond this many (by total spend in the range) fold into "Other"
// in the month-by-month trend chart, so the stacked bar stays legible and the
// same category set is used for every bucket (never a different mix per bar).
const MAX_TREND_CATEGORIES = 7;

// A bucket spans one calendar day, one Monday-start week, or one calendar
// month — picked automatically from how wide the requested range is, so a
// 1-week filter shows daily bars instead of collapsing into a single monthly
// one, while a 2-year filter doesn't render 700+ daily bars.
const pickGranularity = (spanDays) => {
  if (spanDays <= 31) return 'day';
  if (spanDays <= 180) return 'week';
  return 'month';
};

const mondayOf = (date) => {
  const dow = calendarDayOfWeek(date); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  return addCalendarDays(date, -daysSinceMonday);
};

const monthStartOf = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

// Start-of-bucket for a calendar-day-convention Date, per granularity.
const bucketStartOfCalendarDate = (date, granularity) => {
  if (granularity === 'day') return date;
  if (granularity === 'week') return mondayOf(date);
  return monthStartOf(date);
};

const bucketKeyOf = (date, granularity) => {
  const start = bucketStartOfCalendarDate(date, granularity);
  return granularity === 'month'
    ? `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
    : calendarDateKey(start);
};

// `Subscription.createdAt` is a real timestamp, not the calendar-day-only
// convention — must go through IST explicitly (same discipline as the rest
// of this app's date handling), or a subscription created just after IST
// midnight gets bucketed into the wrong (previous) day/week/month.
const bucketKeyOfTimestamp = (timestamp, granularity) => {
  const ist = DateTime.fromJSDate(new Date(timestamp)).setZone(IST_ZONE);
  const calendarDate = new Date(Date.UTC(ist.year, ist.month - 1, ist.day));
  return bucketKeyOf(calendarDate, granularity);
};

// `Expense.date` IS the calendar-day-UTC-midnight convention (parsed via
// parseCalendarDate at write time), so its UTC parts are already the correct
// IST year/month/day — safe to bucket directly.
const bucketKeyOfCalendarDate = (date, granularity) => bucketKeyOf(new Date(date), granularity);

const bucketLabel = (key, granularity) => {
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number);
    return DateTime.fromObject({ year: y, month: m, day: 1 }, { zone: 'utc' }).toFormat('LLL yyyy');
  }
  const start = DateTime.fromISO(key, { zone: 'utc' });
  if (granularity === 'day') return start.toFormat('dd LLL');
  return `${start.toFormat('dd LLL')}–${start.plus({ days: 6 }).toFormat('dd LLL')}`;
};

// How a subscription was actually paid for, for the payment-method chart.
const paymentMethodOf = (sub) => {
  if (sub.orderId) return 'Online (Razorpay)';
  if (sub.paymentMethod) return sub.paymentMethod;
  return 'No Charge';
};

const getFinanceDashboard = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const today = todayCalendarDateUTC();

    // Accepts an explicit range (startDate/endDate, "YYYY-MM-DD") computed by
    // the frontend from whichever preset/custom picker the admin chose;
    // defaults to the last 12 calendar months if neither is given.
    let rangeEndInput = req.query.endDate ? parseCalendarDate(req.query.endDate) : today;
    let rangeStartInput = req.query.startDate
      ? parseCalendarDate(req.query.startDate)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));

    if (isNaN(rangeStartInput.getTime()) || isNaN(rangeEndInput.getTime()) || rangeStartInput > rangeEndInput) {
      return res.status(400).json({ message: 'Invalid startDate/endDate.' });
    }

    const spanDays = diffInCalendarDays(rangeEndInput, rangeStartInput) + 1;
    const granularity = pickGranularity(spanDays);

    // Widen to the full first/last bucket so displayed totals are internally
    // consistent (e.g. a week-granularity view always shows complete weeks).
    const bucketStart = bucketStartOfCalendarDate(rangeStartInput, granularity);
    const lastBucketStart = bucketStartOfCalendarDate(rangeEndInput, granularity);
    const bucketEnd =
      granularity === 'day'
        ? lastBucketStart
        : granularity === 'week'
          ? addCalendarDays(lastBucketStart, 6)
          : new Date(Date.UTC(lastBucketStart.getUTCFullYear(), lastBucketStart.getUTCMonth() + 1, 0));

    // Build the ordered list of bucket keys so a quiet period shows as 0, not missing.
    const bucketKeys = [];
    let cursor = bucketStart;
    while (cursor <= bucketEnd) {
      bucketKeys.push(bucketKeyOf(cursor, granularity));
      cursor =
        granularity === 'day'
          ? addCalendarDays(cursor, 1)
          : granularity === 'week'
            ? addCalendarDays(cursor, 7)
            : new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }

    const queryStart = bucketStart;
    const queryEnd = new Date(addCalendarDays(bucketEnd, 1).getTime() - 1); // end-of-day of the last bucket day

    const [subscriptions, expenses, categories, allSubsForFirstPurchase] = await Promise.all([
      Subscription.find({ createdAt: { $gte: queryStart, $lte: queryEnd } }),
      Expense.find({ date: { $gte: queryStart, $lte: queryEnd } }),
      ExpenseCategory.find(),
      // Lightweight projection across the WHOLE collection (not range-limited) —
      // needed to know each user's very first-ever subscription, to classify
      // in-range subscriptions as new vs recurring.
      Subscription.find({}, 'userId createdAt')
    ]);

    const byBucket = {};
    bucketKeys.forEach((key) => {
      byBucket[key] = {
        month: key,
        label: bucketLabel(key, granularity),
        revenue: 0,
        subscriptionCount: 0,
        expenses: 0,
        newCount: 0,
        recurringCount: 0
      };
    });

    // Each user's earliest-ever subscription timestamp (global, not range-scoped)
    const firstPurchaseByUser = {};
    allSubsForFirstPurchase.forEach((sub) => {
      const key = sub.userId.toString();
      const t = new Date(sub.createdAt).getTime();
      if (!firstPurchaseByUser[key] || t < firstPurchaseByUser[key]) {
        firstPurchaseByUser[key] = t;
      }
    });

    const planTotals = {};
    const paymentMethodTotals = {};

    subscriptions.forEach((sub) => {
      const key = bucketKeyOfTimestamp(sub.createdAt, granularity);
      if (!byBucket[key]) return; // safety guard, shouldn't happen given the query range
      byBucket[key].subscriptionCount += 1;

      const revenue = computeNetRevenue(sub);
      byBucket[key].revenue += revenue;

      const isFirstEver = new Date(sub.createdAt).getTime() === firstPurchaseByUser[sub.userId.toString()];
      if (isFirstEver) byBucket[key].newCount += 1;
      else byBucket[key].recurringCount += 1;

      if (!planTotals[sub.plan]) planTotals[sub.plan] = { plan: sub.plan, count: 0, revenue: 0 };
      planTotals[sub.plan].count += 1;
      planTotals[sub.plan].revenue += revenue;

      const method = paymentMethodOf(sub);
      paymentMethodTotals[method] = (paymentMethodTotals[method] || 0) + 1;
    });

    // Category master list, for stable colors even if an expense's category
    // was later renamed/deleted from the master list.
    const colorByCategory = {};
    categories.forEach((c) => { colorByCategory[c.name] = c.color; });

    const categoryTotalsOverall = {};
    expenses.forEach((exp) => {
      const key = bucketKeyOfCalendarDate(exp.date, granularity);
      if (byBucket[key]) byBucket[key].expenses += exp.amount;
      categoryTotalsOverall[exp.category] = (categoryTotalsOverall[exp.category] || 0) + exp.amount;
    });

    const series = bucketKeys.map((key) => {
      const row = byBucket[key];
      return { ...row, profit: row.revenue - row.expenses };
    });

    const totals = series.reduce(
      (acc, row) => ({
        revenue: acc.revenue + row.revenue,
        expenses: acc.expenses + row.expenses,
        profit: acc.profit + row.profit,
        subscriptionCount: acc.subscriptionCount + row.subscriptionCount,
        newCount: acc.newCount + row.newCount,
        recurringCount: acc.recurringCount + row.recurringCount
      }),
      { revenue: 0, expenses: 0, profit: 0, subscriptionCount: 0, newCount: 0, recurringCount: 0 }
    );

    const planBreakdown = Object.values(planTotals).sort((a, b) => b.revenue - a.revenue);

    const expenseTotal = Object.values(categoryTotalsOverall).reduce((s, v) => s + v, 0);
    const expenseCategoryBreakdown = Object.entries(categoryTotalsOverall)
      .map(([category, amount]) => ({
        category,
        amount,
        color: colorByCategory[category] || OTHER_COLOR,
        percentage: expenseTotal > 0 ? Math.round((amount / expenseTotal) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    // Trend chart: cap to the top N categories by total spend across the
    // whole range, fold everything else into one consistent "Other" series
    // so every bucket's stacked bar uses the exact same category set.
    const topCategoryNames = expenseCategoryBreakdown.slice(0, MAX_TREND_CATEGORIES).map((c) => c.category);
    const trendHasOther = expenseCategoryBreakdown.length > MAX_TREND_CATEGORIES;
    const trendCategories = topCategoryNames.map((name) => ({ name, color: colorByCategory[name] || OTHER_COLOR }));
    if (trendHasOther) trendCategories.push({ name: 'Other', color: OTHER_COLOR });

    const trendByBucket = {};
    bucketKeys.forEach((key) => {
      trendByBucket[key] = { month: key, label: bucketLabel(key, granularity) };
      trendCategories.forEach((c) => { trendByBucket[key][c.name] = 0; });
    });
    expenses.forEach((exp) => {
      const key = bucketKeyOfCalendarDate(exp.date, granularity);
      if (!trendByBucket[key]) return;
      const bucket = topCategoryNames.includes(exp.category) ? exp.category : 'Other';
      if (trendByBucket[key][bucket] === undefined) return; // no Other bucket needed, nothing to add
      trendByBucket[key][bucket] += exp.amount;
    });
    const expenseCategoryTrend = {
      categories: trendCategories,
      series: bucketKeys.map((key) => trendByBucket[key])
    };

    const paymentMethodBreakdown = Object.entries(paymentMethodTotals)
      .map(([method, count]) => ({ method, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      series,
      totals,
      planBreakdown,
      expenseCategoryBreakdown,
      expenseCategoryTrend,
      paymentMethodBreakdown,
      granularity,
      startDate: calendarDateKey(rangeStartInput),
      endDate: calendarDateKey(rangeEndInput)
    });
  } catch (error) {
    console.error('Error building finance dashboard:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = { getFinanceDashboard };
