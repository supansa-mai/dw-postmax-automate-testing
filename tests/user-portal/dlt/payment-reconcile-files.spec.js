const { test } = require('../../../fixtures');
const { env } = require('../../../config/environments');
const { FutureItemsApi, createBatch, uniqueNumericRefCodes } = require('../../../helpers/futureItemsApi');
const { EodBucket } = require('../../../helpers/eodBucket');
const { thaiDate } = require('../../../helpers/thaiDate');

const TODAY = thaiDate();
const UNPAID = 'ยังไม่ชำระเงิน';

// Each test uploads an EOD file of its own and needs a job round (5 minutes) to itself, since the job only reads the
// latest file: one at a time, and never while tests/eod.setup.js runs
test.describe.configure({ mode: 'default', timeout: 10 * 60 * 1000 });

async function uploadEodFile(companyCode, payments) {
  return new EodBucket(env.eod).upload({ companyCode, companyAccount: env.eod.companyAccount, payments });
}

test.describe('Payment reconcile, files of their own (EOD file)', () => {
  test.describe('TS03-TC08 ตรวจสอบการตัด refCode ตาม code_digit_start / code_digit_end ของแต่ละ company', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    // Also TS03-TC07 step 4 (company B's file pays company B's items)
    test('บริษัทที่ตัด 9 หลัก ชำระเงินแล้ว', async ({ request, loginPage, futureItemsPage }) => {
      const { dltB } = env;
      test.skip(!(dltB.huid && dltB.secretKey && dltB.user.email && dltB.user.password), 'DLT_B_* (second DLT company) not set in .env');
      const company = env.eodCompanies.dltB;
      const batch = await createBatch(new FutureItemsApi(request, { apiURL: env.apiURL, dlt: dltB }), 2, undefined,
        uniqueNumericRefCodes(2, company.refDigits));
      // Digits after the refCode, as in the sheet's 6100030029999
      const fileName = await uploadEodFile(company.companyCode, batch.items.map(({ refCode }) => ({ reference1: `${refCode}9999` })));

      await loginPage.loginAs(dltB.user, 'DLT_B_USER_EMAIL / DLT_B_USER_PASSWORD');
      await futureItemsPage.waitUntilPaid({ batchRef: batch.batchRef, date: TODAY, items: batch.items, fileName });
    });
  });

  test.describe('TS03-TC10 ตรวจสอบไฟล์ที่ H-COMPANY-CODE ไม่มี mapping หรือ mapping ไม่ active', () => {
    for (const [title, companyCode] of [['company code ที่ไม่มี mapping ไม่อัปเดตรายการ', '99999'], ['company code ว่าง ไม่อัปเดตรายการ', '']]) {
      test(title, async ({ futureItemsApi, futureItemsPage }) => {
        const batch = await createBatch(futureItemsApi, 1, undefined, uniqueNumericRefCodes(1, env.eodCompanies.dlt.refDigits));
        const fileName = await uploadEodFile(companyCode, batch.items);
        await new EodBucket(env.eod).waitUntilProcessed(fileName);

        await futureItemsPage.expectPaymentStatus(batch, TODAY, UNPAID);
      });
    }
  });
});
