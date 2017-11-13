/* eslint-disable no-underscore-dangle, prefer-destructuring */
const moment = require('moment-timezone');
const Facebook = require('facebook-node-sdk');

const FetchSearchError = require('../utils').FetchSearchError;
const FetchSearchWarning = require('../utils').FetchSearchWarning;
const logger = require('winston').loggers.get('controller-logger');
const Iterator = require('sweetwork-utils').CircularSortedSetIterator;
const APIManager = require('./api-manager');
const RedisClient = require('sweetwork-redis-client');
const RedisKeys = require('../redis-keys');
const config = require('../config');
const utils = require('../utils');

// Handling errors
// https://developers.facebook.com/docs/graph-api/using-graph-api

const cli = new RedisClient(
  config.get('REDIS:host'),
  config.get('REDIS:port'),
  config.get('REDIS:db'),
);

const CONSUMER_KEY = config.get('FACEBOOK:consumer_key');
const CONSUMER_SECRET = config.get('FACEBOOK:consumer_secret');
const PAGE_SIZE = 25;
const MAX_NUM_POSTS = 500;
const ISO_DATE_TIME_FORMAT = moment.ISO_8601;

let fb;

// https://developers.facebook.com/docs/graph-api/using-graph-api

class FacebookManager extends APIManager {
  constructor(clientIds) {
    super();
    this.trimmedPosts = [];
    this.clientIds = clientIds;
    fb = new Facebook({
      appId: CONSUMER_KEY,
      secret: CONSUMER_SECRET,
    });
  }
  _getAccount() {
    return new Promise((resolve, reject) => {
      this.iterator.next(hash => {
        if (hash.value === undefined) {
          reject(
            new FetchSearchError('No more available accounts', this.clientId),
          );
          return;
        }
        logger.info(`Got ${hash.value.username}'s account`);
        this.accountKey = hash.key;
        this.access_token = hash.value.access_token;
        resolve();
      });
    });
  }
  _addTrimmedPostsData(posts) {
    posts.forEach(post => {
      this.trimmedPosts.push({
        post_id: post.id,
        created_at_ms: moment(
          post.created_time,
          ISO_DATE_TIME_FORMAT,
        ).valueOf(),
      });
    });
  }
  _getEndpointName(method) {
    return this.getNormalizedEndpointName(method);
  }
  getTrimmedPostData() {
    return this.trimmedPosts;
  }
  async _preFetch(method) {
    this.method = method;
    this.endpointName = this._getEndpointName(method);
    this.clientId = await utils.guessWhichClientHasMoreAccounts(
      'facebook',
      this.endpointName,
      this.clientIds,
    );
    this.iterator = new Iterator(
      RedisKeys.circularSortedSetAccounts(
        'facebook',
        this.endpointName,
        this.clientId,
      ),
      config.get('REDIS:host'),
      config.get('REDIS:port'),
      config.get('REDIS:db'),
    );
  }
  // _getPagesTalking(q, deferred) {
  //   return new Promise(resolve => {
  //     fb.api(
  //       '/search',
  //       'get',
  //       {
  //         q,
  //         type: 'page',
  //       },
  //       (err, res) => {
  //         console.log('res 1');
  //         console.log(res);
  //         if (err) deferred.reject(err);
  //         else deferred.resolve(res);
  //         // if (res.paging && res.paging.next) {
  //         //     graph.get(res.paging.next, (e, r) => {
  //         //         console.log('res 2');
  //         //         console.log(r);
  //         //     });
  //         // }
  //       },
  //     );
  //   });
  // }
  async _logExternalRequest() {
    try {
      const unixNow = moment().unix();
      const key = RedisKeys.externalRequestsTicks(
        'facebook',
        this.clientId,
        this.endpointName,
      );
      await cli.sadd({
        key: RedisKeys.externalRequestsSet(),
        members: [key],
      });
      await cli.zadd({
        key,
        scomembers: [unixNow, String(unixNow)],
      });
    } catch (e) {
      logger.error(e);
    }
  }
  // getPostsByTag(tag, timestampFrom, timestampTo, enQueuePosts) {
  //   const that = this;
  //   const deferred = Q.defer();
  //   return new Promise((resolve, reject) => {
  //     that._preFetch('getPostsByTag').then(
  //       () => {
  //         that._getAccount().then(() => {
  //           that
  //             ._getPagesTalkingAbout(tag, deferred)
  //             .then(data => resolve(data), e => reject(e));
  //         });
  //       },
  //       () => {
  //         reject(
  //           new FetchSearchError('No more available accounts', that.clientId),
  //         );
  //       },
  //     );
  //   });
  // }
  async getPostsByAuthor(authorId, timestampFrom, timestampTo, enQueuePosts) {
    const that = this;
    return new Promise(async (resolve, reject) => {
      try {
        await that._preFetch('getPostsByAuthor');
        await that._getAccount();
      } catch (e) {
        reject(e);
        return;
      }
      const handle = (err, res) => {
        // Marks a tick each time this source is requested to be crawled
        that._logExternalRequest();
        //
        if (
          err &&
          err.result &&
          err.result.error &&
          err.result.error.code === 190
        ) {
          // Could not authenticate you
          logger.error('Got an Authentication error');
          return Promise.reject(err);
        } else if (err) {
          logger.error(err);
          return Promise.reject(err);
        }
        let matchingPosts = [];
        if (res.data && res.data.length > 0) {
          matchingPosts = res.data.filter(x => {
            const ct = moment(x.created_time, ISO_DATE_TIME_FORMAT).unix();
            return timestampFrom < ct && timestampTo > ct;
          });
        }
        // logger.debug(`Found ${matchingPosts.length} posts`);
        if (matchingPosts.length === 0) {
          // no data found, end here
          return Promise.resolve();
        }
        that._addTrimmedPostsData(matchingPosts);
        enQueuePosts(matchingPosts);
        if (
          that.getTrimmedPostData().length <= MAX_NUM_POSTS &&
          matchingPosts.length === PAGE_SIZE &&
          (res.paging && res.paging.next)
        ) {
          // fetching next page
          return new Promise((innerResolve, innerReject) => {
            fb.api(
              res.paging.next.split('graph.facebook.com')[1],
              'get',
              {
                fields: ['message', 'link', 'place', 'created_time'],
                access_token: that.access_token,
                __paging_token: res.paging.next.split('__paging_token=')[1],
              },
              (error, response) =>
                handle(error, response).then(
                  () => innerResolve(),
                  e => innerReject(e),
                ),
            );
          });
        }
        // end of pagination
        logger.info(
          `FB:${authorId}, found ${that.getTrimmedPostData().length} posts`,
        );
        if (that.getTrimmedPostData().length > MAX_NUM_POSTS) {
          // manually throttled
          return Promise.reject(
            new FetchSearchWarning(
              `Limiting to ~ ${MAX_NUM_POSTS} purposefully`,
              that.clientId,
            ),
          );
        }
        return Promise.resolve();
      }; // end of handle function
      fb.api(
        `/v2.8/${authorId}/feed`,
        'get',
        {
          fields: ['message', 'link', 'place', 'created_time'],
          access_token: that.access_token,
        },
        (err, res) =>
          handle(err, res).then(
            () => resolve(that.getTrimmedPostData()),
            e => reject(e),
          ),
      );
    });
  }
  // getPostById(tweetId, cb) {
  //   // TODO implement this function as ASYNC AND SYNC
  // }
}

module.exports = FacebookManager;
