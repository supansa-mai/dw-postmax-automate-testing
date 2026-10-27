const { createHmac } = require('crypto');

// signature = HMAC-SHA256(base64-decoded secretKey, METHOD + unixTimestamp), hex encoded
function generateHmacSignature(secretKey, method, unixTime) {
  return createHmac('sha256', Buffer.from(secretKey, 'base64'))
    .update(`${method.toUpperCase()}${unixTime}`)
    .digest('hex');
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function buildHmacHeaders({ huid, secretKey }, method = 'POST', timestamp = nowUnix()) {
  return {
    'x-huid': huid,
    'x-timestamp': String(timestamp),
    'x-signature': generateHmacSignature(secretKey, method, timestamp),
  };
}

module.exports = { generateHmacSignature, buildHmacHeaders, nowUnix };
