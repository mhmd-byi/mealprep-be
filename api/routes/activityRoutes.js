const { createActivity, getActivityFromUserId, sendEmailMailTrap } = require("../controllers/activityController");

const activityRoutes = function (app) {
  app.route('/activity/add-activity').post(createActivity);

  app.route('/activity/get-activities').get(getActivityFromUserId);

  app.route('/activity/email/send').post(sendEmailMailTrap)
}

module.exports = {
  activityRoutes,
}
