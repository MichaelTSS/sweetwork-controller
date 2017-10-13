/* eslint-disable no-underscore-dangle */
const moment = require('moment-timezone');
const Feed = require('rss-to-json');

const FetchSearchError = require('../utils').FetchSearchError;
const logger = require('winston').loggers.get('controller-logger');
const APIManager = require('./api-manager');
const RedisClient = require('sweetwork-redis-client');
const RedisKeys = require('../redis-keys');
const config = require('../config');
const utils = require('../utils');
const cli = new RedisClient(
  config.get('REDIS:host'),
  config.get('REDIS:port'),
  config.get('REDIS:db'),
);

class RssManager extends APIManager {
  constructor(clientIds) {
    super();
    this.clientIds = clientIds;
    this.trimmedPosts = [];
  }
  _addTrimmedPostData(posts) {
    posts.forEach(post => {
      this.trimmedPosts.push({
        post_id: post.id,
        created_at_ms: moment(post.created).valueOf(),
        type: post.type || 'rss_post',
      });
    });
  }
  getTrimmedPostData() {
    return this.trimmedPosts;
  }
  _getEndpointName(method) {
    return this.getNormalizedEndpointName(method);
  }
  _preFetch(method) {
    const that = this;
    return new Promise((resolve, reject) => {
      that._getEndpointName(method);
      that.endpointName = that._getEndpointName(method);
      that.clientId = utils.guessWhichClientHasMoreAccounts(
        'rss',
        that.endpointName,
        that.clientIds,
      );
      resolve();
    });
  }
  _logExternalRequest() {
    const unixNow = moment().unix();
    const key = RedisKeys.externalRequestsTicks(
      'rss',
      this.clientId,
      this.endpointName,
    );
    cli
      .sadd({
        key: RedisKeys.externalRequestsSet(),
        members: [key],
      })
      .catch(logger.error);
    cli
      .zadd({
        key,
        scomembers: [unixNow, String(unixNow)],
      })
      .catch(logger.error);
  }
  getPostsByUrl(url, timestampFrom, timestampTo, enQueuePosts) {
    const that = this;
    return new Promise((resolve, reject) => {
      that._preFetch('getPostsByUrl').then(
        () => {
          //
          that._logExternalRequest();
          //
          try {
            Feed.load(url, (err, rss) => {
              if (err) {
                logger.error(`Error: ${err.status_code}`);
                reject(err);
              }
              const posts = rss.items;
              let matchingPosts = [];
              if (posts && posts.length > 0) {
                matchingPosts = posts.filter(x => {
                  const ct = moment(x.created).unix();
                  return timestampFrom < ct && timestampTo > ct;
                });
              }
              if (matchingPosts.length === 0) {
                logger.info(`RSS:${url}, found 0 medias`);
                resolve(that.getTrimmedPostData());
              } else {
                that._addTrimmedPostData(matchingPosts);
                // matchingPosts.forEach(x => enQueueSinglePost(x));
                enQueuePosts(matchingPosts);
                logger.info(
                  `RSS:${url}, found ${that.getTrimmedPostData()
                    .length} medias`,
                );
                resolve(that.getTrimmedPostData());
              }
            });
          } catch (e) {
            logger.error(`Error: ${e}`);
            reject(e);
          }
        },
        e => {
          logger.error(`Error: ${e}`);
          reject(e);
        },
      );
    });
  }
  getPostById(tweetId, cb) {
    // TODO implement this function as ASYNC AND SYNC
    return new FetchSearchError('Not implemented', this.clientId);
  }
}

module.exports = RssManager;
