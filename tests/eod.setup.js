// Prepares future items for the specs of the eod project (EOD_SPECS in playwright.config.js): creates them, uploads
// one bank EOD file with the ones that must be paid, then waits for the reconcile job (every 5 minutes on dev).
// The job only processes the latest uploaded file, so don't upload EOD files by hand while this runs.
const { test, expect } = require('../fixtures');
const { env } = require('../config/environments');
const { createBatch, uniqueNumericRefCodes } = require('../helpers/futureItemsApi');
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
  // Put in the shared order below
  order: { paid: 3 },
};

test('upload EOD file and wait for the reconcile job', async ({ futureItemsApi, futureItemsPage, createFutureItemPage }) => {
  const { eod } = env;
  expect(eod.bucket && eod.prefix && eod.accessKeyId && eod.secretAccessKey && eod.companyAccount,
    'EOD_S3_* / EOD_COMPANY_ACCOUNT not set in .env').toBeTruthy();

  const groups = {};
  for (const [name, { paid, unpaid = 0 }] of Object.entries(GROUPS)) {
    // 9-digit refCodes: the reconcile job matches the first 9 characters of reference 1, digits only
    const { batchRef, items } = await createBatch(futureItemsApi, paid + unpaid, undefined, uniqueNumericRefCodes(paid + unpaid));
    // TS03-TC03 step 2: an item sent before the EOD file starts unpaid
    for (const item of items) expect(item.paymentStatus).toBe('UNPAID');
    groups[name] = { batchRef, paid: items.slice(0, paid), unpaid: items.slice(paid) };
  }
  // TS03-TC03 step 1: paid before its future item is sent
  const [earlyRefCode] = uniqueNumericRefCodes(1);

  const fileName = await new EodBucket(eod).upload({
    companyAccount: eod.companyAccount,
    // TS03-TC02 step 2: a reference that matches no item must not stop the rest of the file
    payments: [...Object.values(groups).flatMap((g) => g.paid), { refCode: unknownRefCode() }, { refCode: earlyRefCode }],
  });

  for (const { batchRef, paid } of Object.values(groups)) {
    await futureItemsPage.waitUntilPaid({ batchRef, date: thaiDate(), items: paid, fileName });
  }

  // One order for the specs that only read it (orders-future-items.spec.js); a spec that changes an order's status,
  // e.g. receiving it at drop off, creates its own
  const { batchRef, paid: items } = groups.order;
  await createFutureItemPage.goto();
  await createFutureItemPage.scanItems(items);
  await createFutureItemPage.createOrder();
  await expect(createFutureItemPage.toast).toContainText(/สร้างใบนำส่งสำเร็จ เลขที่เอกสาร: PM\d+/);
  const [number] = (await createFutureItemPage.toast.innerText()).match(/PM\d+/);

  saveEodItems({ fileName, earlyRefCode, groups, order: { number, batchRef, items } });
});
