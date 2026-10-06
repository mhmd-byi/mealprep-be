const {
  createAdminSubscription,
  updateAdminSubscription,
  getSubscriptionAuditLogs,
  closeAccount
} = require('../controllers/adminSubscriptionController');

const adminSubscriptionRoutes = function(app) {
  app.route('/admin/subscriptions').post(createAdminSubscription);
  app.route('/admin/subscriptions/:subscriptionId').put(updateAdminSubscription);
  app.route('/admin/subscriptions/audit-logs').get(getSubscriptionAuditLogs);
  app.route('/admin/users/:userId/close-account').post(closeAccount);
};

module.exports = {
  adminSubscriptionRoutes
};
