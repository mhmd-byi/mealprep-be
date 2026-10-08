const {
  getMealCategories,
  createMealCategory,
  updateMealCategory,
  deleteMealCategory
} = require('../controllers/mealCategoryController');

const mealCategoryRoutes = function(app) {
  app.route('/meal-categories').get(getMealCategories).post(createMealCategory);
  app.route('/meal-categories/:categoryId').put(updateMealCategory).delete(deleteMealCategory);
};

module.exports = {
  mealCategoryRoutes
};
