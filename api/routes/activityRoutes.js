const { createActivity, getActivityFromUserId, getRecentActivities, sendEmailMailTrap, sendMessageAiSensy, verifyOtp } = require("../controllers/activityController");

const activityRoutes = function (app) {
  app.route('/activity/add-activity').post(createActivity);

  app.route('/activity/get-activities').get(getActivityFromUserId);

  app.route('/activity/recent').get(getRecentActivities);

  app.route('/activity/email/send').post(sendEmailMailTrap)

  app.route('/activity/send-otp').post(sendMessageAiSensy)

  app.route('/activity/verify-otp').post(verifyOtp)
}

module.exports = {
  activityRoutes,
}
