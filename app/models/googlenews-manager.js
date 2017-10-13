/* eslint-disable no-underscore-dangle, no-param-reassign, prefer-destructuring */
const querystring = require('querystring');
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

// http://i-tweak.blogspot.com/2013/10/google-news-search-parameters-missing.html

class GoogleNewsManager extends APIManager {
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
        type: post.type || 'googlenews_post',
      });
    });
  }
  _getEndpointName(method) {
    return this.getNormalizedEndpointName(method);
  }
  getTrimmedPostData() {
    return this.trimmedPosts;
  }
  _preFetch(method) {
    const that = this;
    return new Promise((resolve, reject) => {
      that.endpointName = that._getEndpointName(method);
      that.clientId = utils.guessWhichClientHasMoreAccounts(
        'googlenews',
        that.endpointName,
        that.clientIds,
      );
      resolve();
    });
  }
  _logExternalRequest() {
    const unixNow = moment().unix();
    const key = RedisKeys.externalRequestsTicks(
      'googlenews',
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
  getPostsByUrl(q, timestampFrom, timestampTo, enQueuePosts) {
    // const deferred = Q.defer();
    const that = this;
    return new Promise((resolve, reject) => {
      that._preFetch('getPostsByUrl').then(
        () => {
          that._logExternalRequest();
          //
          const queryUrl = {
            scoring: 'n', // by date
            num: 100, // page size
            output: 'rss',
            q,
          };
          const url = `https://news.google.com/news?${querystring.stringify(
            queryUrl,
          )}`;
          try {
            Feed.load(url, (err, rss) => {
              if (err) {
                logger.error(`Error: ${err}`);
                reject(err);
              }
              const posts = rss.items;
              let matchingPosts = [];
              if (posts && posts.length > 0) {
                matchingPosts = posts.slice(); // creates a copy of that array
              }
              if (matchingPosts.length === 0) {
                logger.info(`GN:${url}, found 0 medias`);
                resolve(that.getTrimmedPostData());
              } else {
                that._addTrimmedPostData(matchingPosts);
                // matchingPosts.forEach(x => enQueueSinglePost(x));
                enQueuePosts(matchingPosts);
                logger.info(
                  `GN:${url}, found ${that.getTrimmedPostData().length} medias`,
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

module.exports = GoogleNewsManager;
