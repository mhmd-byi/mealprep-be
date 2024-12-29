const { createActivity, getActivityFromUserId } = require("../controllers/activityController");

const activityRoutes = function (app) {
  app.route('/activity/add-activity').post(createActivity);

  app.route('/activity/get-activities').get(getActivityFromUserId);
}

module.exports = {
  activityRoutes,
}
