const {
  createExpense,
  getExpenses,
  updateExpense,
  deleteExpense,
  getExpenseSummary
} = require('../controllers/expenseController');

const expenseRoutes = function(app) {
  app.route('/expense/add-expense').post(createExpense);
  app.route('/expense/get-expenses').get(getExpenses);
  app.route('/expense/summary').get(getExpenseSummary);
  app.route('/expense/update-expense/:expenseId').put(updateExpense);
  app.route('/expense/delete-expense/:expenseId').delete(deleteExpense);
};

module.exports = {
  expenseRoutes
};
