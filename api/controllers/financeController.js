const { DateTime } = require('luxon');
const Subscription = require('../models/subscriptionModel');
const Expense = require('../models/expenseModel');
const ExpenseCategory = require('../models/expenseCategoryModel');
const { requireAdmin } = require('../utils/requireAdmin');
const { computeNetRevenue } = require('../utils/planPricing');
const { IST_ZONE, todayCalendarDateUTC } = require('../utils/dateUtils');

const OTHER_COLOR = '#898781';
// Categories beyond this many (by total spend in the range) fold into "Other"
// in the month-by-month trend chart, so the stacked bar stays legible and the
// same category set is used for every month (never a different mix per bar).
const MAX_TREND_CATEGORIES = 7;

// `Subscription.createdAt` is a real timestamp, not the calendar-day-only
// convention — must go through IST explicitly (same discipline as the rest
// of this app's date handling) rather than reading raw UTC getters, or a
// subscription created just after IST midnight gets bucketed into the wrong
// (previous) month.
const monthKeyOfTimestamp = (timestamp) =>
  DateTime.fromJSDate(new Date(timestamp)).setZone(IST_ZONE).toFormat('yyyy-MM');

// `Expense.date` IS the calendar-day-UTC-midnight convention (parsed via
// parseCalendarDate at write time), so its UTC parts are already the correct
// IST year/month — safe to read directly.
const monthKeyOfCalendarDate = (date) => {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return DateTime.fromObject({ year: y, month: m, day: 1 }, { zone: 'utc' }).toFormat('LLL yyyy');
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

    const monthsBack = Math.min(24, Math.max(1, Number(req.query.months) || 12));

    // today's IST calendar date, anchored the same way the rest of the app does
    const today = todayCalendarDateUTC();
    const rangeStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (monthsBack - 1), 1));

    const [subscriptions, expenses, categories, allSubsForFirstPurchase] = await Promise.all([
      Subscription.find({ createdAt: { $gte: rangeStart } }),
      Expense.find({ date: { $gte: rangeStart } }),
      ExpenseCategory.find(),
      // Lightweight projection across the WHOLE collection (not range-limited) —
      // needed to know each user's very first-ever subscription, to classify
      // in-range subscriptions as new vs recurring.
      Subscription.find({}, 'userId createdAt')
    ]);

    // Pre-seed every month in the range so a quiet month shows as 0, not missing.
    const monthKeys = [];
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth() + i, 1));
      monthKeys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }

    const byMonth = {};
    monthKeys.forEach((key) => {
      byMonth[key] = {
        month: key,
        label: monthLabel(key),
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
      const key = monthKeyOfTimestamp(sub.createdAt);
      if (!byMonth[key]) return; // safety guard, shouldn't happen given the query range
      byMonth[key].subscriptionCount += 1;

      const revenue = computeNetRevenue(sub);
      byMonth[key].revenue += revenue;

      const isFirstEver = new Date(sub.createdAt).getTime() === firstPurchaseByUser[sub.userId.toString()];
      if (isFirstEver) byMonth[key].newCount += 1;
      else byMonth[key].recurringCount += 1;

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
      const key = monthKeyOfCalendarDate(exp.date);
      if (byMonth[key]) byMonth[key].expenses += exp.amount;
      categoryTotalsOverall[exp.category] = (categoryTotalsOverall[exp.category] || 0) + exp.amount;
    });

    const series = monthKeys.map((key) => {
      const row = byMonth[key];
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
    // so every month's stacked bar uses the exact same category set.
    const topCategoryNames = expenseCategoryBreakdown.slice(0, MAX_TREND_CATEGORIES).map((c) => c.category);
    const trendHasOther = expenseCategoryBreakdown.length > MAX_TREND_CATEGORIES;
    const trendCategories = topCategoryNames.map((name) => ({ name, color: colorByCategory[name] || OTHER_COLOR }));
    if (trendHasOther) trendCategories.push({ name: 'Other', color: OTHER_COLOR });

    const trendByMonth = {};
    monthKeys.forEach((key) => {
      trendByMonth[key] = { month: key, label: monthLabel(key) };
      trendCategories.forEach((c) => { trendByMonth[key][c.name] = 0; });
    });
    expenses.forEach((exp) => {
      const key = monthKeyOfCalendarDate(exp.date);
      if (!trendByMonth[key]) return;
      const bucket = topCategoryNames.includes(exp.category) ? exp.category : 'Other';
      if (trendByMonth[key][bucket] === undefined) return; // no Other bucket needed, nothing to add
      trendByMonth[key][bucket] += exp.amount;
    });
    const expenseCategoryTrend = {
      categories: trendCategories,
      series: monthKeys.map((key) => trendByMonth[key])
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
      monthsBack
    });
  } catch (error) {
    console.error('Error building finance dashboard:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = { getFinanceDashboard };
