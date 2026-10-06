const { getFinanceDashboard, getRazorpayTransactions } = require('../controllers/financeController');

const financeRoutes = function(app) {
  app.route('/finance/dashboard').get(getFinanceDashboard);
  app.route('/finance/razorpay-transactions').get(getRazorpayTransactions);
};

module.exports = {
  financeRoutes
};
