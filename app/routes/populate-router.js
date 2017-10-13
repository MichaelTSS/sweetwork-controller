/* eslint-disable new-cap, prefer-destructuring */
const _ = require('lodash');
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

router.get('/', (req, res) => {
  logger.info(`GET /api/v1/populate ${JSON.stringify(req.query)}`);
  const clientId = req.query.client_id || 1;
  const hashSourcesAccounts = {
    twitter: [
      {
        id: '2278852602',
        username: 'Jindotoe',
        access_token_key: '2278852602-gHlmqPgUsqrD0mxRwO1ZEq8OlRkDm40eXXpsp0l',
        access_token_secret: 'tSbXC9R9B7xk1MsZDLcfw5ihoMT8CeFyrwOll4Bk3G3H7',
      },
      {
        id: '2598235316',
        username: 'jindemone',
        access_token_key: '2598235316-BB1igqxfv2FuHeAgjv5saQK0s9SA8afOgIngm2N',
        access_token_secret: 'A9XPVMWKlrG9LDErKWT1zOW1bxSK2e5J4ZBwKhhsH3AHt',
      },
      {
        id: '1875801060',
        username: 'Lolo_test_89',
        access_token_key: '1875801060-ezgMIYbWBawqsgurnQIZ6sa9SSJetyQ6cbvoaUx',
        access_token_secret: 'E1pNCdYJLSTTUQqMpC2cPevK6V3rcdLrmeUgdCOxXa5ln',
      },
      {
        id: '2814664034',
        username: 'JinscraTou',
        access_token_key: '2814664034-iDGUuUcIJ0Z9GJq2v96dSteYjsNkdIrVYesb4FA',
        access_token_secret: 'TaqmvOYf5907mIvNVs6v253UIy9tTGOyPa1TO7A8gxtqK',
      },
      {
        id: '3355148884',
        username: 't3_pa',
        access_token_key: '3355148884-I2tm0qIXqEtFyRqeohSsrQ0XskLpb9ELhAL74uH',
        access_token_secret: 'y0Ttjn0OyopzGTl7y0Ps2FiroQ1bdOkYwhTBH9Fj7yB78',
      },
      {
        id: '3355067691',
        username: 'PlugrT4',
        access_token_key: '3355067691-OUgmRF3GhWkpJsC7Inm4aFmGlfALs1ciKn3qpjp',
        access_token_secret: '0c2SDgZzpSoAfsJdz3daOwQGIIag3F5xeGM48RH9TsW4m',
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
  let numAccounts = 0;
  new Promise(resolve => {
    const dList = [];
    _.forEach(hashSourcesAccounts, (accountsList, source) => {
      _.forEach(ENDPOINT_NAMES[source], endpointName => {
        const key = RedisKeys.circularSortedSetAccounts(
          source,
          endpointName,
          clientId,
        );
        const scomembers = [];
        accountsList.forEach(accountHash => {
          const keyHash = RedisKeys.socialAccountsTokens(
            source,
            accountHash.id,
          );
          dList.push(cli.hmset({ key: keyHash, hash: accountHash }));
          scomembers.push(10, keyHash);
        });
        numAccounts += 1;
        dList.push(cli.zadd({ key, scomembers }));
      });
    });
    resolve(dList);
  }).then(dList => {
    Promise.all(dList).then(
      () => {
        res.status(200).json({
          success: true,
          message: `Populated ${numAccounts} accounts`,
        });
      },
      error => {
        res.status(200).json({ success: false, error });
      },
    );
  });
});

module.exports = router;
