/* eslint-disable prefer-arrow-callback, global-require, no-unused-expressions, func-names, prefer-destructuring */
const expect = require('chai').expect;
const request = require('supertest');
const config = require('../../app/config');

config.set('REDIS:db', 1); // 1 is the test db index

describe('Auth middleware check', function() {
  let app;
  let bearerToken;
  before(function(done) {
    app = require('../../app/');
    done();
  });

  it('GET /ping', function(done) {
    request(app)
      .get('/ping')
      .expect('Content-Type', /json/)
      // .expect('Content-Length', '45')
      .expect(200)
      .end(function(err, res) {
        if (err) throw err;
        expect(res.body.success).to.equal(true);
        expect(res.body.message).to.equal('Controller Service pong');
        done();
      });
  });

  it('GET /auth fail (1)', function(done) {
    request(app)
      .post('/auth')
      .send({
        service: 'mocha',
        passphrase: 'invalid password',
      })
      .expect('Content-Type', /json/)
      // .expect('Content-Length', '104')
      .expect(401)
      .end(function(err, res) {
        if (err) throw err;
        expect(res.body.message).to.equal(
          'Controller Service Auth: wrong passphrase {"service":"mocha","passphrase":"invalid password"} vs. passphrase',
        );
        done();
      });
  });

  it('GET /auth fail (2)', function(done) {
    request(app)
      .post('/auth')
      .send({
        service: 'mocha',
      })
      .expect('Content-Type', /json/)
      // .expect('Content-Length', '70')
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expect(res.body.message).to.equal(
          'Controller Service Auth: passphrase body is required',
        );
        done();
      });
  });

  it('GET /auth', function(done) {
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

  it('GET /api/v1/metrics', function(done) {
    // this is a signed call
    // FIXME
    // const expectedSeries = [
    //   { data: [], name: 'twitter' },
    //   { data: [], name: 'instagram' },
    //   { data: [], name: 'googlenews' },
    //   { data: [], name: 'rss' },
    // ];
    request(app)
      .get('/api/v1/metrics')
      .set('Authorization', bearerToken)
      .expect('Content-Type', /json/)
      // .expect('Content-Length', '610')
      .expect(200)
      .end(function(err, res) {
        if (err) throw err;
        expect(res.body.success).to.equal(true);
        // FIXME
        // expect(res.body.metrics.series).to.deep.have.members(expectedSeries);
        expect(res.body.metrics.plotBands).to.be.empty;
        expect(res.body.metrics.plotLines).to.be.empty;
        done();
      });
  });
});
