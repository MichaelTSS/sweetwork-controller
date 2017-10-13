const moment = require('moment-timezone');
const config = require('./config');
const logger = require('winston').loggers.get('controller-logger');

const awsConfig = config.get('AWS');
awsConfig.autoCreateMode = false; // to save up some calls since this case is handled below
// const SqsClient = require('sweetwork-aws-client').Sqs;

// const sqsClient = new SqsClient(awsConfig);
const Iterator = require('sweetwork-utils').CircularSortedSetIterator;
const RedisKeys = require('./redis-keys');

const ENDPOINT_NAMES = {
  facebook: ['searchByTag'],
  twitter: ['searchByTag', 'searchByAuthor', 'authorById', 'postsByIds'],
  instagram: ['searchByTag', 'searchByAuthor', 'authorById', 'postsByIds'],
  googlenews: ['postsByUrl'],
  rss: [],
  googleplus: [],
  youtube: [],
  linkedin: [],
};

const enQueue = (source, topicHash, posts) => {
  const sets = new Set();
  const clientIds = Object.keys(topicHash);
  const unixNow = moment().unix();
  clientIds.forEach(clientId => {
    const queueName = `results_queue_${clientId}`;
    const messages = [];
    posts.forEach(post => {
      messages.push({
        raw_data: post,
        client_id: clientId,
        topic_ids: topicHash[clientId],
        result_uid: null,
        platform_type: source,
        treatments: [],
        sent_at: unixNow,
      });
    });
    sets.add([queueName, messages]);
  });
  sets.forEach(set => {
    // if (process.env.NODE_ENV !== 'dev') {
    logger.info(
      `Pushing ${set[1].length} messages to queue ` +
        `${process.env.NODE_PREFIX || 'prefix'}_${set[0]} for topics ${set[1][0]
          .topic_ids}`,
    );
    // FIXME all messages disapear here
    // sqsClient.sendMessages(set[0], set[1], error => {
    //   if (error && error.code === 'AWS.SimpleQueueService.NonExistentQueue') {
    //     logger.warn(`Auto-creating queue ${set[0]}`);
    //     sqsClient.createQueue(set[0], () => {
    //       sqsClient.sendMessages(
    //         `results_qualifier_${set[1].client_id}`,
    //         set[1],
    //         logger.error,
    //       );
    //     });
    //   } else if (error && error.retryable) {
    //     sqsClient.sendMessage(
    //       `results_qualifier_${set[1].client_id}`,
    //       set[1],
    //       logger.error,
    //     );
    //   } else if (error) {
    //     logger.error(JSON.stringify(error));
    //   }
    // });
    // }
  });
};

class FetchSearchError {
  constructor(message, clientId) {
    this.name = 'Error';
    this.message = message;
    this.clientId = clientId || '*';
  }
}
class FetchSearchWarning {
  constructor(message, clientId) {
    this.name = 'Warning';
    this.message = message;
    this.clientId = clientId || '*';
  }
}
class FetchAuthorError {
  constructor(message, clientId) {
    this.name = 'Error';
    this.message = message;
    this.clientId = clientId || '*';
  }
}
class FetchPostsError {
  constructor(message, clientId) {
    this.name = 'Error';
    this.message = message;
    this.clientId = clientId || '*';
  }
}

const guessWhichClientHasMoreAccounts = (source, endpointName, clientIds) =>
  new Promise((resolve, reject) => {
    if (!Array.isArray(clientIds)) {
      reject(
        new TypeError(
          `clientIds should be an array, is ${JSON.stringify(
            clientIds,
          )} instead`,
        ),
      );
      return;
    }
    const dList = [];
    dList.push(
      new Promise(rslv => {
        clientIds.forEach(clientId => {
          const iterator = new Iterator(
            RedisKeys.circularSortedSetAccounts(source, endpointName, clientId),
            null,
            null,
            null,
          );
          iterator.hasNext(result => {
            if (result) rslv(clientId);
            else rslv();
          });
        });
      }),
    );
    Promise.all(dList).then(foundList => {
      if (foundList.length === clientIds.length || foundList.length === 0) {
        resolve(clientIds[Math.floor(Math.random() * clientIds.length)]);
      }
      resolve(foundList[Math.floor(Math.random() * foundList.length)]);
    });
  });

module.exports = {
  ENDPOINT_NAMES,
  enQueue,
  FetchSearchError,
  FetchSearchWarning,
  FetchAuthorError,
  FetchPostsError,
  guessWhichClientHasMoreAccounts,
};
