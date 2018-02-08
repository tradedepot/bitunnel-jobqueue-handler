"use strict";
const querystring = require('querystring');

const httpntlm = require('httpntlm'),
  _ = require('underscore'),
  request = require('request'),
  redisUtil = require('./utils/redis'),
  Curl = require( 'node-libcurl' ).Curl,
  utils = require('./utils');

let middlewareEventUrl = process.env.MIDDLEWARE_EVENT_URL || 'https://sandbox.tradedepot.io/core/v1/events',
  dispatchDelay = process.env.DISPATCH_DELAY || 30000,
  dispatchInterval= process.env.DISPATCH_INTERVAL||100,
  backOff= process.env.BACK_OFF||10;

const makeNtlmRequest = lastNo => {
    return new Promise((res, rej)=> {
      var curl = new Curl();
      let url = process.env.ODATA_JOBQ_URL || "https://p01nav.promasidor.systems:5020/PROMTESTNGWEBSVC/OData/Company('PROMASIDOR%20Nigeria')/tdmiddlewarevent?";
      const lastNum = parseInt(lastNo);
      if (isNaN(lastNum)) {
        console.info(`invalid number ${lastNum}`);
        return
      }
      let startNum = lastNum - backOff;
      if (startNum < 0) {
        startNum = 0
      }
      let nextNumber = lastNum + parseInt((process.env.BATCH_SIZE || "1000"));
      nextNumber = utils.pad(nextNumber, 8);
      let qeury = {"$format":"json","$filter":`No gt '${startNum}' and No lt '${nextNumber}'`}

      url += querystring.stringify(qeury);
      curl.setOpt('URL', url);
      curl.setOpt('HTTPAUTH', Curl.auth.NTLM);
      curl.setOpt('USERPWD', `CORP\\Tdmiddleware:${process.env.ODATA_JOBQ_PASS}`); //stuff goes in here
      curl.setOpt('HTTPHEADER', ['Content-Type: application/json', 'Accept: application/json']);

      

      console.info(`${url} ---- ${new Date().toISOString()}\n`);

      curl
        .on('end', function(code, body, headers) {
          //console.log("response_code",code);
          //console.log("headers",headers);
          //console.log("body",JSON.parse(body || '{}'));
          res(JSON.parse(body || '{}'));
          this.close();
        })
        .on('error', function(e) {
          rej(e);
          this.close();
        })
        .perform();
    });
  }

//make ntlm request
const makeNtlmRequest1 = lastNo => {
  return new Promise((res, rej) => {
    let url = process.env.ODATA_JOBQ_URL || "https://p01nav.promasidor.systems:5020/PROMTESTNGWEBSVC/OData/Company('PROMASIDOR%20Nigeria')/tdmiddlewarevent?$format=json";
    let nextNumber = parseInt(lastNo) + parseInt((process.env.BATCH_SIZE || "1000"));

    nextNumber = utils.pad(nextNumber, 8);

    url += `&$filter=No gt '${lastNo}' and No lt '${nextNumber}'`;

    console.info(`${url} ---- ${new Date().toISOString()}\n`);

    httpntlm.get({
      url: url,
      username: process.env.ODATA_JOBQ_USER || "Tdmiddleware",
      password: process.env.ODATA_JOBQ_PASS || "p@55w0rd",
      workstation: null,
      domain: process.env.ODATA_JOBQ_DOMAIN || "CORP"
    }, function(err, result) {
      if (err) rej(err);
      console.log("result",result);
      console.log("body",JSON.parse(result.body || '{}'));
      res(JSON.parse(result.body || '{}'));
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
      }, i * dispatchInterval);
    });
  }
}

const onRun = () => {
  redisUtil.getLastFetchedNo()
    .then(lastNo => {
      console.log("lastNo",lastNo)
      return makeNtlmRequest(lastNo);
    })
    .then(resp => {
      if (resp) {
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
