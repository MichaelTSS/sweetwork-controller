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
  config.get('SVC_SCHEDULER:jwt_passphrase'),
);

router.post('/', (req, res) => {
  logger.info(
    `Was requested to search posts ${req.body.source}:${req.body.id}`,
  );
  // Request defaults
  req.body.timestamp_from = req.body.timestamp_from || 0; // 0 = fetches all the way back
  req.body.timestamp_to = req.body.timestamp_to || moment().unix(); // fetches up until now
  // if (['facebook', 'instagram', 'twitter', 'rss', 'googlenews'].indexOf(req.body.source) > -1) {
  let promise;
  let implementationInstance;
  const clientIds = Object.keys(req.body.topic_hash);
  if (req.body.source === 'facebook') {
    implementationInstance = new FacebookManager(clientIds);
    if (req.body.entity === 'result') {
      promise = new Promise((resolve, reject) =>
        reject(new FetchSearchError('Not supported')),
      );
    } else if (req.body.entity === 'author') {
      promise = implementationInstance.getPostsByAuthor(
        req.body.id,
        req.body.timestamp_from,
        req.body.timestamp_to,
        enQueue.bind(null, req.body.source, req.body.topic_hash),
      );
    }
  } else if (req.body.source === 'instagram') {
    implementationInstance = new InstagramManager(clientIds);
    if (req.body.entity === 'result') {
      promise = implementationInstance.getPostsByTag(
        req.body.id,
        req.body.timestamp_from,
        req.body.timestamp_to,
        enQueue.bind(null, req.body.source, req.body.topic_hash),
      );
    } else if (req.body.entity === 'author') {
      promise = implementationInstance.getPostsByAuthor(
        req.body.id,
        req.body.timestamp_from,
        req.body.timestamp_to,
        enQueue.bind(null, req.body.source, req.body.topic_hash),
      );
    }
  } else if (req.body.source === 'twitter') {
    implementationInstance = new TwitterManager(clientIds);
    if (req.body.entity === 'result') {
      promise = implementationInstance.getPostsByTag(
        req.body.id,
        req.body.timestamp_from,
        req.body.timestamp_to,
        enQueue.bind(null, req.body.source, req.body.topic_hash),
      );
    } else if (req.body.entity === 'author') {
      promise = implementationInstance.getPostsByAuthor(
        req.body.id,
        req.body.timestamp_from,
        req.body.timestamp_to,
        enQueue.bind(null, req.body.source, req.body.topic_hash),
      );
    }
  } else if (req.body.source === 'rss') {
    implementationInstance = new RssManager(clientIds);
    if (req.body.entity === 'author') {
      promise = implementationInstance.getPostsByUrl(
        req.body.id,
        req.body.timestamp_from,
        req.body.timestamp_to,
        enQueue.bind(null, req.body.source, req.body.topic_hash),
      );
    } else {
      promise = new Promise((resolve, reject) =>
        reject(new FetchSearchError('Not supported')),
      );
    }
  } else if (req.body.source === 'googlenews') {
    implementationInstance = new GoogleNewsManager(clientIds);
    if (req.body.entity === 'result') {
      promise = implementationInstance.getPostsByUrl(
        req.body.id,
        req.body.timestamp_from,
        req.body.timestamp_to,
        enQueue.bind(null, req.body.source, req.body.topic_hash),
      );
    } else {
      promise = new Promise((resolve, reject) =>
        reject(new FetchSearchError('Not supported')),
      );
    }
  } else {
    promise = new Promise((resolve, reject) =>
      reject(new FetchSearchError('Not supported')),
    );
  }
  promise.then(
    trimmedPosts => {
      try {
        let timestampFrom = req.body.timestamp_from;
        if (!timestampFrom && trimmedPosts.length > 0) {
          timestampFrom = Math.round(
            parseInt(trimmedPosts[trimmedPosts.length - 1].created_at_ms, 10) /
              1000,
          );
        } else if (!timestampFrom) {
          timestampFrom = 0;
        }
        topicsSvcRpc
          .auth('ApiService')
          .then(() => {
            topicsSvcRpc
              .updateFeedMeta({
                id: req.body.id,
                source: req.body.source,
                entity: req.body.entity,
                timestamp_from: timestampFrom,
                timestamp_to: req.body.timestamp_to,
                num_results: trimmedPosts.length || 0,
                ticks: trimmedPosts.map(x => x.created_at_ms),
              })
              .catch(err => {
                logger.error(`updateFeedMeta error: ${JSON.stringify(err)}`);
              });
          })
          .catch(err => {
            logger.error(`Auth error A: ${err}`);
          });
      } catch (e) {
        logger.error(`Uncaught error A: ${e}`);
      }
    },
    error => {
      try {
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
        logger.error(`Caught an exception: ${JSON.stringify(error)}`);
        topicsSvcRpc
          .auth('ApiService')
          .then(() => {
            topicsSvcRpc
              .updateFeedMeta({
                id: req.body.id,
                source: req.body.source,
                entity: req.body.entity,
                timestamp_from: timestampFrom,
                timestamp_to: req.body.timestamp_to,
                num_results: Array.isArray(trimmedPosts)
                  ? trimmedPosts.length
                  : 0,
                ticks:
                  Array.isArray(trimmedPosts) && trimmedPosts.length
                    ? trimmedPosts.map(x => x.created_at_ms)
                    : [],
                error,
              })
              .catch(err => {
                logger.error(`updateFeedMeta error: ${JSON.stringify(err)}`);
              });
          })
          .catch(err => {
            logger.error(`Auth error B: ${err}`);
          });
      } catch (e) {
        logger.error(`Uncaught error B: ${e}`);
      }
    },
  );
  res.status(200).json({ success: true });
});

module.exports = router;
