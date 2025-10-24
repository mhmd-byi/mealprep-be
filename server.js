const express = require('express');

const app = express();
const cors = require("cors");
const port = process.env.PORT || 3001;
require('dotenv').config()
const mongoose = require('mongoose');
require('./api/jobs/mealJobs');

// eslint-disable-next-line no-unused-vars
const Task = require('./api/models/todoListModel');
// created model loading here

const bodyParser = require('body-parser');
const todoRoutes = require('./api/routes/todoListRoutes');
const userRoutes = require('./api/routes/userRoutes');
const mealRoutes = require('./api/routes/mealRoutes');
const subscriptionRoutes = require('./api/routes/subscriptionRoutes');
const activityRoutes = require('./api/routes/activityRoutes');
const holidayRoutes = require('./api/routes/holidayRoutes');

const corsOptions = {
  origin: '*', // Adjust this to match the domain you want to allow
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// mongoose instance connection url connection
mongoose.Promise = global.Promise;
mongoose
  .connect(process.env.MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }).then(() => {
    console.log('database connected')
  })
  .catch(err => {
    console.log('Unable to connect', err);
  });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('Hello');
});

todoRoutes.todoListRoutes(app); // register the route
userRoutes.userRoutes(app); // register the route
mealRoutes.mealRoutes(app); // register meal routes
subscriptionRoutes.subscriptionRoutes(app); // register subscription routes
activityRoutes.activityRoutes(app); // register activity routes
holidayRoutes.holidayRoutes(app); // register holiday routes

app.listen(port, () => {
  console.log('Node.js + MongoDB RESTful API server started on: ' + port);
});
