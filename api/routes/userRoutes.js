const user = require('../controllers/userController');
const userRoutes = function(app) {

  app
    .route('/user')
    .get(user.getAllUsers)
    .post(user.createUser);

  app
    .route('/user/:userId')
    .get(user.getUserById)
    .patch(user.updateUser)
    .delete(user.deleteUser);
};

module.exports = {
    userRoutes,
}