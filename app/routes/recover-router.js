/* eslint-disable new-cap, prefer-destructuring */
const router = require('express').Router({ strict: true });
const logger = require('winston').loggers.get('controller-logger');
const querystring = require('querystring');

const RedisKeys = require('../redis-keys');
const RedisClient = require('sweetwork-redis-client');
const config = require('../config');
const utils = require('../utils');

const cli = new RedisClient(
  config.get('REDIS:host'),
  config.get('REDIS:port'),
  config.get('REDIS:db'),
);

router.get('/', async (req, res) => {
  logger.info(`POST /api/v1/recover?${querystring.encode(req.query)}`);
  const meta = {
    available_query_parameters: {
      client_id: {
        type: 'mandatory',
      },
    },
  };
  if (!req.query.client_id) {
    res.status(200).json({
      success: false,
      meta,
      error: new Error('Missing client_id in query'),
    });
    return;
  }
  const connection = await utils.startConnection();
  // FIXME this table does not exist - this is legacy code
  const q =
    'SELECT id,platform_username,platform_id,identity,secret,client_id ' +
    `FROM platforms_accounts WHERE client_id=${req.query.client_id};`;
  connection.query(q, async (err, rows) => {
    try {
      if (err) throw err;
      //
      const promises = [];
      rows.forEach(account => {
        // copy account row to Redis
        const key = RedisKeys.socialAccountsTokens(
          account.platform_id,
          account.id,
        );
        const hash = {
          id: account.id,
          username: account.platform_username,
          access_token: account.identity,
          access_token_secret: account.secret || '',
        };
        promises.push(cli.hmset({ key, hash }));
        // add account to circular set
        utils.ENDPOINT_NAMES[account.platform_id].forEach(endpointName => {
          const circularKey = RedisKeys.circularSortedSetAccounts(
            account.platform_id,
            endpointName,
            account.client_id,
          );
          promises.push(cli.zadd({ key: circularKey, scomembers: [10, key] }));
        });
      });
      //
      await Promise.all(promises);
      res.status(200).json({
        success: true,
        message: `Recovered ${rows.length} accounts`,
      });
    } catch (error) {
      res
        .status(200)
        .json({ success: false, error, where: 'caught-exception' });
    }
  }); // end sql connection
});

module.exports = router;
