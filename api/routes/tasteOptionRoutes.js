const {
  getTasteOptions,
  createTasteOption,
  updateTasteOption,
  deleteTasteOption
} = require('../controllers/tasteOptionController');

const tasteOptionRoutes = function(app) {
  app.route('/taste-options').get(getTasteOptions).post(createTasteOption);
  app.route('/taste-options/:optionId').put(updateTasteOption).delete(deleteTasteOption);
};

module.exports = {
  tasteOptionRoutes
};
