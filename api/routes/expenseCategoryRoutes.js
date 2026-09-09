const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  addSubcategory,
  updateSubcategory,
  deleteSubcategory
} = require('../controllers/expenseCategoryController');

const expenseCategoryRoutes = function(app) {
  app.route('/expense-categories').get(getCategories).post(createCategory);
  app.route('/expense-categories/:categoryId').put(updateCategory).delete(deleteCategory);
  app.route('/expense-categories/:categoryId/subcategories').post(addSubcategory);
  app
    .route('/expense-categories/:categoryId/subcategories/:subcategoryId')
    .put(updateSubcategory)
    .delete(deleteSubcategory);
};

module.exports = {
  expenseCategoryRoutes
};
