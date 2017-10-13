/* eslint-disable new-cap, no-param-reassign, prefer-destructuring */
const router = require('express').Router({ strict: true });
const FetchPostsError = require('../utils').FetchPostsError;
const logger = require('winston').loggers.get('controller-logger');
const InstagramManager = require('../models/instagram-manager');
const TwitterManager = require('../models/twitter-manager');
// const FacebookManager = require('../models/facebook-manager');
const SUPPORTED_SOURCES = ['instagram', 'twitter'];

router.get('/', (req, res) => {
  logger.info(
    `Was requested to fetch posts ${req.query.source}:${req.query
      .ids} by client_id=${req.query.client_id}`,
  );
  let promise;
  let implementationInstance;
  const ids = req.query.ids.split(',');
  const meta = {
    available_query_parameters: {
      source: {
        type: 'required',
        options: SUPPORTED_SOURCES,
      },
      ids: {
        type: 'required',
        help: 'multiple values possible, separated by commas',
      },
      client_id: {
        type: 'required',
      },
    },
  };
  if (SUPPORTED_SOURCES.includes(req.query.source)) {
    if (req.query.source === 'instagram') {
      implementationInstance = new InstagramManager([req.query.client_id]);
      promise = implementationInstance.getPostsByIds(ids);
    } else if (req.query.source === 'twitter') {
      implementationInstance = new TwitterManager([req.query.client_id]);
      promise = implementationInstance.getPostsByIds(ids);
    }
    promise.then(
      posts => {
        res.status(200).json({ success: true, meta, posts });
      },
      error => {
        res.status(200).json({ success: false, meta, error });
      },
    );
  } else {
    res.status(200).json({
      success: false,
      meta,
      error: new FetchPostsError('Not supported'),
    });
  }
});

module.exports = router;
