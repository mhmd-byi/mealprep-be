const {
    createMeal, getMeal, removeMealItem,
    updateOrCreateMealWithImages,
    customizeMealRequest,
    getCustomisedMealRequests,
} = require('../controllers/mealController');

const mealRoutes = function(app) {
  app.route('/meal/add-meal').post(createMeal);

  app.route('/meal/get-meal').get(getMeal);

  app.route('/meal/remove-meal-item/:mealId/:itemId').delete(removeMealItem);

  app.route('/meal/update-meal-images').patch(updateOrCreateMealWithImages);

  app.route('/meal/customise-meal-request').put(customizeMealRequest);

  app.route('/meal/get-customisation-requests').get(getCustomisedMealRequests);
};

module.exports = {
    mealRoutes,
}