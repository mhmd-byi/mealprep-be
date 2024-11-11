const {
  cancelMealRequest,
  getCancelledMeals,
  getSubscriptionDetails,
  createSubscription,
  getUserForMealDelivery,
  createRazorpayOrder,
  verifyPayment
} = require('../controllers/subscriptionController');

const subscriptionRoutes = function(app) {
  app.route('/subscription/cancel-request').post(cancelMealRequest);
  app.route('/subscription/cancelled-meals').get(getCancelledMeals);
  app
    .route('/subscription/:userId/subscription')
    .get(getSubscriptionDetails)
    .post(createSubscription);
  app.route('/subscription/get-meal-delivery-details').get(getUserForMealDelivery);
  app.route('/subscription/create-order').post(createRazorpayOrder);
  app.route('/subscription/verify-payment').post(verifyPayment);
};

module.exports = {
  subscriptionRoutes
};
