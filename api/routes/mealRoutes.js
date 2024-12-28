const {
    createMeal, getMeal, removeMealItem,
    updateOrCreateMealWithImages,
    customizeMealRequest,
    getCustomisedMealRequests,
    fetchMenuImages,
    deleteAnImage,
} = require('../controllers/mealController');

const mealRoutes = function(app) {
  app.route('/meal/add-meal').post(createMeal);

  app.route('/meal/get-meal').get(getMeal);

  app.route('/meal/remove-meal-item/:mealId/:itemId').delete(removeMealItem);

  app.route('/meal/update-meal-images').put(updateOrCreateMealWithImages);

  app.route('/meal/fetch-menu-images').get(fetchMenuImages);

  app.route('/meal/delete-menu-images').delete(deleteAnImage);

  app.route('/meal/customise-meal-request').put(customizeMealRequest);

  app.route('/meal/get-customisation-requests').get(getCustomisedMealRequests);
};

module.exports = {
    mealRoutes,
}