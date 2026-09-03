const {
  cancelMealRequest,
  getCancelledMeals,
  getDeliveredMeals,
  getMealSchedule,
  updateMealSchedule,
  getDietaryStockReport,
  getSubscriptionDetails,
  createSubscription,
  getUserForMealDelivery,
  createRazorpayOrder,
  verifyPayment,
  getActiveSubscriptionCounts,
  handleRazorpayWebhook,
  cancelQueuedPlan
} = require('../controllers/subscriptionController');

const subscriptionRoutes = function(app) {
  app.route('/subscription/cancel-request').post(cancelMealRequest);
  app.route('/subscription/cancelled-meals').get(getCancelledMeals);
  app.route('/subscription/delivered-meals').get(getDeliveredMeals);
  app.route('/subscription/meal-schedule').put(updateMealSchedule);
  app.route('/subscription/dietary-stock-report').get(getDietaryStockReport);
  app.route('/subscription/:userId/meal-schedule').get(getMealSchedule);
  app
    .route('/subscription/:userId/subscription')
    .get(getSubscriptionDetails)
    .post(createSubscription);
  app.route('/subscription/get-meal-delivery-details').get(getUserForMealDelivery);
  app.route('/subscription/create-order').post(createRazorpayOrder);
  app.route('/subscription/verify-payment').post(verifyPayment);
  app.route('/subscription/webhook').post(handleRazorpayWebhook);
  app.route('/subscription/active-subscription-counts').get(getActiveSubscriptionCounts);
  // Admin: cancel a queued plan on behalf of a user
  app.route('/subscription/queued/:subscriptionId/cancel').delete(cancelQueuedPlan);
};

module.exports = {
  subscriptionRoutes
};
