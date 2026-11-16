const { test, expect } = require('../fixtures');
const { NORMAL_STATE, TSD_STATE, DROPOFF_STATE, ADMIN_STATE } = require('../config/auth');
const { DateRangeField } = require('../pages/DateRangeField');
const { DashboardPage } = require('../pages/DashboardPage');
const { thaiDate, daysFromNow } = require('../helpers/thaiDate');

const day = (n) => thaiDate(daysFromNow(n));

/**
 * CPM-1845: with a range set, a new start date (typed or picked on the calendar) clears the end date; a new end date
 * keeps the start date
 */
async function expectNewStartClearsEnd(page, url, startLabel, endLabel) {
  await page.goto(url);
  const range = new DateRangeField(page, startLabel, endLabel);
  await expect(range.start).toBeVisible({ timeout: 30000 });

  await range.set(day(-3), day(0));
  await range.type(range.start, day(-2));
  await expect(range.start).toHaveValue(day(-2));
  await expect(range.end).toHaveValue('');

  await range.set(day(-3), day(0));
  // The calendar opens on the start date's month
  await range.pickStartDay(Number(day(-2).slice(0, 2)));
  await expect(range.start).toHaveValue(day(-2));
  await expect(range.end).toHaveValue('');

  await range.set(day(-3), day(0));
  await range.type(range.end, day(-1));
  await expect(range.start).toHaveValue(day(-3));
  await expect(range.end).toHaveValue(day(-1));
}

/** The same in รายงานข้อมูล's กำหนดเอง modal, which opens on the range in use: ยืนยัน waits for a new end date */
async function expectCustomRangeClearsEnd(page, url) {
  await page.goto(url);
  const d = new DashboardPage(page);
  await expect(d.dateFilter).toBeVisible({ timeout: 30000 });
  await d.pickDateOption('กำหนดเอง');
  const modal = d.customRangeModal();
  const range = new DateRangeField(page, modal.getByRole('textbox').first(), modal.getByRole('textbox').last());
  const confirm = modal.getByRole('button', { name: 'ยืนยัน' });
  await expect(range.end).not.toHaveValue('');

  await range.type(range.start, day(-5));
  await expect(range.end).toHaveValue('');
  await expect(confirm).toBeDisabled();
  await range.type(range.end, day(-2));
  await expect(confirm).toBeEnabled();
}

