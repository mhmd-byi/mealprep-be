const {
  getProfessionOptions,
  createProfessionOption,
  updateProfessionOption,
  deleteProfessionOption
} = require('../controllers/professionOptionController');

const professionOptionRoutes = function(app) {
  app.route('/profession-options').get(getProfessionOptions).post(createProfessionOption);
  app.route('/profession-options/:optionId').put(updateProfessionOption).delete(deleteProfessionOption);
};

module.exports = {
  professionOptionRoutes
};
