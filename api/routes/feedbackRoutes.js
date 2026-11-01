const { sendFeedback } = require('../controllers/feedbackController');

const feedbackRoutes = function(app) {
  app.route('/feedback').post(sendFeedback);
};

module.exports = {
  feedbackRoutes
};
