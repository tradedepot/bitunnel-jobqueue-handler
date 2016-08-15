'use strict';
 const _ = require('underscore');

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