const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const EXPENSE_CATEGORIES = [
  'Groceries',
  'Supplies',
  'Utilities',
  'Delivery',
  'Salary',
  'Rent',
  'Equipment/Maintenance',
  'Marketing',
  'Other'
];

const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer'];

const expenseSchema = new Schema(
  {
    date: {
      type: Date,
      required: true
    },
    category: {
      type: String,
      enum: EXPENSE_CATEGORIES,
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    description: {
      type: String,
      default: ''
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      required: true
    }
  },
  {
    timestamps: true
  }
);

const Expense = mongoose.model('Expense', expenseSchema);
Expense.CATEGORIES = EXPENSE_CATEGORIES;
Expense.PAYMENT_METHODS = PAYMENT_METHODS;

module.exports = Expense;
