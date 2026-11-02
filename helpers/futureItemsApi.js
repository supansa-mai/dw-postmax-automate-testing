const { randomInt } = require('crypto');
const { expect } = require('@playwright/test');
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

// AUTO_ + 8 random digits, e.g. AUTO_04817263
function uniqueBatchRef() {
  return `AUTO_${String(randomInt(0, 1e8)).padStart(8, '0')}`;
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

/** Creates `count` future items in one batch; returns them with id / trackingNumber / paymentStatus */
async function createBatch(api, count, batchRef) {
  const payload = buildPayload({ refCodes: uniqueRefCodes(count), ...(batchRef && { batchRef }) });
  const response = await api.create(payload);
  expect(response.status(), await response.text()).toBe(201);
  const { data } = await response.json();
  const items = payload.items.map((item) => ({ ...item, ...data.items.find((i) => i.refCode === item.refCode) }));
  return { batchRef: payload.batchRef, items };
}

function omit(obj, key) {
  const { [key]: _omitted, ...rest } = obj;
  return rest;
}

module.exports = { FutureItemsApi, uniqueRefCodes, uniqueBatchRef, buildItem, buildPayload, createBatch, omit };
