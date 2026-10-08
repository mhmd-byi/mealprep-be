const Expense = require('../models/expenseModel');
const ExpenseCategory = require('../models/expenseCategoryModel');
const { requireAdmin } = require('../utils/requireAdmin');
const {
  todayCalendarDateUTC,
  parseCalendarDate,
  calendarDayOfWeek,
  addCalendarDays,
  calendarDateRangeUTC,
  diffInCalendarDays
} = require('../utils/dateUtils');
require('dotenv').config();

// Category/subcategory are admin-managed (ExpenseCategory), so they're
// validated dynamically here instead of a fixed schema enum. Returns the
// matching category doc so a subcategory can be checked against it too.
const findValidCategory = async (categoryName) => {
  const category = await ExpenseCategory.findOne({ name: categoryName });
  return category;
};

const validateCategoryAndSubcategory = async (categoryName, subcategoryName) => {
  const category = await findValidCategory(categoryName);
  if (!category) {
    return { error: `Unknown category "${categoryName}". Add it under Manage Categories first.` };
  }
  if (subcategoryName) {
    const hasSubcategory = category.subcategories.some((s) => s.name === subcategoryName);
    if (!hasSubcategory) {
      return { error: `"${subcategoryName}" is not a subcategory of "${categoryName}".` };
    }
  }
  return { category };
};

