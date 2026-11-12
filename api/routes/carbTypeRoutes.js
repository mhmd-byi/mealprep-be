const carbTypes = require('../controllers/carbTypeController');

const carbTypeRoutes = function (app) {
  app.route('/public/carb-types').get(carbTypes.getPublicCarbTypes);

  app.route('/admin/carb-types').get(carbTypes.listAdminCarbTypes).post(carbTypes.createCarbType);
  app.route('/admin/carb-types/setup').post(carbTypes.setupDefaultCarbTypes);
  app.route('/admin/carb-types/:carbTypeId').put(carbTypes.updateCarbType).delete(carbTypes.deleteCarbType);
  app.route('/admin/carb-types/:carbTypeId/active').patch(carbTypes.setCarbTypeActive);
};

module.exports = { carbTypeRoutes };
