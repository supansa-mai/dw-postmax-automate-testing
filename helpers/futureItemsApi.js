const { randomInt } = require('crypto');
const { expect } = require('@playwright/test');
const { buildHmacHeaders } = require('./hmac');
const { randomThaiName, randomThaiPhone, randomEmail, randomThaiAddress, randomThaiPostalCode, randomWeight } = require('./testData');

const PATH = '/v1/frontend/future-items';
const MAX_ATTEMPTS_ON_429 = 10;

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

  /**
   * Sends the payload; pass `headers` to override the signed headers entirely (replay, missing header, ...).
   * The API is rate limited per huid (CPM-1768, ~60 req/min token bucket), so a 429 is resent after its
   * Retry-After, re-signed unless `headers` was given; pass `retryOn429: false` to see the 429 itself
   */
  async create(payload, { headers, retryOn429 = true } = {}) {
    for (let attempt = 1; ; attempt++) {
      const response = await this.request.post(this.url, {
        headers: { 'Content-Type': 'application/json', ...(headers ?? this.signedHeaders()) },
        data: payload,
        timeout: 120000,
      });
      if (response.status() !== 429 || !retryOn429 || attempt === MAX_ATTEMPTS_ON_429) return response;
      const seconds = Number(response.headers()['retry-after']) || 1;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
  }
}

const REF_CODE_LENGTH = 9;
const DIGITS = '0123456789';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Uppercase only, so the API's sort order matches JS .sort() in list tests
function randomRefCode() {
  const pick = (chars) => chars[randomInt(0, chars.length)];
  const refCode = Array.from({ length: REF_CODE_LENGTH }, () => pick(DIGITS + LETTERS));
  // Force at least one letter and one digit at two different positions; the letter also
  // keeps automation data apart from manual QA data (61000xxxx, digits only)
  const letterAt = randomInt(0, REF_CODE_LENGTH);
  const digitAt = (letterAt + randomInt(1, REF_CODE_LENGTH)) % REF_CODE_LENGTH;
  refCode[letterAt] = pick(LETTERS);
  refCode[digitAt] = pick(DIGITS);
  return refCode.join('');
}

// 9 random uppercase letters + digits, e.g. 4K7Q2M9XA
function uniqueRefCodes(count) {
  const refCodes = new Set();
  while (refCodes.size < count) refCodes.add(randomRefCode());
  return [...refCodes];
}

// 9 random digits starting with 9, e.g. 904359628, for items paid by the EOD reconcile job: it did not mark
// letters + digits refCodes paid (03/11/2026). Starts with 9 so it never meets manual QA data (61000xxxx)
// or eodFile's unknownRefCode() (8xxxxxxxx)
function uniqueNumericRefCodes(count) {
  const refCodes = new Set();
  while (refCodes.size < count) refCodes.add(`9${String(randomInt(0, 1e8)).padStart(8, '0')}`);
  return [...refCodes];
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

/**
 * Creates `count` future items in one batch; returns them with id / trackingNumber / paymentStatus.
 * Pass `refCodes` (e.g. uniqueNumericRefCodes for EOD items) to choose them, otherwise they are letters + digits
 */
async function createBatch(api, count, batchRef, refCodes = uniqueRefCodes(count)) {
  const payload = buildPayload({ refCodes, ...(batchRef && { batchRef }) });
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

module.exports = { FutureItemsApi, uniqueRefCodes, uniqueNumericRefCodes, uniqueBatchRef, buildItem, buildPayload, createBatch, omit };
