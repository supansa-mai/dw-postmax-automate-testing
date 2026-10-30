/**
 * Create Future Items API — POST /v1/frontend/future-items
 * Spec: [PostMax] DLT Public API Document v0.3 (19/10/2026)
 * Test cases: sheet "User Portal_DLT" > SCENARIO 2 (TS02-*)
 * Jira: CPM-1758, CPM-1767, CPM-1769
 * Success returns 201 (doc/sheet say 200; agreed to follow the actual API)
 */
const { test, expect } = require('../../fixtures');
const { env, ENV_NAME } = require('../../config/environments');
const { generateHmacSignature, nowUnix } = require('../../helpers/hmac');
const { uniqueRefCodes, uniqueBatchRef, buildItem, buildPayload, omit } = require('../../helpers/futureItemsApi');

const TRACKING_NUMBER = /^[A-Z]{2}\d{9}TH$/;
const DUPLICATE_IN_PAYLOAD = 'Duplicate within request payload';
const ALREADY_EXISTS = 'Already exists in database';

async function expectSuccess(response) {
  expect(response.status()).toBe(201);
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

async function expectInvalidBody(response) {
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.key).toBe('invalidRequestBody');
  return body.error.fields;
}

function expectCreatedItem(item, refCode) {
  expect(item).toMatchObject({
    id: expect.any(Number),
    refCode,
    trackingNumber: expect.stringMatching(TRACKING_NUMBER),
    status: 'PENDING',
    paymentStatus: expect.stringMatching(/^(PAID|UNPAID)$/),
  });
  expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
}

function findDuplicate(data, refCode) {
  return data.duplicateRefCodes.find((d) => d.refCode === refCode);
}

/** Creates items and returns { refCode: trackingNumber } for later duplicate checks */
async function createExisting(api, refCodes) {
  const data = await expectSuccess(await api.create(buildPayload({ refCodes })));
  expect(data.items).toHaveLength(refCodes.length);
  return Object.fromEntries(data.items.map((i) => [i.refCode, i.trackingNumber]));
}

/** Proves a rejected request created nothing: the same refCodes must still be brand new */
async function expectNotCreated(api, refCodes) {
  const data = await expectSuccess(await api.create(buildPayload({ refCodes })));
  expect(data.items.map((i) => i.refCode).sort()).toEqual([...refCodes].sort());
  expect(data.duplicateRefCodes).toEqual([]);
}

test('HMAC helper matches the verification vector in the API doc', () => {
  const signature = generateHmacSignature('Pthlnq4TKNwK5SOPttUKF8kP9k6NwYm/4XzS0UTKIfY=', 'POST', 1706789345);
  expect(signature).toBe('b58f7d8eeb6bd892aa3420841b195d934125e485a2ac25082918fd57743874b8');
});

