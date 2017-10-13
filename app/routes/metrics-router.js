/* eslint-disable new-cap, no-param-reassign */
const async = require('async');
const moment = require('moment-timezone');
const router = require('express').Router({ strict: true });
const logger = require('winston').loggers.get('controller-logger');

const RedisKeys = require('../redis-keys');
const utils = require('sweetwork-utils');
const RedisClient = require('sweetwork-redis-client');
const config = require('../config');
// const utils = require('../utils');
const cli = new RedisClient(
  config.get('REDIS:host'),
  config.get('REDIS:port'),
  config.get('REDIS:db'),
);

const AVAILABLE_SOURCES = ['twitter', 'instagram', 'googlenews', 'rss'];
const AVAILABLE_INTERVALS = ['year', 'month', 'week', 'day', 'hour', 'minute'];
const AVAILABLE_DATE_RANGES = ['30', '7', '1', '-1'];

router.get('/', (req, res) => {
  logger.info(`GET /api/v1/metrics ${JSON.stringify(req.query)}`);
  const meta = {
    available_query_parameters: {
      sources: {
        type: 'optional',
        options: AVAILABLE_SOURCES,
        help: 'multiple values possible, separated by commas',
      },
      interval: {
        type: 'optional',
        options: AVAILABLE_INTERVALS,
        help: 'outputs granularity of series',
      },
      dateRange: {
        type: 'optional',
        options: AVAILABLE_DATE_RANGES,
        help: 'refines precision of series',
      },
      client_ids: {
        type: 'optional',
        help: 'multiple values possible, separated by commas',
      },
    },
  };
  let dateRangeMin;
  switch (req.query.dateRange) {
    case '30':
    case '7':
    case '1':
      dateRangeMin = moment()
        .subtract(req.query.dateRange, 'days')
        .unix();
      break;
    case '-1':
    default:
      dateRangeMin = '-inf';
      break;
  }
  const interval = req.query.interval ? req.query.interval : 'day';
  const sources = req.query.sources
    ? req.query.sources.split(',')
    : AVAILABLE_SOURCES;
  const clientIds = req.query.client_ids
    ? req.query.client_ids.split(',')
    : null;
  async.waterfall(
    [
      async.asyncify(() =>
        cli.smembers({ key: RedisKeys.externalRequestsSet() }),
      ),
      (keys, callback) => {
        const dList = [];
        const hashList = [];
        keys.forEach(key => {
          // const key = RedisKeys.externalRequestsTicks(source, clientId, endpointName);
          // TODO temporary hack
          const k = key.split(':');
          const source = k[3];
          const clientId = k[5];
          const endpointName = k[7];
          if (sources.includes(source)) {
            if (!clientIds || clientIds.includes(clientId)) {
              hashList.push({ source, clientId, endpointName });
              dList.push(
                cli
                  .zrangebyscore({
                    key,
                    withscores: false,
                    limit: 10 ** 9,
                    min: dateRangeMin,
                  })
                  .catch(logger.error),
              );
            }
          }
        });
        Promise.all(dList).then(
          series => {
            const h = [];
            series.forEach((s, idx) => {
              h.push({
                data: utils.groupTicksByInterval(s, interval),
                name: `${hashList[idx].clientId}-${hashList[idx]
                  .source}:${hashList[idx].endpointName}`,
                clientId: hashList[idx].clientId,
                endpointName: hashList[idx].endpointName,
              });
            });
            callback(null, h);
          },
          err => callback(err),
        );
      },
    ],
    (err, series) => {
      if (err) res.status(500).json({ success: false, meta });
      else
        res.status(200).json({
          success: true,
          metrics: {
            series,
            type: 'column',
            title: 'Number of external calls',
          },
          meta,
        });
    },
  );
  // cli.rangebyscore({ key: RedisKeys.feedsList(), withscores: false }).then(members => {
  //     members.forEach(member => {
  //         logger.info(`Members ${member}`);
  //         cli.hgetall({ key: member }).then(feedHash => {});
  //     });
  // });
  // res.status(200).json({ success: true, metrics: });
});

module.exports = router;
