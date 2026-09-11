const { getFinanceDashboard } = require('../controllers/financeController');

const financeRoutes = function(app) {
  app.route('/finance/dashboard').get(getFinanceDashboard);
};

module.exports = {
  financeRoutes
};
