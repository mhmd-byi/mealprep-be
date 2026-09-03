const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const Expense = require('../models/expenseModel');
require('dotenv').config();

// Verifies the bearer token and requires an admin role. Sends the response
// and returns null when unauthorized; returns the user document otherwise.
const requireAdmin = async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'No token provided or token is malformed' });
    return null;
  }
  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    res.status(401).json({ message: 'Invalid Token' });
    return null;
  }
  const user = await User.findById(decoded.sub);
  if (!user || user.role !== 'admin') {
    res.status(403).json({ message: 'Admin access required' });
    return null;
  }
  return user;
};

const getISTNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const createExpense = async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { date, category, amount, description, paymentMethod } = req.body;

    if (!date || !category || amount === undefined || amount === null || !paymentMethod) {
      return res.status(400).json({ message: 'date, category, amount and paymentMethod are required.' });
    }
    if (!Expense.CATEGORIES.includes(category)) {
      return res.status(400).json({ message: `category must be one of: ${Expense.CATEGORIES.join(', ')}` });
    }
    if (!Expense.PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ message: `paymentMethod must be one of: ${Expense.PAYMENT_METHODS.join(', ')}` });
    }
    if (typeof amount !== 'number' || amount < 0) {
      return res.status(400).json({ message: 'amount must be a non-negative number.' });
    }

    const expense = new Expense({
      date: new Date(date),
      category,
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

    const { startDate, endDate, category, search } = req.query;
    const query = {};

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startOfDay(new Date(startDate));
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }
    if (category) {
      query.category = category;
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
    const { date, category, amount, description, paymentMethod } = req.body;

    if (category && !Expense.CATEGORIES.includes(category)) {
      return res.status(400).json({ message: `category must be one of: ${Expense.CATEGORIES.join(', ')}` });
    }
    if (paymentMethod && !Expense.PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ message: `paymentMethod must be one of: ${Expense.PAYMENT_METHODS.join(', ')}` });
    }
    if (amount !== undefined && (typeof amount !== 'number' || amount < 0)) {
      return res.status(400).json({ message: 'amount must be a non-negative number.' });
    }

    const updates = {};
    if (date) updates.date = new Date(date);
    if (category) updates.category = category;
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

    const now = getISTNow();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekDay = now.getDay(); // 0 = Sunday .. 6 = Saturday
    const daysSinceMonday = weekDay === 0 ? 6 : weekDay - 1;
    const weekStart = startOfDay(new Date(now));
    weekStart.setDate(weekStart.getDate() - daysSinceMonday);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

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
    const breakdown = Object.entries(categoryTotals)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: monthTotal > 0 ? Math.round((amount / monthTotal) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    const topCategory = breakdown.length > 0 ? breakdown[0].category : null;
    const daysElapsed = now.getDate(); // how many days into the current month so far
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
