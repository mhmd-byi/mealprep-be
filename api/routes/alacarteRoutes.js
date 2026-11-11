const products = require('../controllers/productController');
const alacarte = require('../controllers/alacarteController');

const alacarteRoutes = function (app) {
  app.route('/public/products').get(products.getPublicProducts);

  app.route('/alacarte/config').get(alacarte.getConfig);
  app.route('/alacarte/quote').post(alacarte.quoteCart);
  app.route('/alacarte/orders').get(alacarte.myOrders).post(alacarte.placeOrder);
  app.route('/alacarte/orders/verify').post(alacarte.verifyOrderPayment);

  app.route('/admin/products').get(products.listAdminProducts).post(products.createProduct);
  app.route('/admin/products/:productId').put(products.updateProduct).delete(products.deleteProduct);
  app.route('/admin/products/:productId/active').patch(products.setProductActive);

  app.route('/admin/product-categories').get(products.listProductCategories).post(products.createProductCategory);
  app.route('/admin/product-categories/:categoryId').put(products.updateProductCategory).delete(products.deleteProductCategory);

  app.route('/admin/alacarte/orders').get(alacarte.listAdminOrders);
  app.route('/admin/alacarte/orders/:orderId/status').patch(alacarte.updateOrderStatus);
  app.route('/admin/alacarte/orders/:orderId/check-payment').post(alacarte.checkOrderPayment);
  app.route('/admin/alacarte/orders/:orderId/attention').delete(alacarte.clearAttention);
  app.route('/admin/alacarte/settings').get(alacarte.getAdminSettings).put(alacarte.updateAdminSettings);
};

module.exports = { alacarteRoutes };
