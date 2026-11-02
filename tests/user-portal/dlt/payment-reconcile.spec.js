/**
 * Payment reconcile from the bank EOD file — S3 folder → reconcile job (every 5 minutes on dev) → paymentStatus
 * Test cases: sheet "User Portal_DLT" > SCENARIO 3 (TS03-*)
 * Jira: CPM-1781
 *
 * Runs in the eod project: tests/eod.setup.js has already created the items, uploaded one EOD file and waited
 * for the job, so these tests only check the result. TS03-TC03 step 2 (item sent before the file starts
 * unpaid) is checked there too.
 * Not covered: TS03-TC04 / TC05 (invalid files, reference matching), TS03-TC06 (processing a file again).
 */
const { test, expect } = require('../../../fixtures');
const { buildPayload } = require('../../../helpers/futureItemsApi');
const { readEodItems } = require('../../../helpers/eodItems');
const { thaiDate } = require('../../../helpers/thaiDate');

const TODAY = thaiDate();
const PAID = 'ชำระเงินแล้ว';
const UNPAID = 'ยังไม่ชำระเงิน';

// One test at a time: dev API's DB pool is only 3 connections and returns 500 under concurrent load
test.describe.configure({ mode: 'default' });

test.describe('Payment reconcile (EOD file)', () => {
  /** Batch with 2 items in the EOD file and 1 left out of it */
  let reconcile;
  /** In the EOD file before its future item was sent */
  let earlyRefCode;

  test.beforeAll(() => {
    ({ groups: { reconcile }, earlyRefCode } = readEodItems());
  });

  test.describe('TS03-TC01 ระบบอัปเดตสถานะการชำระเงินเป็น "ชำระเงินแล้ว" - ref code ตรงกับไฟล์ EOD', () => {
    test('รายการที่อยู่ในไฟล์เป็นชำระเงินแล้ว และการ์ดยังไม่ชำระเงินนับเฉพาะรายการที่ไม่อยู่ในไฟล์', async ({ futureItemsPage }) => {
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
    test('รายการที่ไม่อยู่ในไฟล์ยังเป็นยังไม่ชำระเงิน แม้ไฟล์มี ref ที่ไม่มีในระบบ', async ({ futureItemsPage }) => {
      await futureItemsPage.openBatch(reconcile.batchRef, TODAY);
      await futureItemsPage.scrollGrid('end');

      for (const item of reconcile.unpaid) {
        await expect(futureItemsPage.cell(item.id, 'paymentStatus')).toHaveText(UNPAID);
      }
    });
  });

  test.describe('TS03-TC03 ตรวจสอบลำดับการมาของข้อมูล', () => {
    test('ไฟล์ EOD มาก่อน future item: สร้างแล้วได้ PAID ทันที', async ({ futureItemsApi, futureItemsPage }) => {
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
});
