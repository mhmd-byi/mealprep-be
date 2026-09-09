const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer'];

const expenseSchema = new Schema(
  {
    date: {
      type: Date,
      required: true
    },
    // Category/subcategory are admin-managed (see ExpenseCategory) and stored
    // here as plain text, not a reference — deleting or renaming a master
    // category later must never change what an existing expense says it was.
    category: {
      type: String,
      required: true
    },
    subcategory: {
      type: String,
      default: ''
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
Expense.PAYMENT_METHODS = PAYMENT_METHODS;

module.exports = Expense;
