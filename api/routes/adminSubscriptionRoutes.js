const {
  createAdminSubscription,
  updateAdminSubscription,
  getSubscriptionAuditLogs
} = require('../controllers/adminSubscriptionController');

const adminSubscriptionRoutes = function(app) {
  app.route('/admin/subscriptions').post(createAdminSubscription);
  app.route('/admin/subscriptions/:subscriptionId').put(updateAdminSubscription);
  app.route('/admin/subscriptions/audit-logs').get(getSubscriptionAuditLogs);
};

module.exports = {
  adminSubscriptionRoutes
};
