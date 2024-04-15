const mongoose = require('mongoose');

const Task = mongoose.model('Tasks');

const listAllTasks = function(req, res) {
  Task.find({}, function(err, task) {
    if (err) {
      res.send(err);
    }
    res.json(task);
  });
};

const createATask = function(req, res) {
  const newTask = new Task(req.body);
  newTask.save(function(err, task) {
    if (err) {
      res.send(err);
    }
    res.json(task);
  });
};

const readATask = function(req, res) {
  Task.findById(req.params.taskId, function(err, task) {
    if (err) {
      res.send(err);
    }
    res.json(task);
  });
};

const updateATask = function(req, res) {
  Task.findOneAndUpdate({ _id: req.params.taskId }, req.body, { new: true }, function(err, task) {
    if (err) {
      res.send(err);
    }
    res.json(task);
  });
};

const deleteATask = function(req, res) {
  Task.remove(
    {
      _id: req.params.taskId
    },
    function(err, task) {
      if (err) {
        res.send(err);
      }
      res.json({ message: 'Task successfully deleted' });
    }
  );
};

module.exports = {
  createATask,
  readATask,
  deleteATask,
  updateATask,
  listAllTasks,
}