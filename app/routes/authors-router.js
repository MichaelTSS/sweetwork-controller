/* eslint-disable new-cap, no-param-reassign, prefer-destructuring */
const router = require('express').Router({ strict: true });
const querystring = require('querystring');

const FetchAuthorError = require('../utils').FetchAuthorError;
const logger = require('winston').loggers.get('controller-logger');
const InstagramManager = require('../models/instagram-manager');
const TwitterManager = require('../models/twitter-manager');
// const FacebookManager = require('../models/facebook-manager');

router.get('/', async (req, res) => {
  logger.info(`GET /api/v1/authors?${querystring.encode(req.query)}`);
  let promise;
  const ids = req.query.ids.split(',');
  //
  switch (req.query.source) {
    case 'twitter': {
      const twitterManager = new TwitterManager([req.query.client_id]);
      promise = twitterManager.getAuthorById(ids[0]);
      break;
    }
    case 'instagram': {
      const instagramManager = new InstagramManager([req.query.client_id]);
      promise = instagramManager.getAuthorById(ids[0]);
      break;
    }
    default: {
      res
        .status(200)
        .json({ success: false, error: new FetchAuthorError('Not supported') });
    }
  }
  promise.then(
    authors => res.status(200).json({ success: true, authors }),
    error => res.status(200).json({ success: false, error }),
  );
});

module.exports = router;
