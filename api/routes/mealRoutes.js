const {
    createMeal, getMeal, removeMealItem, updateOrCreateMealWithImage,
} = require('../controllers/mealController');

const mealRoutes = function(app) {
  app.route('/meal/add-meal').post(createMeal);

  app.route('/meal/get-meal').get(getMeal);

  app.route('/meal/remove-meal-item/:mealId/:itemId').delete(removeMealItem);

  app.route('/meal/update-meal-image').patch(updateOrCreateMealWithImage);
};

module.exports = {
    mealRoutes,
}