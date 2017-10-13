/* eslint-disable new-cap, no-param-reassign */
const router = require('express').Router({ strict: true });

const FetchAuthorError = require('../utils').FetchAuthorError;
const logger = require('winston').loggers.get('controller-logger');
const InstagramManager = require('../models/instagram-manager');
const TwitterManager = require('../models/twitter-manager');
// const FacebookManager = require('../models/facebook-manager');
const SUPPORTED_SOURCES = ['instagram', 'twitter'];

router.get('/', (req, res, next) => {
  logger.info(
    `Was requested to fetch author ${req.query.source}:${req.query
      .ids} by client_id=${req.query.client_id}`,
  );
  let promise;
  let implementationInstance;
  const ids = req.query.ids.split(',');
  if (SUPPORTED_SOURCES.includes(req.query.source)) {
    if (req.query.source === 'instagram') {
      implementationInstance = new InstagramManager([req.query.client_id]);
      promise = implementationInstance.getAuthorById(ids[0]);
    } else if (req.query.source === 'twitter') {
      implementationInstance = new TwitterManager([req.query.client_id]);
      promise = implementationInstance.getAuthorById(ids[0]);
    }
    promise.then(
      authors => {
        res.status(200).json({ success: true, authors });
      },
      error => {
        res.status(200).json({ success: false, error });
      },
    );
  } else {
    res
      .status(200)
      .json({ success: false, error: new FetchAuthorError('Not supported') });
  }
});

module.exports = router;
