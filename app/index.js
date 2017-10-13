const path = require('path');
const express = require('express');
const routes = require('./routes/index-router');
const bodyParser = require('body-parser');

const app = express();
const logger = require('winston').loggers.get('controller-logger');
const config = require('./config');

const secret = config.get('SVC_CONTROLLER:jwt_secret');
const jwtCheck = require('express-jwt')({ secret });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/v1', jwtCheck);
app.use(routes);

// when missing or invalid JWT
app.use((err, req, res) => {
  if (err.name === 'UnauthorizedError') {
    logger.error(err);
    res.status(401).json({
      message: err.message,
      error: {
        name: err.name,
        code: err.code,
        status: err.status,
      },
    });
  }
});

// catch 404 and forward to error handler
app.use((req, res) => {
  const err = new Error(`Not Found, requested: ${req.method} ${req.path}`);
  err.status = 404;
  logger.error(err);
  res.status(404).json({
    error: {
      name: err.name,
      message: err.message,
    },
  });
});

// error handlers
app.use((err, req, res) => {
  res.status(err.status || 500);
  logger.error(err);
  res.json({
    error: {
      name: err.name,
      message: err.message,
    },
  });
});

module.exports = app;
