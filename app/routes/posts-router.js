/* eslint-disable new-cap, no-param-reassign, prefer-destructuring */
const router = require('express').Router({ strict: true });
const FetchPostsError = require('../utils').FetchPostsError;
const logger = require('winston').loggers.get('controller-logger');
const InstagramManager = require('../models/instagram-manager');
const TwitterManager = require('../models/twitter-manager');

const SUPPORTED_SOURCES = {
  instagram: InstagramManager,
  twitter: TwitterManager,
};

router.get('/', async (req, res) => {
  logger.info(
    `Was requested to fetch posts ${req.query.source}:${req.query
      .ids} by client_id=${req.query.client_id}`,
  );
  //
  const source = req.query.source;
  const ids = req.query.ids.split(',');
  const meta = {
    available_query_parameters: {
      source: {
        type: 'required',
        options: Object.keys(SUPPORTED_SOURCES),
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
  if (!SUPPORTED_SOURCES[source]) {
    res.status(200).json({
      success: false,
      meta,
      error: new FetchPostsError('Not supported'),
    });
    return;
  }
  const SocialNetworkClass = SUPPORTED_SOURCES[source];
  const implementationInstance = new SocialNetworkClass([req.query.client_id]);
  try {
    const posts = await implementationInstance.getPostsByIds(ids);
    res.status(200).json({ success: true, meta, posts });
  } catch (error) {
    res.status(200).json({ success: false, meta, error });
  }
});

module.exports = router;
