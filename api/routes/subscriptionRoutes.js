const {
  cancelMealRequest,
  getCancelledMeals,
  getSubscriptionDetails,
  createSubscription
} = require('../controllers/subscriptionController');

const subscriptionRoutes = function(app) {
  app.route('/subscription/cancel-request').post(cancelMealRequest);
  app.route('/subscription/cancelled-meals').get(getCancelledMeals);
  app
    .route('/subscription/:userId/subscription')
    .get(getSubscriptionDetails)
    .post(createSubscription);
};

module.exports = {
  subscriptionRoutes
};
