const todoList = require('../controllers/todoListController');
const todoListRoutes = function(app) {

  // todoList Routes
  app
    .route('/tasks')
    .get(todoList.listAllTasks)
    .post(todoList.createATask);

  app
    .route('/tasks/:taskId')
    .get(todoList.readATask)
    .put(todoList.updateATask)
    .delete(todoList.deleteATask);
};

module.exports = {
  todoListRoutes,
}