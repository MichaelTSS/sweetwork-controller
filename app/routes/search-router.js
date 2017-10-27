/* eslint-disable new-cap, no-param-reassign, prefer-destructuring */
const moment = require('moment-timezone');
const router = require('express').Router({ strict: true });

const config = require('../config');
const enQueue = require('../utils').enQueue;
const FetchSearchError = require('../utils').FetchSearchError;
const logger = require('winston').loggers.get('controller-logger');
const TopicsServiceRpc = require('../connectors/scheduler').TopicsServiceRpc;
const InstagramManager = require('../models/instagram-manager');
const TwitterManager = require('../models/twitter-manager');
const FacebookManager = require('../models/facebook-manager');
const GoogleNewsManager = require('../models/googlenews-manager');
const RssManager = require('../models/rss-manager');
// FIXME
const topicsSvcRpc = new TopicsServiceRpc(
  config.get('SVC_SCHEDULER:host'),
  config.get('SVC_SCHEDULER:port'),
  config.get('SVC_SCHEDULER:passphrase'),
);
const SUPPORTED_SOURCES = {
  instagram: InstagramManager,
  twitter: TwitterManager,
  facebook: FacebookManager,
  rss: RssManager,
  googlenews: GoogleNewsManager,
};

router.post('/', async (req, res) => {
  logger.info(
    `Was requested to search posts ${req.body.source}:${req.body.id}`,
  );
  // Request defaults
  req.body.timestamp_from = req.body.timestamp_from || 0; // 0 = fetches all the way back
  req.body.timestamp_to = req.body.timestamp_to || moment().unix(); // fetches up until now
  const source = req.body.source;
  const entity = req.body.entity;
  const clientIds = Object.keys(req.body.topic_hash);
  if (!SUPPORTED_SOURCES[source]) {
    const error = new FetchSearchError(`Source ${source} not supported`);
    res.status(200).json({ success: false, error });
    return;
  }
  const SocialNetworkClass = SUPPORTED_SOURCES[source];
  const implementationInstance = new SocialNetworkClass(clientIds);
  const params = [
    req.body.id,
    req.body.timestamp_from,
    req.body.timestamp_to,
    enQueue.bind(null, req.body.source, req.body.topic_hash),
  ];
  //
  try {
    let trimmedPosts = [];
    if (entity === 'result') {
      res.status(200).json({ success: true });
      trimmedPosts = await implementationInstance.getPostsByTag(...params);
    } else if (entity === 'author') {
      res.status(200).json({ success: true });
      trimmedPosts = await implementationInstance.getPostsByAuthor(...params);
    } else {
      const error = new FetchSearchError(`Entity ${entity} not supported`);
      res.status(200).json({ success: false, error });
      return;
    }
    // we are doing some work here after all the crawling is done
    logger.info('Successfully finished crawling');
    let timestampFrom = req.body.timestamp_from;
    if (!timestampFrom && trimmedPosts.length > 0) {
      timestampFrom = Math.round(
        parseInt(trimmedPosts[trimmedPosts.length - 1].created_at_ms, 10) /
          1000,
      );
    } else if (!timestampFrom) {
      timestampFrom = 0;
    }
    logger.info(
      JSON.stringify({
        id: req.body.id,
        source: req.body.source,
        entity: req.body.entity,
        timestamp_from: timestampFrom,
        timestamp_to: req.body.timestamp_to,
        num_results: trimmedPosts.length || 0,
        ticks: '[list of timestamps]',
      }),
    );
    try {
      await topicsSvcRpc.auth('controller-service');
      await topicsSvcRpc.updateFeedMeta({
        id: req.body.id,
        source: req.body.source,
        entity: req.body.entity,
        timestamp_from: timestampFrom,
        timestamp_to: req.body.timestamp_to,
        num_results: trimmedPosts.length || 0,
        ticks: trimmedPosts.map(x => x.created_at_ms),
      });
    } catch (e) {
      logger.error(
        `Caught an exception while talking to Scheduler Service: ${JSON.stringify(
          e,
        )}`,
      );
    }
    //
  } catch (error) {
    logger.error(
      `Caught an exception while crawling: ${JSON.stringify(error)}`,
    );
    const trimmedPosts = implementationInstance.getTrimmedPostData();
    let timestampFrom = req.body.timestamp_from;
    if (!timestampFrom && trimmedPosts.length > 0) {
      timestampFrom = Math.round(
        parseInt(trimmedPosts[trimmedPosts.length - 1].created_at_ms, 10) /
          1000,
      );
    } else if (!timestampFrom) {
      timestampFrom = 0;
    }
    try {
      await topicsSvcRpc.auth('controller-service');
      const numResults = Array.isArray(trimmedPosts) ? trimmedPosts.length : 0;
      const ticks =
        Array.isArray(trimmedPosts) && trimmedPosts.length
          ? trimmedPosts.map(x => x.created_at_ms)
          : [];
      const updateParams = {
        id: req.body.id,
        source: req.body.source,
        entity: req.body.entity,
        timestamp_from: timestampFrom,
        timestamp_to: req.body.timestamp_to,
        num_results: numResults,
        ticks,
        error,
      };
      await topicsSvcRpc.updateFeedMeta(updateParams);
    } catch (e) {
      logger.error(
        `Caught an exception while talking to Scheduler Service: ${JSON.stringify(
          e,
        )}`,
      );
    }
  }
});

module.exports = router;
