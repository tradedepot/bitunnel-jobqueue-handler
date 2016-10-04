'use strict';
const redis = require('redis');

const redisClient = redis.createClient(
  process.env.REDIS_PORT || '6379', process.env.REDIS_MASTER || 'localhost'
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

exports.getRecipientUserIds = () => {
  return new Promise((res, rej) => {
    redisClient.smembers('bitunnel-admin-users', (err, r) => {
      if (err) rej(err);
      res(r);
    });
  });
}

exports.getUserNameEmails = (userIds) => {
  let result = [];
  _.each(userIds, (userId) => {
    let data = new Promise((res, rej) => {
      redisClient.hmget(userId, 'name', 'email', (err, data) => {
        if (err) rej(err);
        data = {
          name: data[0],
          email: data[1]
        }
        res(data);
      })
    });
    result.push(data);
  })

  return Promise.all(result);
}