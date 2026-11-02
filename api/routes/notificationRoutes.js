const controller = require('../controllers/notificationController');

const notificationRoutes = function(app) {
  app.route('/admin/notifications').get(controller.listNotifications).post(controller.createNotification);
  app.route('/admin/notifications/preview').post(controller.previewAudience);
  app.route('/admin/notifications/test').post(controller.sendTestNotification);
  app.route('/admin/notifications/:notificationId').get(controller.getNotification);
  app.route('/admin/notifications/:notificationId/cancel').post(controller.cancelNotification);

  app.route('/admin/notification-templates').get(controller.listTemplates).post(controller.saveTemplate);
  app.route('/admin/notification-templates/:templateId').put(controller.saveTemplate).delete(controller.deleteTemplate);

  app.route('/admin/notification-settings').get(controller.getSettings);
  app.route('/admin/notification-settings/:key').put(controller.updateSetting);

  app.route('/notifications/devices').post(controller.registerDevice).delete(controller.unregisterDevice);
  app.route('/notifications/inbox').get(controller.getInbox);
  app.route('/notifications/inbox/read-all').post(controller.markAllRead);
  app.route('/notifications/inbox/:id/read').post(controller.markRead);
  app.route('/notifications/campaign/:notificationId/read').post(controller.markCampaignRead);
  app.route('/notifications/preferences').get(controller.getPreferences).put(controller.updatePreferences);
};

module.exports = { notificationRoutes };
