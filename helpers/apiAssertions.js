// Response checks for the PostMax API envelope: { success, data } or { success: false, key, error: { fields } }
const { expect } = require('@playwright/test');

/** Returns `data`; Create Future Items answers 201, pass the status of other endpoints */
async function expectSuccess(response, status = 201) {
  expect(response.status()).toBe(status);
  const body = await response.json();
  expect(body.success).toBe(true);
  return body.data;
}

async function expectInvalidSignature(response) {
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.key).toBe('invalidSignature');
}

/** Returns `error.fields` so tests can check which field failed */
async function expectInvalidBody(response) {
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.key).toBe('invalidRequestBody');
  return body.error.fields;
}

module.exports = { expectSuccess, expectInvalidSignature, expectInvalidBody };
