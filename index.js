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
    let nextNumber = parseInt(lastNo) + parseInt((process.env.BATCH_SIZE ||"1000"));

    nextNumber = utils.pad(nextNumber, 8);

    //url += `&$filter=No gt '${lastNo}'`;
    url += `&$filter=No gt '${lastNo}' and No lt '${nextNumber}'`;

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
  return (seqNo,results,i)=> {
    return new Promise((res, rej) => {
      //testing...
      /**if(i==200){
        setTimeout(() => {
          let error="Some random error";
          results[i]={error: error,seqNo: seqNo, index: i}
          console.log("error",results[i]);
          rej(error);
        }, i*10*5);
      }else{**/
        setTimeout(() => {
          request(opt, (error, response, body) => {
                results[i]={error: error,seqNo: seqNo}
                if (!error) {
                  res(body);
                } else {
                  rej(error);
                }
            });
          }, i*10);
        //}
      });
    }
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
        //console.log("events",events);
        let n=events.length;
        if (n > 0) {
            const results=new Array(n);
            /*
              Events are externally sorted by the no, no need to sort because it takes O(NlogN) time to sort.
              NAV has done it for us in d query because No is primary key which is default sort key.
              we can use this in more generic cases where we are nt sure of the sort order.
              nos = _.pluck(events, 'No')
              nos = _.uniq(nos);//
              let sorted = _.sortBy(nos, no => no);
            **/

            let promises=_.map(events, (event, i) => {
                let _event = {
                  "id": event.No,
                  "callbackUrl": "string",
                  "createTime": 0,
                  "resourceID": event.EventKey,
                  "eventType": event.EventType
                };
                return sendToBitunnel(getMdPayload(_event, { tenant_id: process.env.TENANT_ID || "PROMASIDOR_TEST", origin_user: event.OriginUser }, middlewareEventUrl))(event.No,results,i);
            });
            Promise.all(promises)
            .then((success) => {
              let last = events[n-1].No;
              if (last) {
                redisUtil.setLastFetchedNo(last);
              }else{
                logBitunnelError(generateError(last,events[n-1]));
              }
            })
            .catch(error => {
              //get the last successful contiguous seqNo greedily. this is the seqNo of the event before the first error if it exist
              let lastSuccess=Number.MIN_VALUE; //-2^31
              let firstErrorIndx=-1;
              for(let i=0;i<results.length;i++){
                if(typeof results[i] === 'undefined' || results[i].error){
                    firstErrorIndx=i;
                    break;
                }
              }
              if(firstErrorIndx-1>=0){
                lastSuccess=results[firstErrorIndx-1].seqNo;
              }
              redisUtil.getLastFetchedNo()
                .then(lastNo => {
                    if(lastSuccess!=Number.MIN_VALUE){
                      if(parseInt(lastSuccess)>parseInt(lastNo)){
                          lastNo=lastSuccess;
                          redisUtil.setLastFetchedNo(lastNo);
                      }
                      logBitunnelError(generateError(lastNo,error));
                  }else{
                      logBitunnelError(generateError(lastNo,error));
                  }
                });

                logBitunnelError(generateError(lastNo,error));
            });
        }
      }
    })
    .catch(error => {
      logBitunnelError(`${error}`);
    })
}

const generateError = (seqNo,error) => {
    return {error: error,lastSeqNo: seqNo};
}

const logBitunnelError = (error) => {
    error={
      errorMessage:`BitunnelJobQueueError: ${JSON.stringify(error)}`,
      body: error,
      source: "BitunnelJobQueueHandler"
    }
    //send ds over the wire using ...
   console.log(error);
}

const startJob = cronPattern => {
  try {
    let searchJob = new CronJob({
      cronTime: cronPattern,
      onTick: onRun,
      start: true
    });
  } catch (ex) {
    logBitunnelError(`error in job ${ex}`);
  }
}

//get cron Pattern or run every 1 minutes
//Is possible to set cron to run 1 minute after a run completes?
redisUtil.getCronPattern()
  .then((cronPattern) => {
    // startJob(cronPattern || '0 */1  * * * *');
    startJob(cronPattern || '*/30 *  * * * *'); //10secs
  })
  .catch((exp) => {
    logBitunnelError(`Error pattern: ${exp}`);
  })


console.log('Job Queue handler running...')
