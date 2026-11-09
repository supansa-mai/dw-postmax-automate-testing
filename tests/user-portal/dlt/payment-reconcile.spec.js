/**
 * Payment reconcile from the bank EOD file — S3 folder → reconcile job (every 5 minutes on dev) → paymentStatus
 * Test cases: sheet "User Portal_DLT" > SCENARIO 3 (TS03-*)
 *   and SCENARIO 5 TS05-TC03 (cancel a paid item, needs an item the job has marked paid)
 * Jira: CPM-1781
 *
 * Runs in the eod project: tests/eod.setup.js has already created the items, uploaded one EOD file and waited
 * for the job, so these tests only check the result. TS03-TC03 step 2 (item sent before the file starts
 * unpaid) is checked there too.
 * Not covered: TS03-TC04 / TC05 (invalid files, reference matching), TS03-TC06 (processing a file again).
 */
const { test, expect } = require('../../../fixtures');
const { env } = require('../../../config/environments');
const { buildPayload } = require('../../../helpers/futureItemsApi');
const { readEodItems } = require('../../../helpers/eodItems');
const { thaiDate } = require('../../../helpers/thaiDate');

const TODAY = thaiDate();
const PAID = 'ชำระเงินแล้ว';
const UNPAID = 'ยังไม่ชำระเงิน';

// One test at a time: dev API's DB pool is only 3 connections and returns 500 under concurrent load
test.describe.configure({ mode: 'default' });

const DLT_B_SET = Boolean(env.dltB.huid && env.dltB.secretKey && env.dltB.user.email && env.dltB.user.password);

test.describe('Payment reconcile (EOD file)', () => {
  /** Batch with 2 items in the EOD file and 1 left out of it */
  let reconcile;
  /** In the EOD file before its future item was sent */
  let earlyRefCode;
  /** Batch with 1 paid item, cancelled by TS05-TC03 */
  let cancelPaid;

  test.beforeAll(() => {
    ({ groups: { reconcile, cancelPaid }, earlyRefCode } = readEodItems());
  });

  test.describe('TS03-TC01 ระบบอัปเดตสถานะการชำระเงินเป็น "ชำระเงินแล้ว" - ref code ตรงกับไฟล์ EOD', () => {
    test('รายการที่อยู่ในไฟล์ EOD เป็นชำระเงินแล้ว', async ({ futureItemsPage }) => {
      await futureItemsPage.openBatch(reconcile.batchRef, TODAY);
      await futureItemsPage.scrollGrid('end');

      for (const item of reconcile.paid) {
        await expect(futureItemsPage.cell(item.id, 'paymentStatus')).toHaveText(PAID);
      }
      await expect(futureItemsPage.summaryCount('all')).toHaveText('3');
      await expect(futureItemsPage.summaryCount('unpaid')).toHaveText('1');
    });
  });

  test.describe('TS03-TC02 รายการที่ไม่มีในไฟล์ EOD ยังคงสถานะ "ยังไม่ชำระเงิน"', () => {
    test('รายการที่ไม่อยู่ในไฟล์ EOD ยังไม่ชำระเงิน', async ({ futureItemsPage }) => {
      await futureItemsPage.openBatch(reconcile.batchRef, TODAY);
      await futureItemsPage.scrollGrid('end');

      for (const item of reconcile.unpaid) {
        await expect(futureItemsPage.cell(item.id, 'paymentStatus')).toHaveText(UNPAID);
      }
    });
  });

  test.describe('TS03-TC03 ตรวจสอบลำดับการมาของข้อมูล', () => {
    test('จ่ายเงินก่อนส่งข้อมูลเข้ามา ได้ชำระเงินแล้วทันที', async ({ futureItemsApi, futureItemsPage }) => {
      const payload = buildPayload({ refCodes: [earlyRefCode] });
      const response = await futureItemsApi.create(payload);
      expect(response.status(), await response.text()).toBe(201);
      const { data: { items: [item] } } = await response.json();
      expect(item.paymentStatus).toBe('PAID');

      await futureItemsPage.openBatch(payload.batchRef, TODAY);
      await futureItemsPage.scrollGrid('end');
      await expect(futureItemsPage.cell(item.id, 'paymentStatus')).toHaveText(PAID);
    });
  });

  test.describe('TS05-TC03 ยกเลิกรายการที่ชำระเงินแล้ว', () => {
    test('ยกเลิกรายการที่ชำระเงินแล้วได้', async ({ futureItemsPage }) => {
      const [item] = cancelPaid.paid;
      await futureItemsPage.openBatch(cancelPaid.batchRef, TODAY);
      await futureItemsPage.scrollGrid('end');
      await expect(futureItemsPage.cell(item.id, 'paymentStatus')).toHaveText(PAID);

      await futureItemsPage.cancelItem(item.id);
      await expect(futureItemsPage.toast).toHaveText('ยกเลิกรายการสำเร็จ');
      await expect(futureItemsPage.cell(item.id, 'status')).toHaveText('ยกเลิก');
      await expect(futureItemsPage.cell(item.id, 'paymentStatus')).toHaveText(PAID);
      await expect(futureItemsPage.cancelButton(item.id)).toBeDisabled();

      // Still paid when loaded again, not only in the client state (a reload would drop the Batch No. filter)
      await futureItemsPage.openBatch(cancelPaid.batchRef, TODAY);
      await futureItemsPage.scrollGrid('end');
      await expect(futureItemsPage.cell(item.id, 'status')).toHaveText('ยกเลิก');
      await expect(futureItemsPage.cell(item.id, 'paymentStatus')).toHaveText(PAID);
    });
  });

  // TS03-TC08 steps 1–2 (company B's own file) are in payment-reconcile-files.spec.js
  test.describe('TS03-TC08 ตรวจสอบการตัด refCode ตาม code_digit_start / code_digit_end ของแต่ละ company', () => {
    test('บริษัทที่ตัด 10 หลัก ชำระเงินแล้ว', async ({ futureItemsPage }) => {
      for (const item of reconcile.paid) expect(item.refCode).toHaveLength(env.eodCompanies.dlt.refDigits);
      await futureItemsPage.expectPaymentStatus({ batchRef: reconcile.batchRef, items: reconcile.paid }, TODAY, PAID);
    });

    test('ref สั้นกว่าช่วงหลักที่ตัด ไม่ match', async ({ futureItemsPage }) => {
      const { shortRef } = readEodItems();
      await futureItemsPage.expectPaymentStatus(shortRef, TODAY, UNPAID);
    });
  });

  test.describe('TS03-TC09 ตรวจสอบไฟล์ KTB ของหลาย company', () => {
    test.beforeEach(() => {
      test.skip(!DLT_B_SET, 'DLT_B_* (second DLT company) not set in .env');
    });

    test('refCode ซ้ำกับบริษัทอื่น บริษัทเจ้าของไฟล์ชำระเงินแล้ว', async ({ futureItemsPage }) => {
      const { otherCompany } = readEodItems();
      await futureItemsPage.expectPaymentStatus(otherCompany.a, TODAY, PAID);
    });

    test.describe('บริษัท B', () => {
      test.use({ storageState: { cookies: [], origins: [] } });

      test('รายการของบริษัทอื่นในไฟล์นี้ ยังไม่ชำระเงิน', async ({ loginPage, futureItemsPage }) => {
        const { otherCompany } = readEodItems();
        await loginPage.loginAs(env.dltB.user, 'DLT_B_USER_EMAIL / DLT_B_USER_PASSWORD');
        await futureItemsPage.expectPaymentStatus(otherCompany.b, TODAY, UNPAID);
      });
    });
  });
});
