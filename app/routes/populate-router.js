/* eslint-disable new-cap, prefer-destructuring */
const _ = require('lodash');
const querystring = require('querystring');
const router = require('express').Router({ strict: true });
const logger = require('winston').loggers.get('controller-logger');
const RedisKeys = require('../redis-keys');
const RedisClient = require('sweetwork-redis-client');
const config = require('../config');

const cli = new RedisClient(
  config.get('REDIS:host'),
  config.get('REDIS:port'),
  config.get('REDIS:db'),
);
const ENDPOINT_NAMES = require('../utils').ENDPOINT_NAMES;

router.get('/', async (req, res) => {
  logger.info(`GET /api/v1/populate?${querystring(req.query)}`);
  const clientId = req.query.client_id || 1;
  const hashSourcesAccounts = {
    twitter: [
      {
        id: '211433417',
        username: 'MichaelWebDev',
        access_token_key: '211433417-71pJFz37NBTmEt0UWlsJ5nKfV2KlWvRPLDTZztam',
        access_token_secret: 'cRFl2N2mot1Tdk736L9jYmny1776LN5kEsvPVtsKQGPQx',
      },
    ],
    instagram: [
      {
        id: '2159316732',
        username: 'Jindemone',
        access_token_key: '2159316732.081ef9c.39174ae358f2469ba3e09373fdab7317',
      },
      {
        id: '2176942925',
        username: 'Jindotoe',
        access_token_key: '2176942925.081ef9c.f1bdce6bcdb641b58f6a820afa0cac83',
      },
      {
        id: '237487350',
        username: 'Jintest3',
        access_token_key: '3355067691-OUgmRF3GhWkpJsC7Inm4aFmGlfALs1ciKn3qpjp',
        access_token_secret:
          '237487350.081ef9c.38b17b2ab0e648308765916d05f3dcc5',
      },
    ],
    facebook: [
      {
        id: '100007669303976',
        username: 'Erwan Latour',
        access_token:
          'EAAH4VUqgIoABAAZAZBC80YtGqN3EAcEWkgK2oITsx6FfwQTuGE4MhZBERVt6zmzR5N404fiDepAPBAfuZAM6kQTmhFX5GDzqa342Qyp8Eepd5lJDmwhOAqkpRIURybsdJVZAVOoH0aoBXnsAiS1JmGnJAc5rk6j1ZAAY1JLLKpuAZDZD',
      },
    ],
  };
  try {
    let numAccounts = 0;
    const promises = [];
    _.forEach(hashSourcesAccounts, (accountsList, source) => {
      _.forEach(ENDPOINT_NAMES[source], endpointName => {
        const key = RedisKeys.circularSortedSetAccounts(
          source,
          endpointName,
          clientId,
        );
        const scomembers = [];
        accountsList.forEach(accountHash => {
          // write account to Redis
          const keyHash = RedisKeys.socialAccountsTokens(
            source,
            accountHash.id,
          );
          promises.push(cli.hmset({ key: keyHash, hash: accountHash }));
          scomembers.push(10, keyHash);
          numAccounts += 1;
        });
        // add multiple accounts to circular set at once
        promises.push(cli.zadd({ key, scomembers }));
      });
    });
    await Promise.all(promises);
    res.status(200).json({
      success: true,
      message: `Populated ${numAccounts} accounts`,
    });
  } catch (e) {
    res
      .status(200)
      .json({ success: false, error: e, where: 'caught-exception' });
  }
});

module.exports = router;
