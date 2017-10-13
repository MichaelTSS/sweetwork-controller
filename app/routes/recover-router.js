/* eslint-disable new-cap, prefer-destructuring */
const router = require('express').Router({ strict: true });
const logger = require('winston').loggers.get('controller-logger');
const mysql = require('mysql');

const RedisKeys = require('../redis-keys');
const RedisClient = require('sweetwork-redis-client');
const config = require('../config');

const cli = new RedisClient(
  config.get('REDIS:host'),
  config.get('REDIS:port'),
  config.get('REDIS:db'),
);
const ENDPOINT_NAMES = require('../utils').ENDPOINT_NAMES;

router.get('/', (req, res) => {
  logger.info(`GET /api/v1/recover ${JSON.stringify(req.query)}`);
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
  }
  const connection = mysql.createConnection({
    host: config.get('MYSQL:host'),
    user: config.get('MYSQL:user'),
    password: config.get('MYSQL:password'),
    database: config.get('MYSQL:database'),
    port: config.get('MYSQL:port'),
  });
  connection.connect();
  const q =
    'SELECT id,platform_username,platform_id,identity,secret,client_id ' +
    `FROM platforms_accounts WHERE client_id=${req.query.client_id};`;
  connection.query(q, (err, rows) => {
    const dList = [];
    try {
      rows.forEach(account => {
        const keyHash = RedisKeys.socialAccountsTokens(
          account.platform_id,
          account.id,
        );
        dList.push(
          cli.hmset({
            key: keyHash,
            hash: {
              id: account.id,
              username: account.platform_username,
              access_token: account.identity,
              access_token_secret: account.secret || '',
            },
          }),
        );
        ENDPOINT_NAMES[account.platform_id].forEach(endpointName => {
          const key = RedisKeys.circularSortedSetAccounts(
            account.platform_id,
            endpointName,
            account.client_id,
          );
          dList.push(cli.zadd({ key, scomembers: [10, keyHash] }));
        });
      });
      Promise.all(dList).then(
        () => {
          res.status(200).json({
            success: true,
            message: `Recovered ${rows.length} accounts`,
          });
        },
        error => {
          res
            .status(200)
            .json({ success: false, error, where: 'promise-rejection' });
        },
      );
    } catch (error) {
      res
        .status(200)
        .json({ success: false, error, where: 'caught-exception' });
    }
  });
  connection.end();
});

module.exports = router;