test.describe('Date range picker: เลือกวันที่เริ่มต้นใหม่ ล้างวันที่สิ้นสุด (CPM-1845)', () => {
  test.describe('User Portal user ปกติ', () => {
    test.use({ storageState: NORMAL_STATE });

    test.describe('TS06-TC02 user ปกติ ตรวจสอบการกรองรายการใบนำส่ง', () => {
      test('user ปกติ: วันที่สร้าง', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'orders', 'เลือกวันที่สร้างเริ่มต้น', 'เลือกวันที่สร้างสิ้นสุด');
      });
    });

    test.describe('TS09-TC02 user ปกติ ตรวจสอบการกรองใบสรุปยอด', () => {
      test('user ปกติ: วันที่ออกใบสรุปยอด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'payment-summaries', 'วันที่ออกใบสรุปยอดเริ่มต้น', 'วันที่ออกใบสรุปยอดสิ้นสุด');
      });
    });
  });

  test.describe('User Portal user TSD', () => {
    test.use({ storageState: TSD_STATE });

    test.describe('TS04-TC02 user TSD ตรวจสอบการกรองรายการฝากส่ง', () => {
      test('user TSD: วันที่ส่งออก', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'orders', 'เลือกวันที่ส่งออกเริ่มต้น', 'เลือกวันที่ส่งออกสิ้นสุด');
      });
    });

    test.describe('TS07-TC02 user TSD ตรวจสอบการกรองใบสรุปยอด', () => {
      test('user TSD: วันที่ส่งออก', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'payment-summaries', 'วันที่ส่งออกเริ่มต้น', 'วันที่ส่งออกสิ้นสุด');
      });

      test('user TSD: วันที่ออกใบสรุปยอด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'payment-summaries', 'วันที่ออกใบสรุปยอดเริ่มต้น', 'วันที่ออกใบสรุปยอดสิ้นสุด');
      });
    });

    test.describe('TS10-TC02 user TSD ตรวจสอบการแสดงผลข้อมูล', () => {
      test('user TSD: รายงานข้อมูล กำหนดเอง', async ({ page }) => {
        await expectCustomRangeClearsEnd(page, 'dashboard');
      });
    });
  });

  test.describe('Drop Off', () => {
    test.use({ storageState: DROPOFF_STATE });

    test.describe('TS04-TC02 Drop Off ตรวจสอบการกรองรายการใบนำส่ง', () => {
      test('Drop Off: วันที่สร้าง', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'dropoff/orders', 'เลือกวันที่สร้างเริ่มต้น', 'เลือกวันที่สร้างสิ้นสุด');
      });
    });

    test.describe('TS07-TC02 Drop Off ตรวจสอบการกรองใบสรุปยอด', () => {
      test('Drop Off: วันที่ออกใบสรุปยอด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'dropoff/payment-summaries', 'วันที่ออกใบสรุปยอดเริ่มต้น', 'วันที่ออกใบสรุปยอดสิ้นสุด');
      });
    });

    test.describe('TS07-TC03 Drop Off เจ้าหน้าที่สามารถสร้างใบสรุปยอด', () => {
      test('Drop Off: สร้างใบสรุปยอด วันที่ไปรษณีย์ได้รับ', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'dropoff/payment-summaries/create', 'จากวันที่ไปรษณีย์ได้รับ', 'ถึงวันที่ไปรษณีย์ได้รับ');
      });
    });

    test.describe('TS09-TC02 Drop Off ตรวจสอบการกรองใบสรุปยอด (กระทบยอด)', () => {
      test('Drop Off: วันที่ส่งออก', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'dropoff/payment-summary-settlements', 'วันที่ส่งออกเริ่มต้น', 'วันที่ส่งออกสิ้นสุด');
      });

      test('Drop Off: วันที่ออกใบสรุปยอด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'dropoff/payment-summary-settlements', 'วันที่ออกใบสรุปยอดเริ่มต้น', 'วันที่ออกใบสรุปยอดสิ้นสุด');
      });
    });
  });

  test.describe('Back Office', () => {
    test.use({ storageState: ADMIN_STATE });

    test.describe('TS05-TC02 Back Office ตรวจสอบการกรองรายการใบนำส่ง', () => {
      test('Back Office: วันที่สร้าง', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/orders', 'เลือกวันที่สร้างเริ่มต้น', 'เลือกวันที่สร้างสิ้นสุด');
      });
    });

    test.describe('TS06-TC07 Back Office ตรวจสอบการกรอง (บันทึกกิจกรรมใบนำส่ง)', () => {
      test('Back Office: ปรับปรุงข้อมูลล่าสุด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/orders/activity-log', 'ปรับปรุงข้อมูลล่าสุดเริ่มต้น', 'ปรับปรุงข้อมูลล่าสุดสิ้นสุด');
      });
    });

    test.describe('TS10-TC02 Back Office ตรวจสอบการกรองใบสรุปยอด', () => {
      test('Back Office: วันที่ออกใบสรุปยอด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/payment-summaries', 'วันที่ออกใบสรุปยอดเริ่มต้น', 'วันที่ออกใบสรุปยอดสิ้นสุด');
      });
    });

    test.describe('TS10-TC05 Back Office แอดมินสามารถสร้างใบสรุปยอด', () => {
      test('Back Office: สร้างใบสรุปยอด วันที่ไปรษณีย์ได้รับ', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/payment-summaries/create', 'จากวันที่ไปรษณีย์ได้รับ', 'ถึงวันที่ไปรษณีย์ได้รับ');
      });
    });

    test.describe('TS11-TC07 Back Office ตรวจสอบการกรอง (บันทึกกิจกรรมใบสรุปยอด)', () => {
      test('Back Office: ปรับปรุงข้อมูลล่าสุด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/payment-summaries/activity-log', 'ปรับปรุงข้อมูลล่าสุดเริ่มต้น', 'ปรับปรุงข้อมูลล่าสุดสิ้นสุด');
      });
    });

    test.describe('TS12-TC02 Back Office ตรวจสอบการกรองใบสรุปยอด (กระทบยอด)', () => {
      test('Back Office: วันที่ส่งออก', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/payment-summary-settlements', 'วันที่ส่งออกเริ่มต้น', 'วันที่ส่งออกสิ้นสุด');
      });

      test('Back Office: วันที่ออกใบสรุปยอด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/payment-summary-settlements', 'วันที่ออกใบสรุปยอดเริ่มต้น', 'วันที่ออกใบสรุปยอดสิ้นสุด');
      });
    });

    test.describe('TS13-TC07 Back Office ตรวจสอบการกรอง (บันทึกกิจกรรมใบกระทบยอด)', () => {
      test('Back Office: ปรับปรุงข้อมูลล่าสุด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/payment-summary-settlements/activity-log', 'ปรับปรุงข้อมูลล่าสุดเริ่มต้น', 'ปรับปรุงข้อมูลล่าสุดสิ้นสุด');
      });
    });

    test.describe('TS15-TC10 Back Office ตรวจสอบการกรอง (บันทึกกิจกรรมสาขา)', () => {
      test('Back Office: ปรับปรุงข้อมูลล่าสุด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/management/branches/activity-log', 'ปรับปรุงข้อมูลล่าสุดเริ่มต้น', 'ปรับปรุงข้อมูลล่าสุดสิ้นสุด');
      });
    });

    test.describe('TS16-TC10 Back Office ตรวจสอบการกรอง (บันทึกกิจกรรมบริษัท)', () => {
      test('Back Office: ปรับปรุงข้อมูลล่าสุด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/management/companies/activity-log', 'ปรับปรุงข้อมูลล่าสุดเริ่มต้น', 'ปรับปรุงข้อมูลล่าสุดสิ้นสุด');
      });
    });

    test.describe('TS18-TC15 Back Office ตรวจสอบการกรอง (บันทึกกิจกรรมผู้ใช้งานทั่วไป)', () => {
      test('Back Office: ปรับปรุงข้อมูลล่าสุด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/management/users/frontend/activity-log', 'ปรับปรุงข้อมูลล่าสุดเริ่มต้น', 'ปรับปรุงข้อมูลล่าสุดสิ้นสุด');
      });
    });

    test.describe('TS20-TC08 Back Office ตรวจสอบการกรอง (บันทึกกิจกรรมผู้ใช้งาน Drop off)', () => {
      test('Back Office: ปรับปรุงข้อมูลล่าสุด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/management/users/dropoff/activity-log', 'ปรับปรุงข้อมูลล่าสุดเริ่มต้น', 'ปรับปรุงข้อมูลล่าสุดสิ้นสุด');
      });
    });

    test.describe('Back Office บันทึกกิจกรรมผู้ใช้งาน Back Office (ไม่มี case ID ใน sheet)', () => {
      test('Back Office: ปรับปรุงข้อมูลล่าสุด', async ({ page }) => {
        await expectNewStartClearsEnd(page, 'backoffice/management/users/backoffice/activity-log', 'ปรับปรุงข้อมูลล่าสุดเริ่มต้น', 'ปรับปรุงข้อมูลล่าสุดสิ้นสุด');
      });
    });

    test.describe('Back Office รายงานข้อมูล กำหนดเอง (ไม่มี case ID ใน sheet)', () => {
      test('Back Office: รายงานข้อมูล กำหนดเอง', async ({ page }) => {
        await expectCustomRangeClearsEnd(page, 'backoffice/dashboard');
      });
    });
  });
});
