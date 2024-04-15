const express = require('express');

const app = express();

const port = process.env.PORT || 3000;
require('dotenv').config()
const mongoose = require('mongoose');

// eslint-disable-next-line no-unused-vars
const Task = require('./api/models/todoListModel');
// created model loading here

const bodyParser = require('body-parser');
const routes = require('./api/routes/todoListRoutes');

// mongoose instance connection url connection
mongoose.Promise = global.Promise;
mongoose
  .connect(process.env.MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .catch(err => {
    console.log('Unable to connect', err);
  });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('Hello');
});

routes.todoListRoutes(app); // register the route

app.listen(port, () => {
  console.log('Node.js + MongoDB RESTful API server started on: ' + port);
});
