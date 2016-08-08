"use strict";
const httpntlm = require('httpntlm'),
  _ = require('underscore'),
  request = require('request'),
  redisUtil = require('./utils/redis'),
  CronJob = require('cron').CronJob,
  utils = require('./utils');

let middlewareEventUrl = process.env.MIDDLEWARE_EVENT_URL || 'https://sandbox.tradedepot.io/core/v1/events';
//make ntlm request
const makeNtlmRequest = lastNo => {
  return new Promise((res, rej) => {
    let url = process.env.ODATA_JOBQ_URL || "http://52.4.6.204:4068/PROMASIDOR_NAV/OData/Company('PROMASIDOR%20Nigeria')/tdmiddlewarevent?$format=json";
    let nextNumber = parseInt(lastNo) + 100;

    // nextNumber = utils.pad(nextNumber, 8);

    url += `&$filter=No gt '${lastNo}'`;
    // url += `&$filter=No gt '${lastNo}' and No lt '${nextNumber}'`;

    console.log(url)

    httpntlm.get({
      url: url,
      username: process.env.ODATA_JOBQ_USER || 'Administrator',
      password: process.env.ODATA_JOBQ_PASS || 'Awnkm0akm?',
      workstation: null,
      domain: process.env.ODATA_JOBQ_DOMAIN || 'CORP'
    }, function(err, result) {
      if (err) rej(err);
      res(result.body);
    });
  })
}

//make http request
const sendToBitunnel = (opt) => {
  return new Promise((res, rej) => {
    request(opt, (error, response, body) => {
      if (!error) {
        res(body);
      } else {
        rej(error);
      }
    })
  })
}

const getMdPayload = (object, headers, url) => {
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

const onRun = () => {
  redisUtil.getLastFetchedNo()
    .then(lastNo => {
      return makeNtlmRequest(lastNo);
    })
    .then(resp => {
      if (resp) {
        resp = JSON.parse(resp);
        let events = resp.value;
        if (_.size(events) > 0) {
          let promises = [],
            nos = _.pluck(events, 'No');

          _.each(events, (event, i) => {
            setTimeout(() => {
              let _event = {
                "id": "string",
                "callbackUrl": "string",
                "createTime": 0,
                "resourceID": event.EventKey,
                "eventType": event.EventType
              };

              let promise = sendToBitunnel(getMdPayload(_event, { tenant_id: process.env.TENANT_ID || "PROMASIDOR_TEST", origin_user: event.OriginUser }, middlewareEventUrl))
              promises.push(promise);
            }, 10 * i);

          })

          Promise.all(promises)
            .then((success) => {

              nos = _.uniq(nos);
              let sorted = _.sortBy(nos, no => no);
              let last = _.last(sorted);
              if (last) {
                redisUtil.setLastFetchedNo(last);
              }

            })
            .catch(error => {
              console.log(`An error occured while sending events to middleware, ${error}`);
            });
        }
      }
    })
    .catch(error => {
      console.log(`Error: ${error}`);
    })
}

const startJob = cronPattern => {
  try {
    let searchJob = new CronJob({
      cronTime: cronPattern,
      onTick: onRun,
      start: true
    });
  } catch (ex) {
    console.log(`error in job ${ex}`);
  }
}

//get cron Pattern or run every 1 minutes
redisUtil.getCronPattern()
  .then((cronPattern) => {
    // startJob(cronPattern || '0 */1  * * * *');
    startJob(cronPattern || '*/10 *  * * * *'); //10secs
  })
  .catch((exp) => {
    console.log(`Error pattern: ${exp}`);
  })


console.log('Job Queue handler running...')
