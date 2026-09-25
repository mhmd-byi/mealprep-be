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
    // here as plain text, not a reference. Renaming a category/subcategory in
    // ExpenseCategory cascades to update matching text here too (see
    // expenseCategoryController's updateCategory/updateSubcategory); deleting
    // one does not touch existing expenses, only the picklist going forward.
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
