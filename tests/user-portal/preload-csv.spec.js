const { test, expect } = require('../../fixtures');
const { openPortal, forUsers } = require('../../helpers/portal');
const { CSV_USERS, preloadRows, preloadCsv, pricedItem, serviceLabel } = require('../../helpers/preloadCsv');
const { BackOfficeApi } = require('../../helpers/backOfficeApi');
const { expectedSummary, bySummaryKey, baht } = require('../../helpers/pricing');
const { uniqueBatchRef } = require('../../helpers/futureItemsApi');
const { readDownload, parseCsv, countBy } = require('../../helpers/orderData');
const { thaiDate } = require('../../helpers/thaiDate');

const TEMPLATE_COLUMNS = ['ID', 'รหัสบริการ', 'สินค้า', 'ชื่อผู้รับ', 'ที่อยู่', 'รหัสไปรษณีย์', 'ประเทศ', 'เบอร์ติดต่อ', 'อีเมล',
  'น้ำหนักต่อชิ้น (กรัม)', 'ประกันภัย', 'มูลค่าประกัน', 'หมายเลขติดตามพัสดุ', 'หมายเลขอ้างอิง 1', 'หมายเลขอ้างอิง 2'];
const EXPORT_COLUMNS = ['ID', 'ประเภทการขนส่ง', 'บริการ', 'บริการ e-AR', 'สินค้า', 'ชื่อผู้รับ', 'ที่อยู่', 'ประเทศ', 'รหัสไปรษณีย์',
  'เบอร์ติดต่อ', 'อีเมล', 'หมายเลขติดตามพัสดุ', 'น้ำหนักต่อชิ้น (กรัม)', 'ประกันภัย', 'มูลค่าประกัน', 'หมายเลขอ้างอิง 1', 'หมายเลขอ้างอิง 2'];

const NORMAL_USER = { ...CSV_USERS[0], templateColumns: TEMPLATE_COLUMNS, exportColumns: EXPORT_COLUMNS };
const TSD_USER = {
  ...CSV_USERS[1],
  templateColumns: [...TEMPLATE_COLUMNS, 'ราคาต่อชิ้น', 'รูปแบบซอง'],
  exportColumns: [...EXPORT_COLUMNS, 'ราคาต่อชิ้น', 'หมายเหตุ'],
};

// Tracking numbers last preloaded / received long ago (sheet test data), so they may be used again
const EXPIRED_PRELOAD = { code: 'MAIL-STD-PLS', trackingNumber: 'DY000001023TH' };
const EXPIRED_DROP_OFF = { code: 'EMS-STD', trackingNumber: 'JZ000002182TH' };

const INVALID_EMAIL = (row) => { row['อีเมล'] = 'not-an-email'; };
const INVALID_COUNTRY = (row) => { row['ประเทศ'] = 'NOWHERELAND'; row['รหัสไปรษณีย์'] = '99999'; };
// Ordinary mail has no international service
const NORMAL_MAIL_ABROAD = (row) => { row['รหัสบริการ'] = 'MAIL-STD'; row['ประเทศ'] = 'JAPAN'; row['รหัสไปรษณีย์'] = '99999'; };

// One broken row each; the sheet's "ไฟล์มีข้อมูลไม่ถูกต้อง" list for both users (country per user below; email is not checked)
const INVALID_ROWS = {
  'หมายเลขติดตามผิดรูปแบบ': (row) => { row['หมายเลขติดตามพัสดุ'] = 'ABC123'; },
  'ไม่กรอกรหัสไปรษณีย์ (ในประเทศ)': (row) => { row['รหัสไปรษณีย์'] = ''; },
  'ไม่กรอกรหัสไปรษณีย์ (ต่างประเทศ)': (row) => { row['ประเทศ'] = 'JAPAN'; row['รหัสไปรษณีย์'] = ''; },
  'น้ำหนักไม่ใช่ตัวเลข': (row) => { row['น้ำหนักต่อชิ้น (กรัม)'] = 'abc'; },
  'มูลค่าประกันไม่ใช่ตัวเลข': (row) => { row['ประกันภัย'] = 'Y'; row['มูลค่าประกัน'] = 'abc'; },
  'ไม่กรอกชื่อผู้รับ': (row) => { row['ชื่อผู้รับ'] = ''; },
  'ไม่กรอกที่อยู่': (row) => { row['ที่อยู่'] = ''; },
  'รหัสบริการไม่มีในระบบ': (row) => { row['รหัสบริการ'] = 'MAIL-XXX'; },
};

// The template with one change to its header row
const INVALID_TEMPLATES = {
  'ชื่อคอลัมน์ไม่ตรง': (header, cells) => [header.map((h) => (h === 'ชื่อผู้รับ' ? 'ชื่อ' : h)), cells],
  'คอลัมน์เกิน': (header, cells) => [[...header, 'คอลัมน์เกิน'], cells.map((c) => [...c, 'x'])],
  'คอลัมน์ซ้ำ': (header, cells) => [[...header, 'ชื่อผู้รับ'], cells.map((c) => [...c, c[header.indexOf('ชื่อผู้รับ')]])],
};

// Tracking number prefixes by Thai Post type, in Thailand / abroad
const PREFIXES = { NORMAL: /^D[YZ]\d{9}TH$/, REGISTERED: /^BZ\d{9}TH$/, EMS: /^JZ\d{9}TH$/ };
const ABROAD_PREFIXES = { REGISTERED: /^RQ\d{9}TH$/, EMS: /^EE\d{9}TH$/ };

const AREAS = ['กรุงเทพมหานคร', 'ต่างจังหวัด', 'ต่างประเทศ'];
const areaOf = (item) => (item.country ? 'ต่างประเทศ' : /^1[0-2]/.test(item.postalCode) ? 'กรุงเทพมหานคร' : 'ต่างจังหวัด');


