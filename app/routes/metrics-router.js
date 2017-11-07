/* eslint-disable new-cap, no-param-reassign */
const moment = require('moment-timezone');
const querystring = require('querystring');
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

router.get('/', async (req, res) => {
  logger.info(`GET /api/v1/metrics?${querystring.encode(req.query)}`);
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
  try {
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
    //
    const keys = await cli.smembers({ key: RedisKeys.externalRequestsSet() });
    const promises = [];
    const hashList = [];
    const series = [];
    //
    keys.forEach(key => {
      // TODO temporary hack
      const k = key.split(':');
      const source = k[3];
      const clientId = k[5];
      const endpointName = k[7];
      if (sources.includes(source)) {
        if (!clientIds || clientIds.includes(clientId)) {
          const p = cli.zrangebyscore({
            key,
            withscores: false,
            limit: 10 ** 9,
            min: dateRangeMin,
          });
          hashList.push({ source, clientId, endpointName });
          promises.push(p);
        }
      }
    });
    //
    const rawSeries = await Promise.all(promises);
    rawSeries.forEach((serie, idx) => {
      const hash = hashList[idx];
      series.push({
        data: utils.groupTicksByInterval(serie, 'hour'),
        source: hash.source,
        name: `${hash.clientId}-${hash.source}:${hash.endpointName}`,
        clientId: hash.clientId,
        endpointName: hash.endpointName,
      });
    });
    res.status(200).json({
      success: true,
      metrics: {
        series,
        type: 'column',
        title: 'Number of external calls',
      },
      meta,
    });
  } catch (error) {
    logger.info(error);
    res.status(200).json({
      success: false,
      meta,
    });
  }
});

module.exports = router;
