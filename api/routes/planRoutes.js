const plans = require('../controllers/planController');

const planRoutes = function (app) {
  app.route('/public/plans').get(plans.getPublicPlans);

  app.route('/admin/plans').get(plans.listAdminPlans).post(plans.createPlan);
  app.route('/admin/plans/setup').post(plans.setupDefaultPlans);
  app.route('/admin/plans/:planId').put(plans.updatePlan).delete(plans.deletePlan);
  app.route('/admin/plans/:planId/active').patch(plans.setPlanActive);
};

module.exports = { planRoutes };
