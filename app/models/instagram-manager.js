/* eslint-disable no-underscore-dangle, prefer-destructuring */
const ig = require('instagram-node').instagram();
const _ = require('lodash');
const Q = require('q');
const moment = require('moment-timezone');

const FetchSearchError = require('../utils').FetchSearchError;
const FetchSearchWarning = require('../utils').FetchSearchWarning;
const FetchAuthorError = require('../utils').FetchAuthorError;
const FetchPostsError = require('../utils').FetchPostsError;
const logger = require('winston').loggers.get('controller-logger');
const APIManager = require('./api-manager');
const Iterator = require('sweetwork-utils').CircularSortedSetIterator;
const RedisClient = require('sweetwork-redis-client');
const RedisKeys = require('../redis-keys');
const config = require('../config');
const utils = require('../utils');

const cli = new RedisClient(
  config.get('REDIS:host'),
  config.get('REDIS:port'),
  config.get('REDIS:db'),
);
const MAX_NUM_POSTS = 3000;

class InstagramManager extends APIManager {
  constructor(clientIds) {
    super();
    this.trimmedPosts = [];
    this.clientIds = clientIds;
  }
  _getAccount() {
    const that = this;
    return new Promise((resolve, reject) => {
      this.iterator.next(hash => {
        if (hash.value !== undefined) {
          logger.info(`Got ${hash.value.username}'s account`);
          that.accountKey = hash.key;
          ig.use({ access_token: hash.value.access_token_key });
          resolve();
        }
        reject();
      });
    });
  }
  _addTrimmedMediaData(medias) {
    medias.forEach(media => {
      this.trimmedPosts.push({
        post_id: media.id,
        created_at_ms: moment.unix(media.created_time).valueOf(),
        type: media.type,
      });
    });
  }
  _getEndpointName(method) {
    return this.getNormalizedEndpointName(method);
  }
  _preFetch(method) {
    const that = this;
    return new Promise(resolve => {
      that.method = method;
      that.endpointName = that._getEndpointName(method);
      utils
        .guessWhichClientHasMoreAccounts(
          'instagram',
          that.endpointName,
          that.clientIds,
        )
        .then(clientId => {
          that.clientId = clientId;
          that.iterator = new Iterator(
            RedisKeys.circularSortedSetAccounts(
              'instagram',
              that.endpointName,
              that.clientId,
            ),
            config.get('REDIS:host'),
            config.get('REDIS:port'),
            config.get('REDIS:db'),
          );
          resolve();
        });
    });
  }
  _logExternalRequest() {
    const unixNow = moment().unix();
    const key = RedisKeys.externalRequestsTicks(
      'instagram',
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
  getTrimmedPostData() {
    return this.trimmedPosts;
  }
  getPostsByTag(tag, timestampFrom, timestampTo, enQueuePosts) {
    const deferred = Q.defer();
    const that = this;
    try {
      that._preFetch('getPostsByTag').then(() => {
        const handle = (error, medias, pagination, remaining, limit) => {
          //
          that._logExternalRequest();
          //
          if (error && error.status_code !== 200) {
            if (error.code === 429) {
              // Rate limit
              logger.info('Got a Rate limit');
              that.iterator.dispose({ key: that.accountKey }, () => {
                that._getAccount().then(
                  () => {
                    try {
                      ig.tag_media_recent(tag, {}, handle);
                    } catch (e) {
                      deferred.reject(e);
                    }
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
              });
            } else if (error.code === 400) {
              // OAuthAccessTokenException
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
                      try {
                        ig.tag_media_recent(tag, {}, handle);
                      } catch (e) {
                        deferred.reject(e);
                      }
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
          //
          logger.info(
            `IG:search:${tag} ${remaining}/${limit} remaining API calls`,
          );
          let matchingMedias = [];
          if (medias && medias.length > 0) {
            matchingMedias = medias.filter(x => {
              const ct = parseInt(x.created_time, 10);
              return timestampFrom < ct && timestampTo > ct;
            });
          }
          if (matchingMedias.length === 0) {
            // logger.info(`Found ${that.getTrimmedPostData().length} medias`);
            deferred.resolve(that.getTrimmedPostData());
          } else {
            that._addTrimmedMediaData(matchingMedias);
            // matchingMedias.forEach(x => enQueueSinglePost(x));
            enQueuePosts(matchingMedias);
            if (
              that.getTrimmedPostData().length <= MAX_NUM_POSTS &&
              matchingMedias.length + 10 > medias.length &&
              pagination.next
            ) {
              // this stupid API bug (https://groups.google.com/forum/#!topic/instagram-api-developers/zpA6XYHsPHo)
              // forces me to do some approximation matching
              // If 5+ out of 25 items are not a match, we ca assume we went over the timestamp_from
              pagination.next(handle);
            } else {
              logger.info(
                `IG:search:${tag}, found ${that.getTrimmedPostData()
                  .length} medias`,
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
        };
        that._getAccount().then(
          () => {
            try {
              ig.tag_media_recent(tag, {}, handle);
            } catch (e) {
              deferred.reject(e);
            }
          },
          () => {
            // simply nothing in range
            deferred.reject(
              new FetchSearchError('No more available accounts', that.clientId),
            );
          },
        );
      });
    } catch (e) {
      deferred.reject(
        new FetchSearchError(`Unhandled error from method ${e}`, that.clientId),
      );
    }
    return deferred.promise;
  }
  getPostsByAuthor(authorId, timestampFrom, timestampTo, enQueuePosts) {
    const deferred = Q.defer();
    const that = this;
    try {
      that._preFetch('getPostsByAuthor').then(() => {
        const handle = (error, medias, pagination, remaining, limit) => {
          //
          that._logExternalRequest();
          //
          if (error && error.status_code !== 200) {
            logger.error(`Error: ${error.status_code}`);
            if (error.code === 429) {
              // Rate limit
              logger.info('Got a Rate limit');
              that.iterator.dispose({ key: that.accountKey }, () => {
                that._getAccount().then(
                  () => {
                    try {
                      ig.user_media_recent(
                        authorId,
                        {
                          min_timestamp: timestampFrom,
                          max_timestamp: timestampTo,
                        },
                        handle,
                      );
                    } catch (e) {
                      deferred.reject(e);
                    }
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
              });
            } else if (error.code === 400) {
              // OAuthAccessTokenException
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
                      try {
                        ig.user_media_recent(
                          authorId,
                          {
                            min_timestamp: timestampFrom,
                            max_timestamp: timestampTo,
                          },
                          handle,
                        );
                      } catch (e) {
                        deferred.reject(e);
                      }
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
            //
            logger.info(
              `IG:search:${authorId} ${remaining}/${limit} remaining API calls`,
            );
            return;
          }
          let matchingMedias = [];
          if (medias && medias.length > 0) {
            matchingMedias = medias.filter(x => {
              const ct = parseInt(x.created_time, 10);
              return timestampFrom < ct && timestampTo > ct;
            });
          }
          if (matchingMedias.length === 0) {
            logger.info(`Found ${that.getTrimmedPostData().length} medias`);
            deferred.resolve(that.getTrimmedPostData());
          } else {
            that._addTrimmedMediaData(matchingMedias);
            // matchingMedias.forEach(x => enQueueSinglePost(x));
            enQueuePosts(matchingMedias);
            if (
              that.getTrimmedPostData().length <= MAX_NUM_POSTS &&
              matchingMedias[matchingMedias.length - 1].id ===
                medias[medias.length - 1].id &&
              pagination.next
            ) {
              // Here though, there is no such problem and items are properly sorted by date
              pagination.next(handle);
            } else {
              logger.info(
                `IG:search:${authorId}, found ${that.getTrimmedPostData()
                  .length} medias`,
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
        };
        that._getAccount().then(
          () => {
            try {
              ig.user_media_recent(
                authorId,
                {
                  min_timestamp: timestampFrom,
                  max_timestamp: timestampTo,
                },
                handle,
              );
            } catch (e) {
              deferred.reject(e);
            }
          },
          () => {
            // simply nothing in range
            deferred.reject(
              new FetchSearchError('No more available account', that.clientId),
            );
          },
        );
      });
    } catch (e) {
      deferred.reject(
        new FetchSearchError(`Unhandled error from method ${e}`, that.clientId),
      );
    }
    return deferred.promise;
  }
  getPostsByIds(mediaIds) {
    const that = this;
    if (Array.isArray(mediaIds) && mediaIds.length > 1) {
      // logger.warn('IG:getPostsByIds method cannot get more than one mediaId at a time, consuming');
      return new Promise(resolve => {
        const dList = [];
        mediaIds.forEach(mediaId => {
          dList.push(
            new Promise(rslv => {
              that
                .getPostsByIds([mediaId])
                .then(medias => rslv(medias[0]), () => rslv(null));
            }),
          );
        });
        Promise.all(dList).then(medias => resolve(_.flatten(medias)));
      });
    }
    const mediaId = mediaIds[0];
    return new Promise((resolve, reject) => {
      that._preFetch('getPostsByIds').then(() => {
        const handle = (error, media, remaining, limit) => {
          //
          that._logExternalRequest();
          //
          if (error && error.status_code !== 200) {
            logger.error(`Error: ${error.status_code}`);
            if (error.code === 429) {
              // Rate limit
              logger.info('Got a Rate limit');
              that.iterator.dispose({ key: that.accountKey }, () => {
                that._getAccount().then(
                  () => {
                    try {
                      ig.media(mediaId, handle);
                    } catch (e) {
                      reject(e);
                    }
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
              });
            } else if (error.code === 400) {
              // OAuthAccessTokenException
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
                      try {
                        ig.media(mediaId, handle);
                      } catch (e) {
                        reject(e);
                      }
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
            `IG:posts:${mediaId} ${remaining}/${limit} remaining API calls`,
          );
          resolve([media]);
        };
        that._getAccount().then(
          () => {
            try {
              ig.media(mediaId, handle);
            } catch (e) {
              reject(e);
            }
          },
          () => {
            // simply nothing in range
            reject(
              new FetchPostsError('No more available account', that.clientId),
            );
          },
        );
      });
    });
  }
  getAuthorById(authorId) {
    const that = this;
    return new Promise((resolve, reject) => {
      that._preFetch('getAuthorById').then(() => {
        const handle = (error, author, remaining, limit) => {
          //
          that._logExternalRequest();
          //
          if (error && error.status_code !== 200) {
            logger.error(`Error: ${error.status_code}`);
            if (error.code === 429) {
              // Rate limit
              logger.info('Got a Rate limit');
              that.iterator.dispose({ key: that.accountKey }, () => {
                that._getAccount().then(
                  () => {
                    try {
                      ig.user(authorId, handle);
                    } catch (e) {
                      reject(e);
                    }
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
              });
            } else if (error.code === 400) {
              // OAuthAccessTokenException
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
                      try {
                        ig.user(authorId, handle);
                      } catch (e) {
                        reject(e);
                      }
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
            `IG:author:${authorId} ${remaining}/${limit} remaining API calls`,
          );
          resolve([author]);
        };
        that._getAccount().then(
          () => {
            try {
              ig.user(authorId, handle);
            } catch (e) {
              reject(e);
            }
          },
          () => {
            // simply nothing in range
            reject(
              new FetchAuthorError('No more available account', that.clientId),
            );
          },
        );
      });
    });
  }
}

module.exports = InstagramManager;
