const {
  getMealLibraryItems,
  createMealLibraryItem,
  updateMealLibraryItem,
  deleteMealLibraryItem
} = require('../controllers/mealLibraryController');

const mealLibraryRoutes = function(app) {
  app.route('/meal-library').get(getMealLibraryItems).post(createMealLibraryItem);
  app.route('/meal-library/:itemId').put(updateMealLibraryItem).delete(deleteMealLibraryItem);
};

module.exports = {
  mealLibraryRoutes
};
