const { getFinanceDashboard, getDailySales, getRazorpayTransactions, getRecentTransactions } = require('../controllers/financeController');

const financeRoutes = function(app) {
  app.route('/finance/dashboard').get(getFinanceDashboard);
  app.route('/finance/daily-sales').get(getDailySales);
  app.route('/finance/razorpay-transactions').get(getRazorpayTransactions);
  app.route('/finance/recent-transactions').get(getRecentTransactions);
};

module.exports = {
  financeRoutes
};