// The service code of a tracking number's type, so a reused number is checked against its own kind of service
const CODE_BY_PREFIX = { DY: 'MAIL-STD-PLS', DZ: 'MAIL-STD-PLS', BZ: 'MAIL-R', JZ: 'EMS-STD' };

/** CSV text from a header and rows of cells, like the template (BOM, comma separated) */
const rawCsv = (header, rows) => Buffer.from(`﻿${[header, ...rows].map((cells) => cells.join(',')).join('\n')}\n`, 'utf8');


const forBothUsers = (browser, body) => forUsers(browser, [NORMAL_USER, TSD_USER], body);

/** The template's rows turned into valid rows of one domestic registered item each */
async function validRows(preloadPage, count) {
  const template = parseCsv(await readDownload(await preloadPage.downloadTemplate()));
  const row = preloadRows(template, uniqueBatchRef()).find((r) => r['รหัสบริการ'] === 'MAIL-R');
  return Array.from({ length: count }, (_, i) => ({ ...row, ID: String(i + 1), 'ประเทศ': '', 'รหัสไปรษณีย์': '10110' }));
}

async function expectInvalid(preloadPage, { invalid, valid }) {
  await expect(preloadPage.checkResult).toHaveText(`ไม่สามารถดำเนินการต่อได้ เนื่องจากพบข้อมูลไม่ถูกต้อง ${invalid} รายการ`);
  await expect(preloadPage.itemCount).toHaveText(`${valid} ชิ้น`);
  await expect(preloadPage.primaryButton).toHaveText('เลือกไฟล์ CSV ใหม่');
}

/**
 * A tracking number of `order` (preloaded just now) and one of an order of the same company received at drop off,
 * each of a kind CODE_BY_PREFIX knows
 */
async function recentTrackingNumbers({ page, orderDetailPage: d }, backOffice, order) {
  const { companyId } = await backOffice.order(order.id);
  const droppedOff = (await backOffice.get('orders?page=1&perPage=50'))
    .find((o) => o.company.id === companyId && o.status === 'DROPPED_OFF' && o.totalDroppedOffOrderItems > 0);
  expect(droppedOff, 'an order of this company received at drop off (run the drop-off specs first)').toBeTruthy();
  await page.goto(`orders/${droppedOff.id}`);
  const received = parseCsv(await readDownload(await d.download(d.csvButton)));
  const reusable = (trackingNumbers) => trackingNumbers.find((t) => CODE_BY_PREFIX[t?.slice(0, 2)]);
  return [reusable(order.items.map((item) => item.trackingNumber)), reusable(received.map((row) => row['หมายเลขติดตามพัสดุ']))];
}

/** Checks a file of two valid rows, the second with `trackingNumber` */
async function uploadWithTrackingNumber(preloadPage, trackingNumber) {
  await preloadPage.goto();
  const rows = await validRows(preloadPage, 2);
  Object.assign(rows[1], { 'รหัสบริการ': CODE_BY_PREFIX[trackingNumber.slice(0, 2)], 'หมายเลขติดตามพัสดุ': trackingNumber });
  await preloadPage.check(preloadCsv(rows));
}

/** Uploads one item per service code (some to rural areas) and goes on to the summary step; returns what the order is made of */
async function uploadAllServiceCodes(preloadPage, fees) {
  await preloadPage.goto();
  const template = parseCsv(await readDownload(await preloadPage.downloadTemplate()));
  const reference = uniqueBatchRef();
  const rows = preloadRows(template, reference, { ruralAreas: fees.rural.areas });
  await preloadPage.upload(preloadCsv(rows));
  await expect(preloadPage.itemCount).toHaveText(`${rows.length} ชิ้น`);
  await preloadPage.primaryButton.click();
  const sender = {};
  for (const label of ['ผู้ฝากส่ง', 'ชื่อผู้ติดต่อ', 'อีเมลติดต่อ', 'เบอร์ติดต่อ']) sender[label] = await preloadPage.field(label).innerText();
  return { reference, rows, sender };
}

/** ยืนยัน → the modal shows the item count; ยกเลิก closes it, ยืนยัน again creates the order. Returns { id, number } */
async function confirmOrder(page, preloadPage, itemCount) {
  await preloadPage.primaryButton.click();
  await expect(preloadPage.confirmDialog).toContainText(`จำนวนชิ้นที่ฝากส่ง${itemCount} ชิ้น`);
  await preloadPage.confirmDialog.getByRole('button', { name: 'ยกเลิก' }).click();
  await expect(preloadPage.confirmDialog).toBeHidden();
  await expect(preloadPage.orderTitle).toBeHidden();

  await preloadPage.primaryButton.click();
  await preloadPage.confirmDialog.getByRole('button', { name: 'ยืนยัน' }).click();
  await expect(preloadPage.toast).toContainText('สร้างรายการฝากส่งสำเร็จ', { timeout: 30000 });
  await expect(preloadPage.orderTitle).toBeVisible({ timeout: 30000 });
  const number = (await preloadPage.orderTitle.innerText()).replace('หมายเลขใบนำส่ง : ', '');
  return { id: page.url().match(/orders\/(\d+)/)[1], number };
}

/** Opens the order once it is created; checks what both users' detail pages show */
async function expectOrderDetail(page, d, user, order) {
  await expect(async () => {
    await page.goto(`orders/${order.id}`);
    await expect(d.field('สถานะการฝากส่ง')).toHaveText(user.createdStatus, { timeout: 2000 });
  }).toPass({ timeout: 60000 });
  await expect(d.title).toHaveText(`หมายเลขใบนำส่ง : ${order.number}`);
  await expect(d.field('วันที่/เวลาที่ปณ.ได้รับ')).toHaveText('-');
  for (const [label, value] of Object.entries(order.sender)) await expect(d.field(label)).toHaveText(value);
  await expect(d.field('เตรียมฝากส่ง')).toHaveText(`${order.rows.length} ชิ้น`);
  await expect(d.field('ราคารวมทั้งหมด')).toHaveText(/ บาท$/);
  await expect(d.serviceTable).toBeVisible();
  await expect(page.getByText('หมายเหตุ: ราคารวมคำนวณ ณ วันที่ฝากส่ง', { exact: true })).toBeVisible();
  for (const button of [d.csvButton, d.deliveryNoteButton, d.labelButton]) await expect(button).toBeVisible();
}

