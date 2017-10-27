/* eslint-disable no-underscore-dangle, no-param-reassign, no-nested-ternary, arrow-body-style, prefer-destructuring */
const moment = require('moment-timezone');
const Twitter = require('twitter');
const Q = require('q');

const FetchSearchError = require('../utils').FetchSearchError;
const FetchSearchWarning = require('../utils').FetchSearchWarning;
const FetchAuthorError = require('../utils').FetchAuthorError;
const FetchPostsError = require('../utils').FetchPostsError;
const logger = require('winston').loggers.get('controller-logger');
const Iterator = require('sweetwork-utils').CircularSortedSetIterator;
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

const CONSUMER_KEY = config.get('TWITTER:consumer_key');
const CONSUMER_SECRET = config.get('TWITTER:consumer_secret');
const PAGE_SIZE = 100;
const MAX_NUM_POSTS = 3000;
const ISO_DATE_TIME_FORMAT = 'ddd MMM DD HH:mm:ss ZZ YYYY';

let tw;

class TwitterManager extends APIManager {
  constructor(clientIds) {
    super();
    this.trimmedPosts = [];
    this.clientIds = clientIds;
  }

  _getAccount() {
    const that = this;
    return new Promise((resolve, reject) => {
      this.iterator.next(hash => {
        if (hash.value === undefined) {
          reject();
          return;
        }
        logger.info(`Got ${hash.value.username}'s account`);
        that.accountKey = hash.key;
        tw = new Twitter({
          consumer_key: CONSUMER_KEY,
          consumer_secret: CONSUMER_SECRET,
          access_token_key: hash.value.access_token_key,
          access_token_secret: hash.value.access_token_secret,
        });
        resolve();
      });
    });
  }
  _addTrimmedTweetData(tweets) {
    tweets.forEach(tweet => {
      this.trimmedPosts.push({
        post_id: tweet.id,
        created_at_ms: moment(tweet.created_at, ISO_DATE_TIME_FORMAT).valueOf(),
        type: tweet.in_reply_to_user_id_str
          ? 'tweet_reply'
          : tweet.retweeted_status ? 'tweet_retweet' : 'tweet_tweet',
      });
    });
  }
  _getEndpointName(method) {
    this.endpointName = this.getNormalizedEndpointName(method);
    // if (!this.endpointName) {
    //     switch (method) {
    //     case 'getSocialByRT':
    //         this.endpointName = 'socialByRT';
    //         break;
    //     default:
    //         throw new Error(`Method ${method} not supported`);
    //     }
    // }
    return this.endpointName;
  }
  getTrimmedPostData() {
    return this.trimmedPosts;
  }
  _logExternalRequest() {
    const unixNow = moment().unix();
    const key = RedisKeys.externalRequestsTicks(
      'twitter',
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
  _preFetch(method) {
    const that = this;
    return new Promise(resolve => {
      that.method = method;
      that.endpointName = that._getEndpointName(method);
      utils
        .guessWhichClientHasMoreAccounts(
          'twitter',
          that.endpointName,
          that.clientIds,
        )
        .then(clientId => {
          that.clientId = clientId;
          that.iterator = new Iterator(
            RedisKeys.circularSortedSetAccounts(
              'twitter',
              this.endpointName,
              this.clientId,
            ),
            config.get('REDIS:host'),
            config.get('REDIS:port'),
            config.get('REDIS:db'),
          );
          resolve();
        });
    });
  }
  _call(
    url,
    params,
    timestampFrom,
    timestampTo,
    enQueuePosts,
    deferred,
    tweetsCb,
  ) {
    const that = this;
    //
    that._logExternalRequest();
    //
    tw.get(url, params, (error, tweets, response) => {
      if (error) {
        if (error[0] && error[0].code === 88) {
          // Rate limit
          logger.info('Got a Rate limit');
          that.iterator.dispose(
            {
              key: that.accountKey,
              ts: response.headers['x-rate-limit-reset'],
            },
            () => {
              that._getAccount().then(
                () => {
                  that._call(
                    url,
                    params,
                    timestampFrom,
                    timestampTo,
                    enQueuePosts,
                    deferred,
                    tweetsCb,
                  );
                },
                () => {
                  deferred.reject(
                    new FetchSearchError(
                      'Got an Rate limit, no more available account',
                      that.clientId,
                    ),
                  );
                },
              );
            },
          );
        } else if (error[0] && error[0].code === 32) {
          // Could not authenticate you
          logger.info('Got an Authentication error');
          that.iterator.dispose(
            {
              key: that.accountKey,
              ts: moment()
                .add(1, 'hour')
                .unix(),
            },
            () => {
              that._getAccount().then(
                () => {
                  that._call(
                    url,
                    params,
                    timestampFrom,
                    timestampTo,
                    enQueuePosts,
                    deferred,
                    tweetsCb,
                  );
                },
                () => {
                  deferred.reject(
                    new FetchSearchError(
                      'Got an Authentication error, no more available account',
                      that.clientId,
                    ),
                  );
                },
              );
            },
          );
        } else {
          deferred.reject(
            new FetchSearchError(
              `Unhandled error from method API ${error}`,
              that.clientId,
            ),
          );
        }
        return;
      }
      if (params.q) {
        logger.info(
          `TW:search:${params.q}, ${response.headers[
            'x-rate-limit-remaining'
          ]}/` +
            `${response.headers['x-rate-limit-limit']} remaining API calls`,
        );
      } else if (params.user_id) {
        logger.info(
          `TW:search:${params.user_id}, ${response.headers[
            'x-rate-limit-remaining'
          ]}/` +
            `${response.headers['x-rate-limit-limit']} remaining API calls`,
        );
      }
      let matchingTweets = [];
      tweets = tweetsCb(response);
      if (tweets && tweets.length > 0) {
        matchingTweets = tweets.filter(x => {
          const ct = moment(x.created_at, ISO_DATE_TIME_FORMAT).unix();
          return timestampFrom < ct && timestampTo > ct;
        });
      }
      if (matchingTweets.length === 0) {
        deferred.resolve(that.getTrimmedPostData());
      } else {
        that._addTrimmedTweetData(matchingTweets);
        enQueuePosts(matchingTweets);
        if (
          that.getTrimmedPostData().length <= MAX_NUM_POSTS &&
          matchingTweets[matchingTweets.length - 1].id ===
            tweets[tweets.length - 1].id &&
          tweets.length === PAGE_SIZE
        ) {
          params.max_id = tweets[tweets.length - 1].id;
          that._call(
            url,
            params,
            timestampFrom,
            timestampTo,
            enQueuePosts,
            deferred,
            tweetsCb,
          );
        } else {
          const id = params.q ? params.q : params.user_id;
          logger.info(
            `TW:search:${id}, found ${that.getTrimmedPostData().length} tweets`,
          );
          if (that.getTrimmedPostData().length > MAX_NUM_POSTS) {
            deferred.reject(
              new FetchSearchWarning(
                `Limiting to ~ ${MAX_NUM_POSTS} purposefully`,
                that.clientId,
              ),
            );
          } else deferred.resolve(that.getTrimmedPostData());
        }
      }
    });
    return deferred.promise;
  }
  getPostsByTag(tag, timestampFrom, timestampTo, enQueuePosts) {
    const that = this;
    const deferred = Q.defer();
    const defaultParams = {
      count: PAGE_SIZE,
      result_type: 'recent',
      q: tag,
    };
    const pathUrl = 'search/tweets';
    return new Promise((resolve, reject) => {
      that._preFetch('getPostsByTag').then(() => {
        that._getAccount().then(
          () => {
            that
              ._call(
                pathUrl,
                defaultParams,
                timestampFrom,
                timestampTo,
                enQueuePosts,
                deferred,
                response => JSON.parse(response.body).statuses,
              )
              .then(data => resolve(data), e => reject(e));
          },
          () => {
            // simply nothing in range
            reject(
              new FetchSearchError('No more available accounts', that.clientId),
            );
          },
        );
      });
    });
  }
  getPostsByAuthor(authorId, timestampFrom, timestampTo, enQueuePosts) {
    const that = this;
    const deferred = Q.defer();
    const defaultParams = {
      count: PAGE_SIZE,
      user_id: authorId,
      include_rts: true,
    };
    const pathUrl = 'statuses/user_timeline';
    return new Promise((resolve, reject) => {
      that._preFetch('getPostsByAuthor').then(() => {
        that._getAccount().then(
          () => {
            that
              ._call(
                pathUrl,
                defaultParams,
                timestampFrom,
                timestampTo,
                enQueuePosts,
                deferred,
                response => JSON.parse(response.body),
              )
              .then(data => resolve(data), e => reject(e));
          },
          () => {
            // simply nothing in range
            reject(
              new FetchSearchError('No more available accounts', that.clientId),
            );
          },
        );
      });
    });
  }
  getPostsByIds(tweetIds) {
    const that = this;
    const params = {
      id: tweetIds.join(','),
    };
    const pathUrl = 'statuses/lookup';
    return new Promise((resolve, reject) => {
      const handle = (error, tweets, response) => {
        //
        that._logExternalRequest();
        //
        if (error) {
          //
          if (error[0] && error[0].code === 88) {
            // Rate limit
            logger.info('Got a Rate limit');
            that.iterator.dispose(
              {
                key: that.accountKey,
                ts: response.headers['x-rate-limit-reset'],
              },
              () => {
                that._getAccount().then(
                  () => {
                    tw.get(pathUrl, params, handle);
                  },
                  () => {
                    reject(
                      new FetchPostsError(
                        'Got an Rate limit, no more available account',
                        that.clientId,
                      ),
                    );
                  },
                );
              },
            );
          } else if (error[0] && error[0].code === 32) {
            // Could not authenticate you
            logger.info('Got an Authentication error');
            that.iterator.dispose(
              {
                key: that.accountKey,
                ts: moment()
                  .add(1, 'hour')
                  .unix(),
              },
              () => {
                that._getAccount().then(
                  () => {
                    tw.get(pathUrl, params, handle);
                  },
                  () => {
                    reject(
                      new FetchPostsError(
                        'Got an Authentication error, no more available account',
                        that.clientId,
                      ),
                    );
                  },
                );
              },
            );
          } else {
            reject(
              new FetchPostsError(
                `Unhandled error from method API ${error}`,
                that.clientId,
              ),
            );
          }
          return;
        }
        //
        logger.info(
          `TW:posts:${params.id}, ${response.headers[
            'x-rate-limit-remaining'
          ]}/` +
            `${response.headers['x-rate-limit-limit']} remaining API calls`,
        );
        resolve([tweets]);
      };
      that._preFetch('getPostsByIds').then(() => {
        that._getAccount().then(
          () => {
            tw.get(pathUrl, params, handle);
          },
          () => {
            // simply nothing in range
            reject(
              new FetchPostsError('No more available accounts', that.clientId),
            );
          },
        );
      });
    });
  }
  getAuthorById(authorId) {
    const that = this;
    const params = {
      user_id: authorId,
    };
    const pathUrl = 'users/show';
    return new Promise((resolve, reject) => {
      const handle = (error, author, response) => {
        //
        that._logExternalRequest();
        //
        if (error) {
          //
          if (error[0] && error[0].code === 88) {
            // Rate limit
            logger.info('Got a Rate limit');
            that.iterator.dispose(
              {
                key: that.accountKey,
                ts: response.headers['x-rate-limit-reset'],
              },
              () => {
                that._getAccount().then(
                  () => {
                    tw.get(pathUrl, params, handle);
                  },
                  () => {
                    reject(
                      new FetchAuthorError(
                        'Got an Rate limit, no more available account',
                        that.clientId,
                      ),
                    );
                  },
                );
              },
            );
          } else if (error[0] && error[0].code === 32) {
            // Could not authenticate you
            logger.info('Got an Authentication error');
            that.iterator.dispose(
              {
                key: that.accountKey,
                ts: moment()
                  .add(1, 'hour')
                  .unix(),
              },
              () => {
                that._getAccount().then(
                  () => {
                    tw.get(pathUrl, params, handle);
                  },
                  () => {
                    reject(
                      new FetchAuthorError(
                        'Got an Authentication error, no more available account',
                        that.clientId,
                      ),
                    );
                  },
                );
              },
            );
          } else {
            reject(
              new FetchAuthorError(
                `Unhandled error from method API ${error}`,
                that.clientId,
              ),
            );
          }
          return;
        }
        //
        logger.info(
          `TW:author:${params.user_id}, ${response.headers[
            'x-rate-limit-remaining'
          ]}/` +
            `${response.headers['x-rate-limit-limit']} remaining API calls`,
        );
        resolve([author]);
      };
      that._preFetch('getPostsByAuthor').then(() => {
        that._getAccount().then(
          () => {
            tw.get(pathUrl, params, handle);
          },
          () => {
            // simply nothing in range
            reject(
              new FetchAuthorError('No more available accounts', that.clientId),
            );
          },
        );
      });
    });
  }
}

module.exports = TwitterManager;
