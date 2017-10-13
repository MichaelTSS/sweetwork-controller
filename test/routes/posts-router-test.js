/* eslint-disable prefer-arrow-callback, global-require, no-unused-expressions, func-names, prefer-destructuring */
const Q = require('q');
const expect = require('chai').expect;
const request = require('supertest');
const config = require('../../app/config');
const RedisKeys = require('../../app/redis-keys');
const RedisClient = require('sweetwork-redis-client');

config.set('REDIS:db', 1); // 1 is the test db index
const cli = new RedisClient(
  config.get('REDIS:host'),
  config.get('REDIS:port'),
  config.get('REDIS:db'),
);

describe('Fetch posts', function() {
  let app;
  let bearerToken;

  before(function(done) {
    app = require('../../app/');
    request(app)
      .post('/auth')
      .send({
        service: 'mocha',
        passphrase: config.get('SVC_CONTROLLER:jwt_passphrase'),
      })
      .expect('Content-Type', /json/)
      // .expect('Content-Length', '156')
      .expect(200)
      .end(function(err, res) {
        if (err) throw err;
        expect(res.body.success).to.equal(true);
        expect(res.body.token).to.be.ok;
        bearerToken = `Bearer ${res.body.token}`;
        done();
      });
  });

  it('GET /api/v1/posts', function(done) {
    // this is a signed call
    request(app)
      .post('/api/v1/search')
      .set('Authorization', bearerToken)
      .send({
        id: 'software',
        source: 'instagram',
        entity: 'result', // not supported
        topic_hash: {
          1: [18734], // key = clientId, value = list of topicIds
        },
      })
      .expect('Content-Type', /json/)
      // .expect('Content-Length', '16')
      .expect(200)
      .end(function(err, res) {
        if (err) throw err;
        expect(res.body.success).to.equal(true);
        done();
      });
  });

  describe('Clean Redis', function() {
    const SOURCES = ['twitter', 'instagram', 'googlenews', 'rss'];
    const CLIENT_IDS = [1];
    const ENDPOINT_NAMES = ['postsByAuthor', 'postsByTag', 'postsByUrl'];
    const listKeys = [RedisKeys.inboundRequestsByServiceName('mocha')];
    SOURCES.forEach(source => {
      CLIENT_IDS.forEach(clientId => {
        ENDPOINT_NAMES.forEach(endpointName => {
          listKeys.push(
            RedisKeys.externalRequestsTicks(source, clientId, endpointName),
          );
        });
      });
    });
    before(function(done) {
      const dList = [];
      listKeys.forEach(key => {
        cli.del({ key });
      });
      Q.all(dList).then(() => done());
    });

    it('should have no keys', function(done) {
      const dList = [];
      listKeys.forEach(key => {
        cli.zrangebyscore({ key });
      });
      Q.all(dList).then(results => {
        results.forEach(result => {
          expect(result).to.be.empty;
        });
        done();
      });
    });
  });
});