// Case IDs: "User Portal_main" SCENARIO 5 (TS05, user ปกติ) / "User Portal_TSD" SCENARIO 3 (TS03, user TSD)
test.describe('เตรียมการฝากส่งด้วยไฟล์ CSV', () => {
  test.describe('TS05-TC01 user ปกติ / TS03-TC01 user TSD ผู้ใช้งานสามารถเห็นหน้า "เตรียมการฝากส่ง"', () => {
    test('user ปกติ / user TSD: เข้าจากเมนูด้านบน แสดงขั้นตอนและการนำเข้าจากไฟล์ CSV', async ({ browser }) => {
      await forBothUsers(browser, async (user, { page, preloadPage }) => {
        await page.goto('');
        await preloadPage.menuLink('เตรียมการฝากส่ง').click();
        await expect(preloadPage.title).toBeVisible();
        await expect(preloadPage.subtitle).toBeVisible();
        for (const step of ['เลือกวิธีการ นำเข้าข้อมูล', 'ตรวจสอบ ข้อมูลการฝากส่ง', 'สรุปข้อมูล การฝากส่ง']) {
          await expect(page.getByText(step, { exact: true })).toBeVisible();
        }
        await expect(preloadPage.importHeading).toBeVisible();
        await expect(preloadPage.sizeHint).toBeVisible();
        await expect(preloadPage.templateLink).toBeVisible();
      });
    });
  });

  test.describe('TS05-TC01 user ปกติ / TS03-TC02 user TSD ดาวน์โหลดตัวอย่างไฟล์ CSV', () => {
    test('user ปกติ / user TSD: ได้ไฟล์ template พร้อมคอลัมน์ครบ (TSD มีราคาต่อชิ้นและรูปแบบซองเพิ่ม)', async ({ browser }) => {
      await forBothUsers(browser, async (user, { preloadPage }) => {
        await preloadPage.goto();
        const download = await preloadPage.downloadTemplate();
        await expect(preloadPage.toast).toHaveText('ดาวน์โหลดสำเร็จ');
        expect(download.suggestedFilename()).toBe('template.csv');
        const header = (await readDownload(download)).toString('utf8').replace(/^﻿/, '').split(/\r?\n/)[0].split(',');
        expect(header).toEqual(user.templateColumns);
      });
    });
  });

  test.describe('TS05-TC02 user ปกติ / TS03-TC03 user TSD ผู้ใช้งานสามารถอัพโหลดไฟล์ CSV', () => {
    test('user ปกติ / user TSD: ระหว่างตรวจสอบไฟล์ แสดง loading', async ({ browser }) => {
      await forBothUsers(browser, async (user, { page, preloadPage }) => {
        await preloadPage.goto();
        const rows = await validRows(preloadPage, 1);
        // Holds the check so its loading state can be seen
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        await page.route('**/preloads/validate', async (route) => { await held; await route.continue(); });
        await preloadPage.fileInput.setInputFiles({ name: 'preload.csv', mimeType: 'text/csv', buffer: preloadCsv(rows) });
        await expect(preloadPage.loading).toBeVisible();
        release();
        await expect(preloadPage.validResult).toBeVisible({ timeout: 30000 });
        await expect(preloadPage.loading).toBeHidden();
      });
    });
  });

  test.describe('TS05-TC03 user ปกติ / TS03-TC04 user TSD ตรวจสอบไฟล์ CSV ที่มีข้อมูลผิดพลาด', () => {
    test('user ปกติ / user TSD: ไฟล์ใหญ่เกิน 10 MB แสดงข้อความแจ้ง', async ({ browser }) => {
      await forBothUsers(browser, async (user, { preloadPage }) => {
        await preloadPage.goto();
        const rows = await validRows(preloadPage, 1);
        const big = Buffer.concat([preloadCsv(rows), Buffer.alloc(10.5 * 1024 * 1024, ' ')]);
        await preloadPage.fileInput.setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: big });
        await expect(preloadPage.sizeError).toBeVisible();
        await expect(preloadPage.checkHeading).toBeHidden();
      });
    });

    test('user ปกติ / user TSD: ไฟล์ที่ไม่ใช่ CSV แสดง toast นำเข้าไฟล์ไม่สำเร็จ', async ({ browser }) => {
      await forBothUsers(browser, async (user, { preloadPage }) => {
        await preloadPage.goto();
        await preloadPage.fileInput.setInputFiles({ name: 'preload.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
        await expect(preloadPage.toast).toHaveText(/^นำเข้าไฟล์ไม่สำเร็จ\s*เนื่องจากขนาดไฟล์ใหญ่เกินไปหรือประเภทไฟล์\s*ไม่ถูกต้องกรุณาลองใหม่$/);
        await expect(preloadPage.checkHeading).toBeHidden();
      });
    });

    for (const [name, breakRow] of Object.entries(INVALID_ROWS)) {
      test(`user ปกติ / user TSD: ข้อมูลไม่ถูกต้อง - ${name}`, async ({ browser }) => {
        await forBothUsers(browser, async (user, { preloadPage }) => {
          await preloadPage.goto();
          const rows = await validRows(preloadPage, 3);
          breakRow(rows[2]);
          await preloadPage.check(preloadCsv(rows));
          await expectInvalid(preloadPage, { invalid: 1, valid: 2 });
        });
      });
    }

    for (const [name, change] of Object.entries(INVALID_TEMPLATES)) {
      test(`user ปกติ / user TSD: เทมเพลทไม่ถูกต้อง - ${name}`, async ({ browser }) => {
        await forBothUsers(browser, async (user, { preloadPage }) => {
          await preloadPage.goto();
          const rows = await validRows(preloadPage, 2);
          const header = Object.keys(rows[0]);
          await preloadPage.check(rawCsv(...change(header, rows.map((r) => header.map((h) => r[h])))));
          await expect(preloadPage.checkResult).toHaveText('ไม่สามารถดำเนินการต่อได้ เนื่องจากเทมเพลทข้อมูลไม่ถูกต้อง');
          await expect(preloadPage.itemCount).toHaveText('0 ชิ้น');
          await expect(preloadPage.serviceGrid).toContainText('ไม่พบข้อมูล');
        });
      });
    }

    test('user ปกติ / user TSD: อีเมลผิดรูปแบบ ไม่ตรวจ ผ่านการตรวจสอบ', async ({ browser }) => {
      await forBothUsers(browser, async (user, { preloadPage }) => {
        await preloadPage.goto();
        const rows = await validRows(preloadPage, 2);
        INVALID_EMAIL(rows[1]);
        await preloadPage.check(preloadCsv(rows));
        await expect(preloadPage.validResult).toBeVisible();
        await expect(preloadPage.itemCount).toHaveText('2 ชิ้น');
      });
    });

    test('user ปกติ / user TSD: ยกเลิก / ย้อนกลับ กลับไปหน้าเลือกวิธีนำเข้า, เลือกไฟล์ CSV ใหม่ แล้วตรวจสอบไฟล์ใหม่', async ({ browser }) => {
      await forBothUsers(browser, async (user, { page, preloadPage }) => {
        await preloadPage.goto();
        const rows = await validRows(preloadPage, 2);
        const broken = rows.map((r) => ({ ...r }));
        broken[1]['ชื่อผู้รับ'] = '';

        for (const button of [preloadPage.cancelButton, preloadPage.backButton]) {
          await preloadPage.check(preloadCsv(broken));
          await button.click();
          await expect(preloadPage.importHeading).toBeVisible();
          await expect(preloadPage.checkHeading).toBeHidden();
        }

        await preloadPage.check(preloadCsv(broken));
        await expectInvalid(preloadPage, { invalid: 1, valid: 1 });
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), preloadPage.primaryButton.click()]);
        await chooser.setFiles({ name: 'fixed.csv', mimeType: 'text/csv', buffer: preloadCsv(rows) });
        await expect(preloadPage.validResult).toBeVisible({ timeout: 30000 });
        await expect(preloadPage.itemCount).toHaveText('2 ชิ้น');
      });
    });
  });

  test.describe('TS05-TC03 user ปกติ ตรวจสอบไฟล์ CSV ที่มีข้อมูลผิดพลาด (เฉพาะ user ปกติ)', () => {
    test('user ปกติ: ข้อมูลไม่ถูกต้อง - ชื่อประเทศผิด', async ({ browser }) => {
      const portal = await openPortal(browser, NORMAL_USER.state);
      const { preloadPage } = portal;
      await preloadPage.goto();
      const rows = await validRows(preloadPage, 3);
      INVALID_COUNTRY(rows[2]);
      await preloadPage.check(preloadCsv(rows));
      await expectInvalid(preloadPage, { invalid: 1, valid: 2 });
      await portal.close();
    });

    test('user ปกติ: ข้อมูลไม่ถูกต้อง - บริการธรรมดาส่งไปต่างประเทศ', async ({ browser }) => {
      const portal = await openPortal(browser, NORMAL_USER.state);
      const { preloadPage } = portal;
      await preloadPage.goto();
      const rows = await validRows(preloadPage, 3);
      NORMAL_MAIL_ABROAD(rows[2]);
      await preloadPage.check(preloadCsv(rows));
      await expectInvalid(preloadPage, { invalid: 1, valid: 2 });
      await portal.close();
    });
  });

  test.describe('TS03-TC04 user TSD ตรวจสอบไฟล์ CSV ที่มีข้อมูลผิดพลาด (เฉพาะ TSD)', () => {
    test('user TSD: ชื่อประเทศผิดปนกับรายการที่ถูก ตัดรายการที่ผิดออก นำเข้าเฉพาะรายการที่ถูก', async ({ browser }) => {
      const portal = await openPortal(browser, TSD_USER.state);
      const { preloadPage } = portal;
      await preloadPage.goto();
      const rows = await validRows(preloadPage, 3);
      INVALID_COUNTRY(rows[2]);
      await preloadPage.check(preloadCsv(rows));
      await expect(preloadPage.validResult).toBeVisible();
      await expect(preloadPage.itemCount).toHaveText('2 ชิ้น');
      await portal.close();
    });

    test('user TSD: ชื่อประเทศผิดทุกรายการ แสดงพบข้อมูลไม่ถูกต้อง เหมือน user ปกติ', async ({ browser }) => {
      const portal = await openPortal(browser, TSD_USER.state);
      const { preloadPage } = portal;
      await preloadPage.goto();
      const rows = await validRows(preloadPage, 2);
      rows.forEach(INVALID_COUNTRY);
      await preloadPage.check(preloadCsv(rows));
      await expectInvalid(preloadPage, { invalid: 2, valid: 0 });
      await portal.close();
    });

    test('user TSD: บริการธรรมดาส่งไปต่างประเทศปนกับรายการที่ถูก ตัดรายการที่ผิดออก นำเข้าเฉพาะรายการที่ถูก', async ({ browser }) => {
      const portal = await openPortal(browser, TSD_USER.state);
      const { preloadPage } = portal;
      await preloadPage.goto();
      const rows = await validRows(preloadPage, 3);
      NORMAL_MAIL_ABROAD(rows[2]);
      await preloadPage.check(preloadCsv(rows));
      await expect(preloadPage.validResult).toBeVisible();
      await expect(preloadPage.itemCount).toHaveText('2 ชิ้น');
      await portal.close();
    });

    test('user TSD: บริการธรรมดาส่งไปต่างประเทศทุกรายการ แสดงพบข้อมูลไม่ถูกต้อง เหมือน user ปกติ', async ({ browser }) => {
      const portal = await openPortal(browser, TSD_USER.state);
      const { preloadPage } = portal;
      await preloadPage.goto();
      const rows = await validRows(preloadPage, 2);
      rows.forEach(NORMAL_MAIL_ABROAD);
      await preloadPage.check(preloadCsv(rows));
      await expectInvalid(preloadPage, { invalid: 2, valid: 0 });
      await portal.close();
    });


    test('user TSD: ข้อมูลไม่ถูกต้อง - ราคาต่อชิ้นไม่ใช่ตัวเลข', async ({ browser }) => {
      const portal = await openPortal(browser, TSD_USER.state);
      const { preloadPage } = portal;
      await preloadPage.goto();
      const rows = await validRows(preloadPage, 3);
      rows[2]['ราคาต่อชิ้น'] = 'abc';
      await preloadPage.check(preloadCsv(rows));
      await expectInvalid(preloadPage, { invalid: 1, valid: 2 });
      await portal.close();
    });
  });

  test.describe('TS05-TC04 user ปกติ / TS03-TC05 user TSD ตรวจสอบข้อมูลนำเข้า', () => {
    test('user ปกติ / user TSD: หมายเลขติดตามที่ preload เกิน 45 วัน และรับฝากเกิน 6 เดือน นำมาใช้ใหม่ได้', async ({ browser }) => {
      await forBothUsers(browser, async (user, { preloadPage }) => {
        await preloadPage.goto();
        const rows = await validRows(preloadPage, 2);
        [EXPIRED_PRELOAD, EXPIRED_DROP_OFF].forEach(({ code, trackingNumber }, i) => {
          Object.assign(rows[i], { 'รหัสบริการ': code, 'หมายเลขติดตามพัสดุ': trackingNumber });
        });
        await preloadPage.check(preloadCsv(rows));
        await expect(preloadPage.validResult).toBeVisible();
        await expect(preloadPage.itemCount).toHaveText('2 ชิ้น');
      });
    });

    test('user ปกติ: ข้อมูลถูกต้องทั้งหมด ถัดไปแสดงรายละเอียดผู้ฝากส่งและช่องหมายเลขอ้างอิง', async ({ browser }) => {
      const portal = await openPortal(browser, NORMAL_USER.state);
      const { page, preloadPage } = portal;
      await preloadPage.goto();
      await preloadPage.upload(preloadCsv(await validRows(preloadPage, 2)));
      await expect(preloadPage.primaryButton).toHaveText('ถัดไป');
      await preloadPage.primaryButton.click();
      await expect(page.getByText('รายละเอียดผู้ฝากส่ง', { exact: true })).toBeVisible();
      for (const label of ['ผู้ฝากส่ง', 'ที่อยู่ผู้ฝากส่ง', 'ชื่อผู้ติดต่อ', 'อีเมลติดต่อ', 'เบอร์ติดต่อ']) {
        await expect(preloadPage.field(label)).not.toBeEmpty();
      }
      await expect(preloadPage.validResult).toBeVisible();
      await expect(preloadPage.referenceInput).toBeVisible();
      await expect(preloadPage.exportDateButton).toBeHidden();
      await expect(preloadPage.primaryButton).toHaveText('ยืนยัน');
      await portal.close();
    });

    test('user TSD: ข้อมูลถูกต้องทั้งหมด ถัดไปแสดงรายละเอียดผู้ฝากส่ง และช่องวันส่งออก ประเภทเอกสาร ชื่อรายการ หมายเลขอ้างอิง', async ({ browser }) => {
      const portal = await openPortal(browser, TSD_USER.state);
      const { page, preloadPage } = portal;
      await preloadPage.goto();
      await preloadPage.upload(preloadCsv(await validRows(preloadPage, 2)));
      await expect(preloadPage.primaryButton).toHaveText('ถัดไป');
      await preloadPage.primaryButton.click();
      await expect(page.getByText('รายละเอียดผู้ฝากส่ง', { exact: true })).toBeVisible();
      for (const label of ['ผู้ฝากส่ง', 'ที่อยู่ผู้ฝากส่ง', 'ชื่อผู้ติดต่อ', 'อีเมลติดต่อ', 'เบอร์ติดต่อ']) {
        await expect(preloadPage.field(label)).not.toBeEmpty();
      }
      await expect(preloadPage.validResult).toBeVisible();
      for (const input of [preloadPage.exportDateButton, preloadPage.documentTypeInput, preloadPage.orderNameInput, preloadPage.referenceInput]) {
        await expect(input).toBeVisible();
      }
      await expect(preloadPage.primaryButton).toHaveText('ยืนยัน');
      await portal.close();
    });
  });

  test.describe('TS03-TC06 user TSD ตรวจสอบการกรอกข้อมูลเพิ่มเติม', () => {
    test('user TSD: ไม่กรอกข้อมูลแล้วกดยืนยัน แสดงข้อความแจ้งเตือนทุกช่อง', async ({ browser }) => {
      const portal = await openPortal(browser, TSD_USER.state);
      const { preloadPage } = portal;
      await preloadPage.goto();
      await preloadPage.upload(preloadCsv(await validRows(preloadPage, 1)));
      await preloadPage.primaryButton.click();
      await preloadPage.primaryButton.click();
      for (const message of ['กรุณาเลือกวันที่/เวลาส่งออก', 'กรุณากรอกประเภทเอกสาร', 'กรุณากรอกชื่อรายการ', 'กรุณากรอกหมายเลขอ้างอิง']) {
        await expect(preloadPage.requiredError(message)).toBeVisible();
      }
      await expect(preloadPage.confirmDialog).toBeHidden();
      await portal.close();
    });
  });

  // One order per user for the confirm, detail, download, price and reuse cases, which run in this order
  test.describe('ใบนำส่งที่สร้างจากไฟล์ CSV (ใช้ใบเดียวกัน รันตามลำดับ)', () => {
    test.describe.configure({ mode: 'serial' });
    let backOffice;
    let fees;
    const orders = {};

    test.beforeAll(async ({ browser }) => {
      backOffice = await BackOfficeApi.open(browser);
      fees = await backOffice.fees();
    });

    test.afterAll(async () => {
      await backOffice?.close();
    });

    test.describe('TS05-TC05 user ปกติ / TS03-TC07 user TSD ตรวจสอบการยืนยันการฝากส่ง', () => {
      test('user ปกติ: ไม่กรอกหมายเลขอ้างอิงแล้วยืนยัน สร้างใบนำส่งสำเร็จ', async ({ browser }) => {
        test.slow();
        const portal = await openPortal(browser, NORMAL_USER.state);
        const { page, preloadPage } = portal;
        const { rows, sender } = await uploadAllServiceCodes(preloadPage, fees);
        await expect(preloadPage.referenceInput).toBeEmpty();
        const { id, number } = await confirmOrder(page, preloadPage, rows.length);
        orders[NORMAL_USER.name] = { id, number, rows, sender };
        await portal.close();
      });

      test('user TSD: กรอกวันส่งออก ประเภทเอกสาร ชื่อรายการ หมายเลขอ้างอิงแล้วยืนยัน สร้างใบนำส่งสำเร็จ', async ({ browser }) => {
        test.slow();
        const portal = await openPortal(browser, TSD_USER.state);
        const { page, preloadPage } = portal;
        const { reference, rows, sender } = await uploadAllServiceCodes(preloadPage, fees);
        const extra = { 'ประเภทเอกสาร': 'AUTO เอกสาร', 'ชื่อรายการ': reference.replace('AUTO_', 'Automate_'), 'หมายเลขอ้างอิง': reference };
        const exportDate = await preloadPage.pickExportDate();
        await preloadPage.documentTypeInput.fill(extra['ประเภทเอกสาร']);
        await preloadPage.orderNameInput.fill(extra['ชื่อรายการ']);
        await preloadPage.referenceInput.fill(extra['หมายเลขอ้างอิง']);
        const { id, number } = await confirmOrder(page, preloadPage, rows.length);
        orders[TSD_USER.name] = { id, number, rows, sender, extra, exportDate };
        await portal.close();
      });
    });

    test.describe('TS05-TC06 user ปกติ / TS03-TC08 user TSD ตรวจสอบหน้ารายละเอียดการฝากส่ง', () => {
      test('user ปกติ: สถานะสร้างแล้ว แสดงวันที่สร้าง รายละเอียดผู้ฝากส่ง สรุปข้อมูล และปุ่มดาวน์โหลดเอกสาร', async ({ browser }) => {
        const portal = await openPortal(browser, NORMAL_USER.state);
        const { page, orderDetailPage: d } = portal;
        const order = orders[NORMAL_USER.name];
        await expectOrderDetail(page, d, NORMAL_USER, order);
        await expect(d.field('วันที่/เวลาที่สร้าง')).toHaveText(/^\d{2}\/\d{2}\/\d{4} - \d{2}:\d{2}$/);
        await portal.close();
      });

      test('user TSD: สถานะส่งออกแล้ว แสดงวันส่งออก ประเภทเอกสาร ชื่อรายการ หมายเลขอ้างอิง รายละเอียดผู้ฝากส่ง สรุปข้อมูล และปุ่มดาวน์โหลดเอกสาร', async ({ browser }) => {
        const portal = await openPortal(browser, TSD_USER.state);
        const { page, orderDetailPage: d } = portal;
        const order = orders[TSD_USER.name];
        await expectOrderDetail(page, d, TSD_USER, order);
        await expect(d.field('วันที่/เวลาส่งออก')).toHaveText(order.exportDate);
        for (const [label, value] of Object.entries(order.extra)) await expect(d.field(label)).toHaveText(value);
        await portal.close();
      });
    });

    test.describe('TS05-TC07 user ปกติ / TS03-TC09 user TSD ตรวจสอบการดาวน์โหลดข้อมูล CSV', () => {
      test('user ปกติ / user TSD: หนึ่งพัสดุต่อหนึ่งแถว คอลัมน์ครบ (TSD มีราคาต่อชิ้นและหมายเหตุเพิ่ม) หมายเลขติดตามตามประเภทบริการ', async ({ browser }) => {
        await forBothUsers(browser, async (user, { page, orderDetailPage: d }) => {
          const order = orders[user.name];
          await page.goto(`orders/${order.id}`);
          const download = await d.download(d.csvButton);
          await expect(page.getByRole('alert').and(page.locator('.MuiAlert-root'))).toHaveText('ดาวน์โหลดสำเร็จ');
          expect(download.suggestedFilename()).toMatch(new RegExp(`^\\d{8}-[A-Z]{3}-export-${order.number}\\.csv$`));
          const buffer = await readDownload(download);
          expect(buffer.toString('utf8').replace(/^﻿/, '').split(/\r?\n/)[0].split(',')).toEqual(user.exportColumns);
          const exported = parseCsv(buffer);
          expect(exported.map((row) => row.ID).sort()).toEqual(order.rows.map((row) => row.ID).sort());

          order.items = order.rows.map((row) => {
            const line = exported.find((e) => e.ID === row.ID);
            expect.soft(line['ชื่อผู้รับ'], `ID ${row.ID}`).toBe(row['ชื่อผู้รับ']);
            return { ...pricedItem(row), trackingNumber: line['หมายเลขติดตามพัสดุ'] };
          });
          for (const item of order.items) {
            const label = `${item.type} ${item.service}${item.country ? ` ${item.country}` : ''}`;
            if (item.type === 'NORMAL' && item.service.startsWith('LITE')) expect.soft(item.trackingNumber, label).toBe('');
            else expect.soft(item.trackingNumber, label).toMatch(item.country ? ABROAD_PREFIXES[item.type] : PREFIXES[item.type]);
          }
        });
      });
    });

    test.describe('TS05-TC08 user ปกติ / TS03-TC09 user TSD ตรวจสอบการดาวน์โหลดข้อมูล PDF', () => {
      test('user ปกติ / user TSD: ดาวน์โหลดใบนำส่ง และเอกสารจ่าหน้าซอง C6 / DL ได้', async ({ browser }) => {
        await forBothUsers(browser, async (user, { page, orderDetailPage: d }) => {
          const order = orders[user.name];
          const toast = page.getByRole('alert').and(page.locator('.MuiAlert-root'));
          // The PDFs are made after the order is created
          await expect(async () => {
            await page.goto(`orders/${order.id}`);
            await expect(d.deliveryNoteButton).toBeEnabled({ timeout: 2000 });
            await expect(d.labelButton).toBeEnabled({ timeout: 2000 });
          }).toPass({ timeout: 120000 });

          const note = await d.download(d.deliveryNoteButton);
          await expect(toast).toHaveText('ดาวน์โหลดสำเร็จ');
          expect(note.suggestedFilename()).toMatch(/^\d{8}-[A-Z]{3}-delivery-note\.pdf$/);
          expect((await readDownload(note)).subarray(0, 5).toString()).toBe('%PDF-');

          for (const [size, label] of [['C6', 'ซอง C6 (ขนาด 114 x 162 มม.)'], ['DL', 'ซอง DL (ขนาด 110 x 220 มม.)']]) {
            await d.labelButton.click();
            await expect(d.envelope(size)).toHaveText(label);
            const zip = await d.download(d.envelope(size));
            expect(zip.suggestedFilename()).toMatch(new RegExp(`^\\d{8}-[A-Z]{3}-envelop-sticker-${size.toLowerCase()}\\.zip$`));
            expect((await readDownload(zip)).subarray(0, 2).toString()).toBe('PK');
          }
        });
      });
    });

    test.describe('TS05-TC09 user ปกติ / TS03-TC10 user TSD ตรวจสอบราคาต่อชิ้นตามค่าบริการใน Back Office', () => {
      test('user ปกติ / user TSD: ราคาแต่ละรายการ = ค่าส่ง ปณ. + e-AR + PostMax (+ พื้นที่พิเศษ)', async ({ browser }) => {
        await forBothUsers(browser, async (user, { page, orderDetailPage: d }) => {
          const order = orders[user.name];
          const expected = await expectedSummary(fees, order.rows.map(pricedItem));
          const { preloadedSummary } = await backOffice.order(order.id);
          expect(bySummaryKey(preloadedSummary)).toEqual(bySummaryKey(expected));

          await page.goto(`orders/${order.id}`);
          const total = expected.reduce((sum, row) => sum + Number(row.totalPrice), 0);
          await expect(d.field('ราคารวมทั้งหมด')).toHaveText(baht(total));
        });
      });
    });

    test.describe('TS06-TC01 user ปกติ / TS04-TC01 user TSD ผู้ใช้งานสามารถเห็นหน้า "การฝากส่งของฉัน" -> Tab รายการฝากส่ง', () => {
      test('user ปกติ: ใบที่ preload แสดงในรายการ หมายเลขอ้างอิง วันที่สร้าง จำนวนชิ้น และสถานะสร้างแล้ว', async ({ browser }) => {
        const portal = await openPortal(browser, NORMAL_USER.state);
        const { page, ordersPage } = portal;
        const order = orders[NORMAL_USER.name];
        await page.goto('');
        await ordersPage.menuLink('การฝากส่งของฉัน').click();
        await ordersPage.waitForRows();
        await expect(page.getByRole('tab', { name: 'รายการฝากส่ง' })).toHaveAttribute('aria-selected', 'true');
        await ordersPage.search(order.number);
        expect(await ordersPage.rowValues(order.number)).toEqual({
          trackingNumber: order.number,
          formattedRefNo: '-',
          createdAt: expect.stringMatching(new RegExp(`^${thaiDate()} - \\d{2}:\\d{2}$`)),
          totalOrderItems: String(order.rows.length),
          totalDroppedOffOrderItems: '0',
          status: 'สร้างแล้ว',
        });
        await portal.close();
      });

      test('user TSD: ใบที่ preload แสดงในรายการ หมายเลขอ้างอิง ประเภทงาน ชื่อย่อหลักทรัพย์ วันส่งออก จำนวนชิ้น และสถานะส่งออกแล้ว', async ({ browser }) => {
        const portal = await openPortal(browser, TSD_USER.state);
        const { page, ordersPage } = portal;
        const order = orders[TSD_USER.name];
        await page.goto('');
        await ordersPage.menuLink('การฝากส่งของฉัน').click();
        await ordersPage.waitForRows();
        await expect(page.getByRole('tab', { name: 'รายการฝากส่ง' })).toHaveAttribute('aria-selected', 'true');
        await ordersPage.search(order.number);
        expect(await ordersPage.rowValues(order.number)).toEqual({
          trackingNumber: order.number,
          formattedRefNo: order.extra['หมายเลขอ้างอิง'],
          documentType: order.extra['ประเภทเอกสาร'],
          orderName: order.extra['ชื่อรายการ'],
          documentTypeReserved: '',
          releaseDate: order.exportDate,
          totalOrderItems: String(order.rows.length),
          totalDroppedOffOrderItems: '0',
          status: 'ส่งออกแล้ว',
        });
        await portal.close();
      });
    });

    test.describe('TS06-TC04 user ปกติ / TS04-TC04 user TSD ตรวจสอบหน้ารายละเอียดการฝากส่ง แบ่งตามสถานะจัดส่ง', () => {
      test('user ปกติ / user TSD: กดรายละเอียดจากรายการ เปิดใบนั้น breadcrumb ถูกต้อง และยังไม่มีรายละเอียดการนำส่งและจัดส่ง', async ({ browser }) => {
        await forBothUsers(browser, async (user, { page, ordersPage, orderDetailPage: d }) => {
          const order = orders[user.name];
          await ordersPage.goto();
          await ordersPage.search(order.number);
          await ordersPage.openDetail(order.number);
          await expect(page).toHaveURL(new RegExp(`orders/${order.id}$`));
          await expect(d.title).toHaveText(`หมายเลขใบนำส่ง : ${order.number}`);
          await expect(d.field('สถานะการฝากส่ง')).toHaveText(user.createdStatus);
          // TS06-TC06 / TS04-TC06
          await expect(d.breadcrumbs).toHaveText(['รายการฝากส่ง', `หมายเลขใบนำส่ง : ${order.number}`]);
          // Not received at drop off yet
          await expect(d.serviceTable).toBeVisible();
          await expect(d.deliverySection).toBeHidden();
          await expect(d.itemsButton).toBeHidden();
        });
      });
    });

    test.describe('TS08-TC01 user ปกติ / TS06-TC01 user TSD ตรวจสอบรายงานการฝากส่ง', () => {
      test('user ปกติ / user TSD: รายงานของใบที่ยังไม่รับฝาก ข้อมูลเอกสาร ค่าบริการ จำนวนชิ้นตามพื้นที่และประเภทบริการ (เฉพาะ Plus/Premium)', async ({ browser }) => {
        await forBothUsers(browser, async (user, { page, ordersPage, orderDetailPage: d, orderReportPage: r }) => {
          const order = orders[user.name];
          const tracked = order.items.filter((item) => !item.service.startsWith('LITE'));
          const count = String(tracked.length);
          await page.goto(`orders/${order.id}`);
          // ราคารวมทั้งหมด shows 0.00 until the order is loaded
          await expect(d.field('ราคารวมทั้งหมด')).not.toHaveText('0.00 บาท');
          const price = await d.field('ราคารวมทั้งหมด').innerText();

          await ordersPage.goto();
          await ordersPage.search(order.number);
          await ordersPage.openReport(order.number);
          await expect(page).toHaveURL(new RegExp(`orders/${order.id}/report$`));
          await expect(r.title).toHaveText(`${order.number} : รายงานการฝากส่ง`);
          // TS08-TC02 / TS06-TC02
          await expect(page.getByRole('navigation').getByRole('listitem')).toHaveText(['รายการฝากส่ง', order.number, 'รายงานการฝากส่ง']);
          await expect(r.field('ประเภทเอกสาร')).toHaveText(user.tsd ? order.extra['ประเภทเอกสาร'] : '-');
          await expect(r.field('หมายเลขอ้างอิง')).toHaveText(user.tsd ? order.extra['หมายเลขอ้างอิง'] : '-');
          await expect(r.field('ผู้ฝากส่ง')).toHaveText(order.sender['ผู้ฝากส่ง']);
          // Not received at drop off yet, so not exported and nothing delivered
          await expect(r.field('วันที่ส่งออก')).toHaveText('-');
          await expect(r.field('ค่าบริการ')).toHaveText(price);
          await expect(r.field('ระยะเวลาที่ส่งสำเร็จ 90%')).toHaveText('-');

          const { preloadedSummary } = await backOffice.order(order.id);
          const services = preloadedSummary.filter((row) => !row.service.startsWith('LITE'))
            .flatMap((row) => Array(Number(row.total)).fill(serviceLabel(row)));
          const byLabel = (a, b) => a[0].localeCompare(b[0]);
          await expect.poll(async () => (await r.tableRows(r.serviceTable)).sort(byLabel))
            .toEqual([...countBy(services).map(([label, n]) => [label, String(n)]), ['รวมทั้งหมด', count]].sort(byLabel));
          const areas = countBy(tracked.map(areaOf))
            .sort(([a], [b]) => AREAS.indexOf(a) - AREAS.indexOf(b))
            .map(([area, n]) => [area, String(n)]);
          expect(await r.tableRows(r.areaTable)).toEqual([...areas, ['รวมทั้งหมด', count]]);
          const [total, ...postalCodes] = await r.tableRows(r.deliveryTable);
          expect(total).toEqual(['รวมทั้งหมด', '0.00%', `0/${count}`]);
          expect(postalCodes.sort()).toEqual(
            countBy(tracked.map((item) => (item.country ? '99999' : item.postalCode))).map(([code, n]) => [code, '0.00%', `0/${n}`]).sort(),
          );
        });
      });
    });

    test.describe('TS05-TC04 user ปกติ / TS03-TC05 user TSD ตรวจสอบข้อมูลนำเข้า', () => {
      test('user ปกติ: หมายเลขติดตามที่เพิ่ง preload (ไม่เกิน 45 วัน) และเพิ่งรับฝาก (ไม่เกิน 6 เดือน) ใช้ซ้ำไม่ได้', async ({ browser }) => {
        const portal = await openPortal(browser, NORMAL_USER.state);
        for (const trackingNumber of await recentTrackingNumbers(portal, backOffice, orders[NORMAL_USER.name])) {
          await uploadWithTrackingNumber(portal.preloadPage, trackingNumber);
          await expectInvalid(portal.preloadPage, { invalid: 1, valid: 1 });
        }
        await portal.close();
      });

      test('user TSD: หมายเลขติดตามที่เพิ่ง preload (ไม่เกิน 45 วัน) และเพิ่งรับฝาก (ไม่เกิน 6 เดือน) ใช้ซ้ำได้ (TSD ไม่ตรวจซ้ำ)', async ({ browser }) => {
        const portal = await openPortal(browser, TSD_USER.state);
        for (const trackingNumber of await recentTrackingNumbers(portal, backOffice, orders[TSD_USER.name])) {
          await uploadWithTrackingNumber(portal.preloadPage, trackingNumber);
          await expect(portal.preloadPage.validResult).toBeVisible();
          await expect(portal.preloadPage.itemCount).toHaveText('2 ชิ้น');
        }
        await portal.close();
      });
    });
  });
});