const createExpense = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { date, category, subcategory, amount, description, paymentMethod } = req.body;

    if (!date || !category || amount === undefined || amount === null || !paymentMethod) {
      return res.status(400).json({ message: 'date, category, amount and paymentMethod are required.' });
    }
    const { error } = await validateCategoryAndSubcategory(category, subcategory);
    if (error) {
      return res.status(400).json({ message: error });
    }
    if (!Expense.PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ message: `paymentMethod must be one of: ${Expense.PAYMENT_METHODS.join(', ')}` });
    }
    if (typeof amount !== 'number' || amount < 0) {
      return res.status(400).json({ message: 'amount must be a non-negative number.' });
    }

    const expense = new Expense({
      date: parseCalendarDate(date),
      category,
      subcategory: subcategory || '',
      amount,
      description: description || '',
      paymentMethod
    });
    const saved = await expense.save();
    res.status(201).json(saved);
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const getExpenses = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { startDate, endDate, category, subcategory, paymentMethod, search } = req.query;
    const query = {};

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = parseCalendarDate(startDate);
      if (endDate) query.date.$lte = calendarDateRangeUTC(endDate).end;
    }
    if (category) {
      query.category = category;
    }
    if (subcategory) {
      query.subcategory = subcategory;
    }
    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }
    if (search) {
      query.description = { $regex: search, $options: 'i' };
    }

    const expenses = await Expense.find(query).sort({ date: -1, createdAt: -1 });
    res.json(expenses);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const updateExpense = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { expenseId } = req.params;
    const { date, category, subcategory, amount, description, paymentMethod } = req.body;

    if (category || subcategory) {
      const existing = await Expense.findById(expenseId);
      if (!existing) {
        return res.status(404).json({ message: 'Expense not found.' });
      }
      const effectiveCategory = category || existing.category;
      const effectiveSubcategory = subcategory !== undefined ? subcategory : existing.subcategory;
      const { error } = await validateCategoryAndSubcategory(effectiveCategory, effectiveSubcategory);
      if (error) {
        return res.status(400).json({ message: error });
      }
    }
    if (paymentMethod && !Expense.PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ message: `paymentMethod must be one of: ${Expense.PAYMENT_METHODS.join(', ')}` });
    }
    if (amount !== undefined && (typeof amount !== 'number' || amount < 0)) {
      return res.status(400).json({ message: 'amount must be a non-negative number.' });
    }

    const updates = {};
    if (date) updates.date = parseCalendarDate(date);
    if (category) updates.category = category;
    if (subcategory !== undefined) updates.subcategory = subcategory;
    if (amount !== undefined) updates.amount = amount;
    if (description !== undefined) updates.description = description;
    if (paymentMethod) updates.paymentMethod = paymentMethod;

    const updated = await Expense.findByIdAndUpdate(expenseId, updates, { new: true, runValidators: true });
    if (!updated) {
      return res.status(404).json({ message: 'Expense not found.' });
    }
    res.json(updated);
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const deleteExpense = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { expenseId } = req.params;
    const deleted = await Expense.findByIdAndDelete(expenseId);
    if (!deleted) {
      return res.status(404).json({ message: 'Expense not found.' });
    }
    res.json({ message: 'Expense deleted successfully.' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

const getExpenseSummary = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { startDate, endDate } = req.query;
    const hasRange = !!(startDate && endDate);

    const today = todayCalendarDateUTC();
    // `today` is UTC-midnight-anchored to the IST calendar day, so its UTC parts
    // are the correct year/month/day regardless of the server's own timezone.
    //
    // With no range given, this defaults to the real current calendar month —
    // identical to the previous hardcoded behavior. When the admin filters the
    // Expenses page to a specific month (or a custom date range), the same
    // "period"/"week within period" math is anchored to that range instead of
    // to today, so every summary card reflects whichever period is on screen.
    const periodEnd = hasRange ? parseCalendarDate(endDate) : today;
    const periodStart = hasRange
      ? parseCalendarDate(startDate)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const periodEndBound = hasRange ? calendarDateRangeUTC(endDate).end : calendarDateRangeUTC(today).end;

    const weekDay = calendarDayOfWeek(periodEnd); // 0 = Sunday .. 6 = Saturday
    const daysSinceMonday = weekDay === 0 ? 6 : weekDay - 1;
    let weekStart = addCalendarDays(periodEnd, -daysSinceMonday);
    if (weekStart < periodStart) weekStart = periodStart; // clamp to the selected period

    const [monthExpenses, weekExpenses] = await Promise.all([
      Expense.find({ date: { $gte: periodStart, $lte: periodEndBound } }),
      Expense.find({ date: { $gte: weekStart, $lte: periodEndBound } })
    ]);

    const monthTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
    const weekTotal = weekExpenses.reduce((sum, e) => sum + e.amount, 0);

    const categoryTotals = {};
    monthExpenses.forEach(e => {
      categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
    });

    // Colors now live on the admin-managed category, not a hardcoded map —
    // fall back to a neutral gray for a category since deleted from the master list.
    const categoryDocs = await ExpenseCategory.find({ name: { $in: Object.keys(categoryTotals) } });
    const colorByCategory = {};
    categoryDocs.forEach((c) => { colorByCategory[c.name] = c.color; });

    const breakdown = Object.entries(categoryTotals)
      .map(([category, amount]) => ({
        category,
        amount,
        color: colorByCategory[category] || '#898781',
        percentage: monthTotal > 0 ? Math.round((amount / monthTotal) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    const topCategory = breakdown.length > 0 ? breakdown[0].category : null;
    // Inclusive day count of the period (matches the old `today.getUTCDate()`
    // exactly when there's no range, since periodStart is the 1st of the month).
    const daysElapsed = diffInCalendarDays(periodEnd, periodStart) + 1;
    const averageDailySpend = daysElapsed > 0 ? Math.round(monthTotal / daysElapsed) : 0;

    // Comparison periods: the same-length window immediately before each one
    // above, so "vs last month/week" works the same whether the admin is
    // looking at the real current month or a filtered range.
    const prevPeriodEnd = addCalendarDays(periodStart, -1);
    const prevPeriodStart = addCalendarDays(prevPeriodEnd, -(daysElapsed - 1));
    const weekLengthDays = diffInCalendarDays(periodEnd, weekStart) + 1;
    const prevWeekEnd = addCalendarDays(weekStart, -1);
    const prevWeekStart = addCalendarDays(prevWeekEnd, -(weekLengthDays - 1));

    const [prevMonthExpenses, prevWeekExpenses] = await Promise.all([
      Expense.find({ date: { $gte: prevPeriodStart, $lte: calendarDateRangeUTC(prevPeriodEnd).end } }),
      Expense.find({ date: { $gte: prevWeekStart, $lte: calendarDateRangeUTC(prevWeekEnd).end } })
    ]);
    const prevMonthTotal = prevMonthExpenses.reduce((sum, e) => sum + e.amount, 0);
    const prevWeekTotal = prevWeekExpenses.reduce((sum, e) => sum + e.amount, 0);
    const prevDaysElapsed = diffInCalendarDays(prevPeriodEnd, prevPeriodStart) + 1;
    const prevAverageDailySpend = prevDaysElapsed > 0 ? Math.round(prevMonthTotal / prevDaysElapsed) : 0;

    const percentChange = (current, previous) => {
      if (previous === 0) return current === 0 ? 0 : null;
      return Math.round(((current - previous) / previous) * 100);
    };

    res.json({
      monthTotal,
      weekTotal,
      topCategory,
      averageDailySpend,
      breakdown,
      isCustomPeriod: hasRange,
      monthChangePercent: percentChange(monthTotal, prevMonthTotal),
      weekChangePercent: percentChange(weekTotal, prevWeekTotal),
      averageDailyChangePercent: percentChange(averageDailySpend, prevAverageDailySpend)
    });
  } catch (error) {
    console.error('Error building expense summary:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// Monthly totals for the last N months (including the current one), for the
// "Monthly Trend" chart — independent of whatever period the summary cards
// and table are currently filtered to.
const getExpenseMonthlyTrend = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const months = Math.min(24, Math.max(1, Number(req.query.months) || 6));
    const today = todayCalendarDateUTC();
    const rangeStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (months - 1), 1));
    const rangeEnd = calendarDateRangeUTC(today).end;

    const expenses = await Expense.find({ date: { $gte: rangeStart, $lte: rangeEnd } });

    const totalsByMonth = {};
    expenses.forEach((e) => {
      const d = new Date(e.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      totalsByMonth[key] = (totalsByMonth[key] || 0) + e.amount;
    });

    const series = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      series.push({
        month: key,
        label: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
        total: totalsByMonth[key] || 0
      });
    }

    res.json({ series });
  } catch (error) {
    console.error('Error building expense monthly trend:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  createExpense,
  getExpenses,
  getExpenseMonthlyTrend,
  updateExpense,
  deleteExpense,
  getExpenseSummary
};
