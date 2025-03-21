const user = require('../controllers/userController');
const userRoutes = function(app) {
  app
    .route('/user')
    .get(user.getAllUsers)
    .post(user.createUser);

  app.route('/user/login').post(user.getUserByEmailAndPassword);
  app.route('/user/login-with-otp').post(user.getUserByMobileNumberAndOtp);
  app.route('/user/all').get(user.getAllUsersWithMealCounts);

  app
    .route('/user/:userId')
    .get(user.getUserById)
    .patch(user.updateUser)
    .delete(user.deleteUser);

  app.route('/user/logout').post(user.logout);

  app.route('/user/forgot-password').post(user.forgotPassword);
  app.route('/user/reset-password/:token').post(user.resetPassword);
};

module.exports = {
  userRoutes
};
