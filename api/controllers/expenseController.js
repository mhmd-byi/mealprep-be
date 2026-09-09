const Expense = require('../models/expenseModel');
const ExpenseCategory = require('../models/expenseCategoryModel');
const { requireAdmin } = require('../utils/requireAdmin');
const {
  todayCalendarDateUTC,
  parseCalendarDate,
  calendarDayOfWeek,
  addCalendarDays,
  calendarDateRangeUTC
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

    const { startDate, endDate, category, subcategory, search } = req.query;
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

    const today = todayCalendarDateUTC();
    // `today` is UTC-midnight-anchored to the IST calendar day, so its UTC parts
    // are the correct year/month/day regardless of the server's own timezone.
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const weekDay = calendarDayOfWeek(today); // 0 = Sunday .. 6 = Saturday
    const daysSinceMonday = weekDay === 0 ? 6 : weekDay - 1;
    const weekStart = addCalendarDays(today, -daysSinceMonday);
    const todayEnd = calendarDateRangeUTC(today).end;

    const [monthExpenses, weekExpenses] = await Promise.all([
      Expense.find({ date: { $gte: monthStart, $lte: todayEnd } }),
      Expense.find({ date: { $gte: weekStart, $lte: todayEnd } })
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
    const daysElapsed = today.getUTCDate(); // how many days into the current month so far
    const averageDailySpend = daysElapsed > 0 ? Math.round(monthTotal / daysElapsed) : 0;

    res.json({
      monthTotal,
      weekTotal,
      topCategory,
      averageDailySpend,
      breakdown
    });
  } catch (error) {
    console.error('Error building expense summary:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

module.exports = {
  createExpense,
  getExpenses,
  updateExpense,
  deleteExpense,
  getExpenseSummary
};
