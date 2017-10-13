/* eslint-disable no-param-reassign, arrow-body-style, prefer-destructuring */

// 3rd party
const HTTP = require('q-io/http');
const querystring = require('querystring');
const bufferStream = require('q-io/buffer-stream');
// plugr
const authJWT = require('sweetwork-utils').authJWT;

class TopicsServiceRpc {
  constructor(host, port, passphrase) {
    if (!host) throw new Error('Missing host argument');
    if (!port) throw new Error('Missing port argument');
    this.host = `${host}:${port}`;
    this.headers = { 'Content-Type': 'application/json' };
    this.passphrase = passphrase;
  }

  auth(serviceName) {
    if (!serviceName) {
      return Promise.reject(new Error('Please provide a service name'));
    }
    const that = this;
    return new Promise((resolve, reject) => {
      authJWT(that.host, that.headers, serviceName, that.passphrase).then(
        token => {
          that.headers.Authorization = `Bearer ${token}`;
          that.failedAuth = null;
          resolve();
        },
        err => {
          that.failedAuth = serviceName;
          reject(err);
        },
      );
    });
  }

  updateFeedMeta(hash) {
    const that = this;
    function fn() {
      return new Promise((resolve, reject) => {
        HTTP.request({
          url: `${that.host}/api/v1/feeds`,
          method: 'POST',
          headers: that.headers,
          body: bufferStream(Buffer.from(JSON.stringify(hash), 'utf8')),
        }).then(
          res => {
            res.body.read().then(body => {
              const response = JSON.parse(Buffer.from(body, 'utf8'));
              if (response.success) resolve();
              else reject(response.error);
            });
          },
          error => reject(error),
        );
      });
    }

    if (that.failedAuth) {
      return new Promise((resolve, reject) => {
        return that
          .auth(that.failedAuth)
          .then(
            () => fn().then(r => resolve(r), e => reject(e)),
            err => reject(err),
          );
      });
    }
    return fn();
  }
}

class TopicsRPC {
  constructor(host, port, passphrase) {
    if (!host) throw new Error('Missing host argument');
    if (!port) throw new Error('Missing port argument');
    this.host = `${host}:${port}`;
    this.headers = { 'Content-Type': 'application/json' };
    this.passphrase = passphrase;
  }

  auth(serviceName) {
    if (!serviceName) {
      return Promise.reject(new Error('Please provide a service name'));
    }
    const that = this;
    return new Promise((resolve, reject) => {
      authJWT(that.host, that.headers, serviceName, that.passphrase).then(
        token => {
          that.headers.Authorization = `Bearer ${token}`;
          that.failedAuth = null;
          resolve();
        },
        err => {
          that.failedAuth = serviceName;
          reject(err);
        },
      );
    });
  }

  read(opt) {
    // const SUPPORTED_FIELDS = ['client_id', 'topic_ids', 'without_feeds'];
    const that = this;
    if (Array.isArray(opt.topic_ids)) opt.topic_ids = opt.topic_ids.join(',');
    const queryParams = querystring.stringify(opt, '&', '=', {
      encodeURIComponent: querystring.unescape,
    });
    function fn() {
      return new Promise((resolve, reject) => {
        HTTP.request({
          url: `${that.host}/api/v1/topics?${queryParams}`,
          method: 'GET',
          headers: that.headers,
        }).then(
          res => {
            res.body.read().then(body => {
              const response = JSON.parse(Buffer.from(body, 'utf8'));
              if (response.success) resolve(response.topics);
              else reject(response.error);
            });
          },
          error => reject(error),
        );
      });
    }
    if (that.failedAuth) {
      return new Promise((resolve, reject) => {
        return that
          .auth(that.failedAuth)
          .then(
            () => fn().then(r => resolve(r), e => reject(e)),
            err => reject(err),
          );
      });
    }
    return fn();
  }

  create(topics) {
    topics = topics || [];
    const that = this;
    function fn() {
      return new Promise((resolve, reject) => {
        HTTP.request({
          url: `${that.host}/api/v1/topics`,
          method: 'POST',
          headers: that.headers,
          body: bufferStream(Buffer.from(JSON.stringify({ topics }), 'utf8')),
        }).then(
          res => {
            res.body.read().then(body => {
              const response = JSON.parse(Buffer.from(body, 'utf8'));
              if (response.success) resolve(response.num_topics);
              else reject(response.error);
            });
          },
          error => reject(error),
        );
      });
    }

    if (that.failedAuth) {
      return new Promise((resolve, reject) => {
        return that
          .auth(that.failedAuth)
          .then(
            () => fn().then(r => resolve(r), e => reject(e)),
            err => reject(err),
          );
      });
    }
    return fn();
  }

  update(topics) {
    return this.create(topics);
  }

  delete(topicId) {
    const that = this;
    function fn() {
      return new Promise((resolve, reject) => {
        HTTP.request({
          url: `${that.host}/api/v1/topics/${topicId}`,
          method: 'DELETE',
          headers: that.headers,
        }).then(
          res => {
            res.body.read().then(body => {
              const response = JSON.parse(Buffer.from(body, 'utf8'));
              if (response.success) resolve();
              else reject(response.error);
            });
          },
          error => reject(error),
        );
      });
    }

    if (that.failedAuth) {
      return new Promise((resolve, reject) => {
        return that
          .auth(that.failedAuth)
          .then(
            () => fn().then(r => resolve(r), e => reject(e)),
            err => reject(err),
          );
      });
    }
    return fn();
  }
}

module.exports.TopicsServiceRpc = TopicsServiceRpc;
module.exports.TopicsRPC = TopicsRPC;
