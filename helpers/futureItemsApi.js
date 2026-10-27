const { randomInt } = require('crypto');
const { buildHmacHeaders } = require('./hmac');
const { randomThaiName, randomThaiPhone, randomEmail, randomThaiAddress, randomThaiPostalCode, randomWeight } = require('./testData');

const PATH = '/v1/frontend/future-items';

class FutureItemsApi {
  /**
   * @param {import('@playwright/test').APIRequestContext} request
   * @param {{ apiURL: string, dlt: { huid: string, secretKey: string } }} env
   */
  constructor(request, env) {
    this.request = request;
    this.url = `${env.apiURL}${PATH}`;
    this.credentials = env.dlt;
  }

  signedHeaders({ credentials = this.credentials, timestamp } = {}) {
    return buildHmacHeaders(credentials, 'POST', timestamp);
  }

  /** Sends the payload; pass `headers` to override the signed headers entirely (replay, missing header, ...) */
  async create(payload, { headers = this.signedHeaders() } = {}) {
    return this.request.post(this.url, {
      headers: { 'Content-Type': 'application/json', ...headers },
      data: payload,
      timeout: 120000,
    });
  }
}

// Automation refCodes start with 9 so they never clash with manual QA data (61000xxxx)
function uniqueRefCodes(count) {
  const start = randomInt(0, 1e8 - count);
  return Array.from({ length: count }, (_, i) => `9${String(start + i).padStart(8, '0')}`);
}

function uniqueBatchRef() {
  return `AUTO_${Date.now()}_${randomInt(1000, 9999)}`;
}

function buildItem(overrides = {}) {
  return {
    refCode: uniqueRefCodes(1)[0],
    receiverName: randomThaiName(),
    receiverPhone: randomThaiPhone(),
    receiverEmail: randomEmail(),
    receiverAddress: randomThaiAddress(),
    receiverPostalCode: randomThaiPostalCode(),
    weight: randomWeight(),
    ...overrides,
  };
}

function buildPayload({ refCodes = uniqueRefCodes(1), batchRef = uniqueBatchRef(), itemOverrides = {} } = {}) {
  return { batchRef, items: refCodes.map((refCode) => buildItem({ ...itemOverrides, refCode })) };
}

function omit(obj, key) {
  const { [key]: _omitted, ...rest } = obj;
  return rest;
}

module.exports = { FutureItemsApi, uniqueRefCodes, uniqueBatchRef, buildItem, buildPayload, omit };
