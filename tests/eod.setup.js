// Prepares future items for the specs of the eod project (EOD_SPECS in playwright.config.js): creates them, uploads
// one bank EOD file with the ones that must be paid, then waits for the reconcile job (every 5 minutes on dev).
// The job only processes the latest uploaded file, so don't upload EOD files by hand while this runs.
const { test, expect } = require('../fixtures');
const { env, ENV_NAME } = require('../config/environments');
const { FutureItemsApi, createBatch, uniqueNumericRefCodes } = require('../helpers/futureItemsApi');
const { EodBucket } = require('../helpers/eodBucket');
const { unknownRefCode } = require('../helpers/eodFile');
const { saveEodItems } = require('../helpers/eodItems');
const { thaiDate } = require('../helpers/thaiDate');

// One batch per consumer spec: `paid` items go into the file, `unpaid` ones stay out of it.
// Add a group when a new spec needs paid items, e.g. scan or create shipment.
const GROUPS = {
  // payment-reconcile.spec.js (TS03)
  reconcile: { paid: 2, unpaid: 1 },
  // payment-reconcile.spec.js (TS05-TC03, cancel a paid item)
  cancelPaid: { paid: 1 },
  // create-order-future-items.spec.js: only scanned, never ordered, so tests share them (2 batches for TS06-TC02)
  scan: { paid: 6 },
  scanOtherBatch: { paid: 5 },
  // create-order-future-items.spec.js: TS08-TC01 orders them, TS06-TC05 scans one already in an order,
  // TS08-TC02 / TS05-TC04 have one ordered / cancelled in another browser
  createOrder: { paid: 3 },
  ordered: { paid: 1 },
  orderedElsewhere: { paid: 2 },
  cancelledElsewhere: { paid: 2 },
  // Put in the orders below
  order: { paid: 3 },
  receiveOrder: { paid: 2 },
  partialReceiveOrder: { paid: 3 },
};

test('upload EOD file and wait for the reconcile job', async ({ request, futureItemsApi, futureItemsPage, createFutureItemPage }) => {
  const { eod, dltB } = env;
  expect(eod.bucket && eod.prefix && eod.accessKeyId && eod.secretAccessKey && eod.companyAccount,
    'EOD_S3_* / EOD_COMPANY_ACCOUNT not set in .env').toBeTruthy();
  const company = env.eodCompanies?.dlt;
  expect(company, `eodCompanies.dlt not set for ${ENV_NAME} in config/environments.js`).toBeTruthy();

  const groups = {};
  for (const [name, { paid, unpaid = 0 }] of Object.entries(GROUPS)) {
    const refCodes = uniqueNumericRefCodes(paid + unpaid, company.refDigits);
    const { batchRef, items } = await createBatch(futureItemsApi, paid + unpaid, undefined, refCodes);
    // TS03-TC03 step 2: an item sent before the EOD file starts unpaid
    for (const item of items) expect(item.paymentStatus).toBe('UNPAID');
    groups[name] = { batchRef, paid: items.slice(0, paid), unpaid: items.slice(paid) };
  }
  // TS03-TC03 step 1: paid before its future item is sent
  const [earlyRefCode] = uniqueNumericRefCodes(1, company.refDigits);

  // payment-reconcile.spec.js: in the file, but must stay unpaid
  // TS03-TC08 step 5: a refCode shorter than the digit range, without the bank's suffix after it
  const shortRef = await createBatch(futureItemsApi, 1, undefined, uniqueNumericRefCodes(1, company.refDigits - 1));
  // TS03-TC09 steps 4–5: company B's items, one with a refCode company A also has (only A's item gets paid)
  let otherCompany;
  if (dltB.huid && dltB.secretKey) {
    const [sharedRefCode] = uniqueNumericRefCodes(1, company.refDigits);
    otherCompany = {
      a: await createBatch(futureItemsApi, 1, undefined, [sharedRefCode]),
      b: await createBatch(new FutureItemsApi(request, { apiURL: env.apiURL, dlt: dltB }), 2, undefined,
        [...uniqueNumericRefCodes(1, company.refDigits), sharedRefCode]),
    };
  }

  const fileName = await new EodBucket(eod).upload({
    // TS03-TC07 step 5: the code is padded with spaces to its 8 characters
    companyCode: company.companyCode,
    companyAccount: eod.companyAccount,
    // TS03-TC02 step 2: a reference that matches no item must not stop the rest of the file
    payments: [...Object.values(groups).flatMap((g) => g.paid), { refCode: unknownRefCode() }, { refCode: earlyRefCode },
      { reference1: shortRef.items[0].refCode }, ...(otherCompany ? [...otherCompany.a.items, ...otherCompany.b.items] : [])],
  });

  const paidBatches = Object.values(groups).map(({ batchRef, paid }) => ({ batchRef, items: paid }));
  if (otherCompany) paidBatches.push(otherCompany.a);
  for (const { batchRef, items } of paidBatches) {
    await futureItemsPage.waitUntilPaid({ batchRef, date: thaiDate(), items, fileName });
  }

  async function createOrder({ batchRef, paid: items }) {
    await createFutureItemPage.goto();
    await createFutureItemPage.scanItems(items);
    await createFutureItemPage.createOrder();
    await expect(createFutureItemPage.toast).toContainText(/สร้างใบนำส่งสำเร็จ เลขที่เอกสาร: PM[0-9A-Z]+/);
    const [number] = (await createFutureItemPage.toast.innerText()).match(/PM[0-9A-Z]+/);
    return { number, batchRef, items };
  }
  // `order` stays as created for the specs that only read it (orders-future-items.spec.js, drop-off/dlt-orders.spec.js);
  // `receiveOrder` / `partialReceiveOrder` are received at drop off, in full / in part, by drop-off/dlt-orders.spec.js
  const order = await createOrder(groups.order);
  const receiveOrder = await createOrder(groups.receiveOrder);
  const partialReceiveOrder = await createOrder(groups.partialReceiveOrder);

  saveEodItems({ fileName, earlyRefCode, groups, shortRef, otherCompany, order, receiveOrder, partialReceiveOrder });
});
