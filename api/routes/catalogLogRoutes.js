const catalogLog = require('../controllers/catalogLogController');

const catalogLogRoutes = function (app) {
  app.route('/admin/catalog-log').get(catalogLog.listCatalogLog);
  app.route('/admin/catalog-log/export').get(catalogLog.exportCatalogLog);
};

module.exports = { catalogLogRoutes };
