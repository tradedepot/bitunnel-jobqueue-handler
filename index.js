"use strict";
const httpntlm = require('httpntlm'),
  _ = require('underscore'),
  request = require('request'),
  redisUtil = require('./utils/redis'),
  utils = require('./utils');

let middlewareEventUrl = process.env.MIDDLEWARE_EVENT_URL || 'https://sandbox.tradedepot.io/core/v1/events',
  dispatchDelay = process.env.DISPATCH_DELAY || 10000;

//make ntlm request
const makeNtlmRequest = lastNo => {
  return new Promise((res, rej) => {
    let url = process.env.ODATA_JOBQ_URL || "http://p01nav.promasidor.systems:5019/PROMTESTNGWEBSVC/OData/Company('PROMASIDOR%20Nigeria')/tdmiddlewarevent?$format=json";
    let nextNumber = parseInt(lastNo) + parseInt((process.env.BATCH_SIZE || "1000"));

    nextNumber = utils.pad(nextNumber, 8);

    url += `&$filter=No gt '${lastNo}' and No lt '${nextNumber}'`;

    console.info(`${url} ---- ${new Date().toISOString()}\n`);

    httpntlm.get({
      url: url,
      username: process.env.ODATA_JOBQ_USER || 'Tdmiddleware',
      password: process.env.ODATA_JOBQ_PASS || 'p@55w0rd',
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
  return (seqNo, results, i) => {
    return new Promise((res, rej) => {
      setTimeout(() => {
        request(opt, (error, response, body) => {
          results[i] = { error: error, seqNo: seqNo }
          if (!error) {
            res(body);
          } else {
            rej(error);
          }
        });
      }, i * 10);
    });
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
        
        if (events) {
          let n = events.length;

          if (n > 0) {
            const results = new Array(n);
            /*
              Events are externally sorted by the no, no need to sort because it takes O(NlogN) time to sort.
              NAV has done it for us in d query because No is primary key which is default sort key.
              we can use this in more generic cases where we are nt sure of the sort order.
              nos = _.pluck(events, 'No')
              nos = _.uniq(nos);//
              let sorted = _.sortBy(nos, no => no);
            **/

            let promises = _.map(events, (event, i) => {
              let _event = {
                "id": event.No,
                "callbackUrl": "string",
                "createTime": 0,
                "resourceID": event.EventKey,
                "eventType": event.EventType
              };
              return sendToBitunnel(utils.constructMdPayload(_event, { tenant_id: process.env.TENANT_ID || "PROMASIDOR_TEST", origin_user: event.OriginUser }, middlewareEventUrl))(event.No, results, i);
            });
            
            Promise.all(promises)
              .then((success) => {
                let last = events[n - 1].No;
                if (last) {
                  redisUtil.setLastFetchedNo(last);
                  console.info(`${events[0].No} -- ${last} SENT... \n`);
                } else {
                  utils.logBitunnelError(utils.generateError(last, events[n - 1]));
                }
                breatheAndRestart();
              })
              .catch(error => {
                //get the last successful contiguous seqNo greedily. this is the seqNo of the event before the first error if it exist
                let lastSuccess = Number.MIN_VALUE; //-2^31
                let firstErrorIndx = -1;
                for (let i = 0; i < results.length; i++) {
                  if (typeof results[i] === 'undefined' || results[i].error) {
                    firstErrorIndx = i;
                    break;
                  }
                }
                if (firstErrorIndx - 1 >= 0) {
                  lastSuccess = results[firstErrorIndx - 1].seqNo;
                }
                redisUtil.getLastFetchedNo()
                  .then(lastNo => {
                    if (lastSuccess != Number.MIN_VALUE) {
                      if (parseInt(lastSuccess) > parseInt(lastNo)) {
                        lastNo = lastSuccess;
                        redisUtil.setLastFetchedNo(lastNo);
                        console.info(`${events[0].No} -- ${lastNo} SENT...\n`);
                      }
                      utils.logBitunnelError(utils.generateError(lastNo, error));
                    } else {
                      utils.logBitunnelError(utils.generateError(lastNo, error));
                    }
                    breatheAndRestart();
                  }).catch(err => {
                    utils.logBitunnelError(`${err}`);
                    breatheAndRestart();
                  });
              });
          } else {
            breatheAndRestart();
          }
        } else {
          breatheAndRestart();
        }
      } else {
        breatheAndRestart();
      }
    })
    .catch(error => {
      utils.logBitunnelError(`${error}`);
      breatheAndRestart();
    })
}

onRun();

function breatheAndRestart() {
  setTimeout(onRun, dispatchDelay);
}

console.info('Job Queue Dispatcher running...')
