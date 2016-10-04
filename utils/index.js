'use strict';
const _ = require('underscore'),
  CronJob = require('cron').CronJob,
  mailUtil = require('./mail'),
  redisUtil = require('./redis');


exports.pad = (num, size) => {
  let s = num + "";
  while (s.length < size) s = "0" + s;
  return s;
}

exports.logBitunnelError = error => {
  error = {
      errorMessage: `BitunnelJobQueueError: ${JSON.stringify(error)}`,
      body: error,
      source: "BitunnelJobQueueHandler"
    }
    //send ds over the wire using ...
  console.error(error);
  // send to slack
  redisUtil.getRecipientUserIds()
    .then((userIds) => {
      return redisUtil.getUserNameEmails(userIds);
    })
    .then((users) => {
      return mailUtil.sendMail(users, error);
    })
    .then((info) => {
      console.info(`Mail sent: ${info.response}`);
    })
    .catch((err) => {
      console.error(`An error occured, ${err}`);
    })
}

exports.generateError = (seqNo, error) => {
  return { error: error, lastSeqNo: seqNo };
}

exports.constructMdPayload = (object, headers, url) => {
  headers = _.extend({
    "Content-Type": "application/json",
    "Accept": "application/json"
  }, headers);

  return {
    url: url,
    method: 'POST',
    headers: headers,
    body: object,
    json: true,
    strictSSL: false,
  }
}

exports.startJob = cronPattern => {
  try {
    let bJob = new CronJob({
      cronTime: cronPattern,
      onTick: onRun,
      start: true
    });
  } catch (ex) {
    utils.logBitunnelError(`error in job ${ex}`);
  }
}
