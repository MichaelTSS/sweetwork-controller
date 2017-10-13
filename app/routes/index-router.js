/* eslint-disable new-cap */

// 3rd party
const router = require('express').Router({ strict: true });
const cors = require('cors');
const logger = require('winston').loggers.get('controller-logger');
const jwt = require('jsonwebtoken');
const moment = require('moment-timezone');
const config = require('../config');
// plugr
const RedisClient = require('sweetwork-redis-client');
const RedisKeys = require('../redis-keys');
const metricsRouter = require('./metrics-router');
const populateRouter = require('./populate-router');
const recoverRouter = require('./recover-router');
const authorsRouter = require('./authors-router');
const postsRouter = require('./posts-router');
const searchRouter = require('./search-router');

router.use(cors());

router.get('/favicon.ico', (req, res) => {
  res.status(200).send(null);
});

router.use('/ping', (req, res) => {
  res.json({ success: true, message: 'Controller Service pong' });
});

router.get('/', (req, res) => {
  logger.info(`Controller Service ${req.method} ${req.path}`);
  res.status(200).json({
    success: true,
    data: [],
    meta: [],
  });
});

router.post('/auth', (req, res) => {
  const passphrase = config.get('SVC_CONTROLLER:jwt_passphrase');
  const secret = config.get('SVC_CONTROLLER:jwt_secret');
  if (!req.body.service) {
    const error = new Error(
      'Controller Service Auth: service body is required',
    );
    logger.error(error);
    res.status(400).json({
      message: error.message,
      error,
    });
  } else if (!req.body.passphrase) {
    const error = new Error(
      'Controller Service Auth: passphrase body is required',
    );
    logger.error(error);
    res.status(400).json({
      message: error.message,
      error,
    });
  } else if (req.body.passphrase !== passphrase) {
    const error = new Error(
      `Controller Service Auth: wrong passphrase ${JSON.stringify(
        req.body,
      )} vs. passphrase`,
    );
    logger.error(error);
    res.status(401).json({
      message: error.message,
      error: {
        name: error.name,
        code: error.code,
        status: error.status,
      },
    });
  } else {
    const token = jwt.sign({ service: req.body.service }, secret);
    res.status(200).json({
      success: true,
      token,
    });
  }
});

router.all('/api/v1/*', (req, res, next) => {
  // logger.info(`Crawler Service ${req.method} ${req.originalUrl}`);
  // log by service
  const cli = new RedisClient(
    config.get('REDIS:host'),
    config.get('REDIS:port'),
    config.get('REDIS:db'),
  );
  const unixNow = moment().unix();
  const inboundRequestsKey = RedisKeys.inboundRequestsByServiceName(
    req.user.service,
  );
  cli.zadd({
    key: inboundRequestsKey,
    scomembers: [unixNow, `${req.method} ${req.originalUrl} ${unixNow}`],
  });
  next();
});

router.use('/api/v1/metrics', metricsRouter);
router.use('/api/v1/populate', populateRouter);
router.use('/api/v1/recover', recoverRouter);
router.use('/api/v1/search', searchRouter);
router.use('/api/v1/authors', authorsRouter);
router.use('/api/v1/posts', postsRouter);

module.exports = router;
