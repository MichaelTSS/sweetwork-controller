const nconf = require('nconf');
const path = require('path');

nconf
  .argv()
  .env(['PORT', 'NODE_ENV', 'NODE_PREFIX'])
  // Override with current environment (ex production) if exists
  .add('environment', {
    type: 'file',
    file: path.join(__dirname, 'dev.json'),
  })
  .defaults({
    PORT: 8082,
    REDIS_DB: 9,
    APP_DIR: __dirname,
    BASE_DIR: __dirname.replace('/app', ''),
  });

module.exports = nconf;
