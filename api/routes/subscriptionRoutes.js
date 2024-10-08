const {
  cancelMealRequest,
  getCancelledMeals,
  getSubscriptionDetails,
  createSubscription,
  getUserForMealDelivery
} = require('../controllers/subscriptionController');

const subscriptionRoutes = function(app) {
  app.route('/subscription/cancel-request').post(cancelMealRequest);
  app.route('/subscription/cancelled-meals').get(getCancelledMeals);
  app
    .route('/subscription/:userId/subscription')
    .get(getSubscriptionDetails)
    .post(createSubscription);
  app.route('/subscription/get-meal-delivery-details').get(getUserForMealDelivery);
};

module.exports = {
  subscriptionRoutes
};
