'use strict';
const redis = require('redis');

const redisClient = redis.createClient(
  process.env.REDIS_PORT || 'localhost', process.env.REDIS_MASTER || '6379'
)

exports.getLastFetchedNo = () => {
  return new Promise((res, rej) => {
    redisClient.get('bitunnel-jobq:last-used-no', (err, r) => {
      if (err) rej(err);
      res(r);
    });
  });
}

exports.setLastFetchedNo = (no) => {
  return new Promise((res, rej) => {
    redisClient.set('bitunnel-jobq:last-used-no', no, (err, r) => {
      if (err) rej(err);
      res(r);
    });
  });
}

exports.getCronPattern = () => {
  return new Promise((res, rej) => {
    redisClient.get('bitunnel-jobq:cronPattern', (err, data) => {
      if (err) rej(err);
      res(data);
    })
  })
}