test.describe('Create Future Items API', () => {
  test.skip(
    !env.dlt.huid || !env.dlt.secretKey,
    `Set ${ENV_NAME.toUpperCase()}_DLT_HUID and ${ENV_NAME.toUpperCase()}_DLT_SECRET_KEY in .env`,
  );

  test.describe('TS02-TC01/TC02 create successfully', () => {
    test('TS02-TC01 50 items with all fields → 201 with tracking number per item', async ({ futureItemsApi }) => {
      // 50 items per batch matches DLT's real usage
      const payload = buildPayload({ refCodes: uniqueRefCodes(50) });

      const data = await expectSuccess(await futureItemsApi.create(payload));

      expect(data.batchRef).toBe(payload.batchRef);
      expect(data.items).toHaveLength(50);
      payload.items.forEach((sent, i) => expectCreatedItem(data.items[i], sent.refCode));
      expect(data.duplicateRefCodes).toEqual([]);
      expect(new Set(data.items.map((i) => i.trackingNumber)).size).toBe(50);
    });

    test('TS02-TC02 without optional receiverPhone / receiverEmail → 201', async ({ futureItemsApi }) => {
      const item = omit(omit(buildItem(), 'receiverPhone'), 'receiverEmail');

      const data = await expectSuccess(await futureItemsApi.create({ batchRef: uniqueBatchRef(), items: [item] }));

      expectCreatedItem(data.items[0], item.refCode);
    });
  });

  test.describe('TS02-TC03 HMAC authentication', () => {
    test('invalid x-signature → 401 and nothing is created', async ({ futureItemsApi }) => {
      const refCodes = uniqueRefCodes(1);
      const headers = { ...futureItemsApi.signedHeaders(), 'x-signature': 'a'.repeat(64) };

      await expectInvalidSignature(await futureItemsApi.create(buildPayload({ refCodes }), { headers }));
      await expectNotCreated(futureItemsApi, refCodes);
    });

    test('x-timestamp 6 minutes old → 401', async ({ futureItemsApi }) => {
      // Server accepts up to ~359s (doc says 5 min); test 6 min + 5s buffer for clock skew
      const headers = futureItemsApi.signedHeaders({ timestamp: nowUnix() - (6 * 60 + 5) });

      await expectInvalidSignature(await futureItemsApi.create(buildPayload(), { headers }));
    });

    for (const header of ['x-huid', 'x-timestamp', 'x-signature']) {
      test(`missing ${header} → 401`, async ({ futureItemsApi }) => {
        const headers = omit(futureItemsApi.signedHeaders(), header);

        await expectInvalidSignature(await futureItemsApi.create(buildPayload(), { headers }));
      });
    }

    test('unknown x-huid → 401', async ({ futureItemsApi }) => {
      const headers = futureItemsApi.signedHeaders({ credentials: { ...env.dlt, huid: 'UNKNOWN123' } });

      await expectInvalidSignature(await futureItemsApi.create(buildPayload(), { headers }));
    });

    test('valid signature of a non-DLT credential → 403 and nothing is created', async ({ futureItemsApi }) => {
      test.skip(!env.nonDlt.huid || !env.nonDlt.secretKey, 'Set *_NON_DLT_HUID / *_NON_DLT_SECRET_KEY in .env');
      const refCodes = uniqueRefCodes(1);
      const headers = futureItemsApi.signedHeaders({ credentials: env.nonDlt });

      const response = await futureItemsApi.create(buildPayload({ refCodes }), { headers });

      expect(response.status()).toBe(403);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.key).toBe('forbidden');
      await expectNotCreated(futureItemsApi, refCodes);
    });

    test('key of another environment → 401 and nothing is created (CPM-1765)', async ({ futureItemsApi }) => {
      test.skip(!env.otherEnvDlt, 'Set the DLT key pair of another env in .env, e.g. UAT_DLT_HUID / UAT_DLT_SECRET_KEY');
      const refCodes = uniqueRefCodes(1);
      const headers = futureItemsApi.signedHeaders({ credentials: env.otherEnvDlt });

      await expectInvalidSignature(await futureItemsApi.create(buildPayload({ refCodes }), { headers }));
      await expectNotCreated(futureItemsApi, refCodes);
    });

    test('replayed request within 5 minutes → 201, no new items, same tracking numbers', async ({ futureItemsApi }) => {
      const payload = buildPayload({ refCodes: uniqueRefCodes(2) });
      const headers = futureItemsApi.signedHeaders();
      const first = await expectSuccess(await futureItemsApi.create(payload, { headers }));

      const replay = await expectSuccess(await futureItemsApi.create(payload, { headers }));

      expect(replay.items).toEqual([]);
      for (const created of first.items) {
        expect(findDuplicate(replay, created.refCode)).toMatchObject({
          trackingNumber: created.trackingNumber,
          reason: ALREADY_EXISTS,
        });
      }
    });
  });

  test.describe('TS02-TC04 required fields', () => {
    test('missing batchRef → 400', async ({ futureItemsApi }) => {
      const fields = await expectInvalidBody(await futureItemsApi.create(omit(buildPayload(), 'batchRef')));

      expect(fields.batchRef).toContain('Required');
    });

    test('empty items → 400', async ({ futureItemsApi }) => {
      const fields = await expectInvalidBody(await futureItemsApi.create({ batchRef: uniqueBatchRef(), items: [] }));

      expect(fields.items).toContain('Array must contain at least 1 element(s)');
    });

    for (const field of ['refCode', 'receiverName', 'receiverAddress', 'receiverPostalCode', 'weight']) {
      test(`item without ${field} → 400`, async ({ futureItemsApi }) => {
        const payload = { batchRef: uniqueBatchRef(), items: [omit(buildItem(), field)] };

        const fields = await expectInvalidBody(await futureItemsApi.create(payload));

        expect(fields.items?.['0']?.[field]).toContain('Required');
      });
    }

    test('one invalid item rejects the whole batch', async ({ futureItemsApi }) => {
      const refCodes = uniqueRefCodes(3);
      const payload = buildPayload({ refCodes });
      payload.items[1] = omit(payload.items[1], 'receiverName');

      const fields = await expectInvalidBody(await futureItemsApi.create(payload));

      expect(fields.items?.['1']?.receiverName).toContain('Required');
      await expectNotCreated(futureItemsApi, refCodes);
    });
  });

  test.describe('TS02-TC05 invalid formats', () => {
    const cases = [
      { field: 'receiverPostalCode', value: '1015', message: 'receiverPostalCode must be 5 digits' },
      { field: 'receiverPostalCode', value: 'ABCDE', message: 'receiverPostalCode must be 5 digits' },
      { field: 'weight', value: 0, message: 'Expected string, received number' },
      { field: 'weight', value: '0', message: 'weight must be greater than 0' },
      { field: 'weight', value: '-1', message: 'weight must be greater than 0' },
      { field: 'weight', value: 'abc' },
      { field: 'refCode', value: '61000241', message: 'refCode must be 9 digits' },
      { field: 'refCode', value: '6100024155', message: 'refCode must be 9 digits' },
      { field: 'refCode', value: 'REF_A1', message: 'refCode must be 9 digits' },
      { field: 'refCode', value: 'ref_a1', message: 'refCode must be 9 digits' },
    ];

    for (const { field, value, message } of cases) {
      test(`${field} = ${JSON.stringify(value)} → 400`, async ({ futureItemsApi }) => {
        const payload = { batchRef: uniqueBatchRef(), items: [buildItem({ [field]: value })] };

        const fields = await expectInvalidBody(await futureItemsApi.create(payload));

        if (message) expect(fields.items?.['0']?.[field]).toContain(message);
      });
    }
  });

  test.describe('TS02-TC06 batch size', () => {
    test('1 item → 201', async ({ futureItemsApi }) => {
      const data = await expectSuccess(await futureItemsApi.create(buildPayload()));

      expect(data.items).toHaveLength(1);
    });

    test('501 items → 400 and nothing is created', async ({ futureItemsApi }) => {
      const refCodes = uniqueRefCodes(501);

      const fields = await expectInvalidBody(await futureItemsApi.create(buildPayload({ refCodes })));
      expect(fields.items).toContain('Array must contain at most 500 element(s)');

      // One refCode from the rejected batch is enough to show it was not saved
      await expectNotCreated(futureItemsApi, refCodes.slice(0, 1));
    });

    test.fixme('5,000–10,000 items/day performance (On Hold, RR-15)', async () => {});
  });

  test.describe('TS02-TC07 refCode duplicated within the request', () => {
    test('duplicated refCode is skipped, the rest are created', async ({ futureItemsApi }) => {
      const [dup, a, b] = uniqueRefCodes(3);
      const payload = buildPayload({ refCodes: [dup, dup, a, b] });

      const data = await expectSuccess(await futureItemsApi.create(payload));

      expect(data.items.map((i) => i.refCode)).toEqual([a, b]);
      expect(findDuplicate(data, dup)).toMatchObject({ trackingNumber: null, reason: DUPLICATE_IN_PAYLOAD });
    });

    test('skipped refCode can be created later in a new request', async ({ futureItemsApi }) => {
      const [dup] = uniqueRefCodes(1);
      await expectSuccess(await futureItemsApi.create(buildPayload({ refCodes: [dup, dup] })));

      await expectNotCreated(futureItemsApi, [dup]);
    });

    test('same refCode 3 times → not created', async ({ futureItemsApi }) => {
      const [dup] = uniqueRefCodes(1);

      const data = await expectSuccess(await futureItemsApi.create(buildPayload({ refCodes: [dup, dup, dup] })));

      expect(data.items).toEqual([]);
      expect(findDuplicate(data, dup)).toMatchObject({ trackingNumber: null, reason: DUPLICATE_IN_PAYLOAD });
    });
  });

  test.describe('TS02-TC08 refCode already exists in database', () => {
    test('existing refCode returns the original tracking number, new one is created', async ({ futureItemsApi }) => {
      const [existing, fresh] = uniqueRefCodes(2);
      const tracking = await createExisting(futureItemsApi, [existing]);

      const data = await expectSuccess(await futureItemsApi.create(buildPayload({ refCodes: [existing, fresh] })));

      expect(data.items).toHaveLength(1);
      expectCreatedItem(data.items[0], fresh);
      expect(findDuplicate(data, existing)).toMatchObject({ trackingNumber: tracking[existing], reason: ALREADY_EXISTS });
    });

    test('existing refCode with different data is still a duplicate (checked by refCode only)', async ({ futureItemsApi }) => {
      const [existing] = uniqueRefCodes(1);
      const tracking = await createExisting(futureItemsApi, [existing]);
      const changed = buildPayload({
        refCodes: [existing],
        itemOverrides: { receiverName: 'นายเปลี่ยน ชื่อใหม่', receiverAddress: '999 ถนนพหลโยธิน', weight: '9.9' },
      });

      const data = await expectSuccess(await futureItemsApi.create(changed));

      expect(data.items).toEqual([]);
      expect(findDuplicate(data, existing)).toMatchObject({ trackingNumber: tracking[existing], reason: ALREADY_EXISTS });
    });
  });

  test.describe('TS02-TC09 new + duplicated in request + existing in database', () => {
    test('each refCode lands in the right list', async ({ futureItemsApi }) => {
      const [existing, newA, newB, dup] = uniqueRefCodes(4);
      const tracking = await createExisting(futureItemsApi, [existing]);

      const data = await expectSuccess(
        await futureItemsApi.create(buildPayload({ refCodes: [newA, newB, dup, dup, existing] })),
      );

      expect(data.items.map((i) => i.refCode)).toEqual([newA, newB]);
      expect(findDuplicate(data, dup)).toMatchObject({ trackingNumber: null, reason: DUPLICATE_IN_PAYLOAD });
      expect(findDuplicate(data, existing)).toMatchObject({ trackingNumber: tracking[existing], reason: ALREADY_EXISTS });
    });

    test('existing refCode sent twice → "Already exists in database"', async ({ futureItemsApi }) => {
      const [existing] = uniqueRefCodes(1);
      const tracking = await createExisting(futureItemsApi, [existing]);

      const data = await expectSuccess(await futureItemsApi.create(buildPayload({ refCodes: [existing, existing] })));

      expect(data.items).toEqual([]);
      expect(findDuplicate(data, existing)).toMatchObject({ trackingNumber: tracking[existing], reason: ALREADY_EXISTS });
    });
  });

  test.describe('TS02-TC10 batchRef reuse', () => {
    test('existing batchRef with new refCodes → 201 (duplicates checked by refCode only)', async ({ futureItemsApi }) => {
      const batchRef = uniqueBatchRef();
      await expectSuccess(await futureItemsApi.create(buildPayload({ batchRef })));
      const refCodes = uniqueRefCodes(2);

      const data = await expectSuccess(await futureItemsApi.create(buildPayload({ batchRef, refCodes })));

      expect(data.batchRef).toBe(batchRef);
      expect(data.items.map((i) => i.refCode)).toEqual(refCodes);
    });
  });

  test.describe('TS02-TC11 rate limit', () => {
    test.fixme('over the limit → 429 with Retry-After (On Hold, RR-31)', async () => {});
  });
});
