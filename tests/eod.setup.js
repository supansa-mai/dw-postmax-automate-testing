// Prepares future items for the specs of the eod project (EOD_SPECS in playwright.config.js): creates them, uploads
// one bank EOD file with the ones that must be paid, then waits for the reconcile job (every 5 minutes on dev).
// The job only processes the latest uploaded file, so don't upload EOD files by hand while this runs.
const { test, expect } = require('../fixtures');
const { env } = require('../config/environments');
const { createBatch, uniqueRefCodes } = require('../helpers/futureItemsApi');
const { EodBucket } = require('../helpers/eodBucket');
const { unknownRefCode } = require('../helpers/eodFile');
const { saveEodItems } = require('../helpers/eodItems');
const { thaiDate } = require('../helpers/thaiDate');

// One batch per consumer spec: `paid` items go into the file, `unpaid` ones stay out of it.
// Add a group when a new spec needs paid items, e.g. scan or create shipment.
const GROUPS = {
  // payment-reconcile.spec.js (TS03)
  reconcile: { paid: 2, unpaid: 1 },
};

test('upload EOD file and wait for the reconcile job', async ({ futureItemsApi, futureItemsPage }) => {
  const { eod } = env;
  expect(eod.bucket && eod.prefix && eod.accessKeyId && eod.secretAccessKey && eod.companyAccount,
    'EOD_S3_* / EOD_COMPANY_ACCOUNT not set in .env').toBeTruthy();

  const groups = {};
  for (const [name, { paid, unpaid = 0 }] of Object.entries(GROUPS)) {
    const { batchRef, items } = await createBatch(futureItemsApi, paid + unpaid);
    // TS03-TC03 step 2: an item sent before the EOD file starts unpaid
    for (const item of items) expect(item.paymentStatus).toBe('UNPAID');
    groups[name] = { batchRef, paid: items.slice(0, paid), unpaid: items.slice(paid) };
  }
  // TS03-TC03 step 1: paid before its future item is sent
  const [earlyRefCode] = uniqueRefCodes(1);

  const fileName = await new EodBucket(eod).upload({
    companyAccount: eod.companyAccount,
    // TS03-TC02 step 2: a reference that matches no item must not stop the rest of the file
    payments: [...Object.values(groups).flatMap((g) => g.paid), { refCode: unknownRefCode() }, { refCode: earlyRefCode }],
  });

  for (const { batchRef, paid } of Object.values(groups)) {
    await futureItemsPage.openBatch(batchRef, thaiDate());
    await futureItemsPage.waitUntilPaid(paid, fileName);
  }

  saveEodItems({ fileName, earlyRefCode, groups });
});
