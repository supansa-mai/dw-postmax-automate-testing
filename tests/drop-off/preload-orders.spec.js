const { test, expect } = require('../../fixtures');
const { DROPOFF_STATE } = require('../../config/auth');
const { openPortal, forUsers } = require('../../helpers/portal');
const { CSV_USERS, createCsvOrder, serviceLabel, TYPE_LABELS } = require('../../helpers/preloadCsv');
const { readDownload, parseCsv, countBy } = require('../../helpers/orderData');
const { BackOfficeApi } = require('../../helpers/backOfficeApi');
const { thaiDate } = require('../../helpers/thaiDate');

const WAITING = 'รอรับฝาก';
const RECEIVED = 'รับฝาก';
const NOT_RECEIVED = 'ยกเลิกรับฝาก';

// "รายละเอียดการจัดส่งทั้งหมด (CSV)" of the customer's order detail; TSD's has the uploaded รูปแบบซอง too
const DELIVERY_CSV_COLUMNS = ['ID', 'เอกสารยืนยันการจัดส่ง', 'สถานะจัดส่ง', 'หมายเลขติดตามพัสดุ', 'ประเภทการขนส่ง', 'บริการ',
  'บริการ e-AR', 'สินค้า', 'ชื่อผู้รับ', 'ที่อยู่', 'ประเทศ', 'รหัสไปรษณีย์', 'พื้นที่พิเศษ', 'เบอร์ติดต่อ', 'อีเมล',
  'น้ำหนักต่อชิ้น (กรัม)', 'ประกันภัย', 'มูลค่าประกัน', 'หมายเลขอ้างอิง 1', 'หมายเลขอ้างอิง 2', 'หมายเหตุพัสดุ'];
const deliveryCsvColumns = (user) => (user.tsd
  ? DELIVERY_CSV_COLUMNS.flatMap((c) => (c === 'มูลค่าประกัน' ? [c, 'รูปแบบซอง'] : [c]))
  : DELIVERY_CSV_COLUMNS);

/** Per-item delivery status is a Plus/Premium feature ("PostMax Service Code_vInt" sheet), so Lite items are not listed */
const tracked = (items) => items.filter((item) => !item.service.startsWith('LITE'));
const orDash = (value) => value || '-';
const money = (value) => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const byId = (a, b) => Number(a.ID ?? a.refId) - Number(b.ID ?? b.refId);

/**
 * A row of รายละเอียดการจัดส่งทั้งหมด (CSV): the uploaded values as they were, labels as in the order's CSV (พื้นที่พิเศษ
 * not compared). Drop Off's has neither เอกสารยืนยันการจัดส่ง nor TSD's รูปแบบซอง
 */
const expectedCsvRow = (user, { row, exported }, status, { dropOff = false } = {}) => ({
  ID: row.ID,
  ...(!dropOff && { 'เอกสารยืนยันการจัดส่ง': '' }),
  'สถานะจัดส่ง': status,
  'หมายเลขติดตามพัสดุ': exported['หมายเลขติดตามพัสดุ'],
  'ประเภทการขนส่ง': exported['ประเภทการขนส่ง'],
  'บริการ': exported['บริการ'],
  'บริการ e-AR': exported['บริการ e-AR'],
  'สินค้า': row['สินค้า'],
  'ชื่อผู้รับ': row['ชื่อผู้รับ'],
  'ที่อยู่': row['ที่อยู่'],
  'ประเทศ': row['ประเทศ'] || 'Thailand',
  'รหัสไปรษณีย์': row['รหัสไปรษณีย์'],
  'เบอร์ติดต่อ': row['เบอร์ติดต่อ'],
  'อีเมล': row['อีเมล'],
  'น้ำหนักต่อชิ้น (กรัม)': row['น้ำหนักต่อชิ้น (กรัม)'],
  'ประกันภัย': row['ประกันภัย'],
  'มูลค่าประกัน': row['มูลค่าประกัน'],
  ...(user.tsd && !dropOff && { 'รูปแบบซอง': envelopeStyle(row['รูปแบบซอง']) }),
  'หมายเลขอ้างอิง 1': row['หมายเลขอ้างอิง 1'],
  'หมายเลขอ้างอิง 2': row['หมายเลขอ้างอิง 2'],
  'หมายเหตุพัสดุ': '-',
});

/** A row of รายละเอียดการจัดส่งรายพัสดุ: the uploaded values formatted for display (พื้นที่พิเศษ, รูปแบบซอง not compared) */
const expectedItemRow = ({ row, exported }, status) => ({
  refId: row.ID,
  status,
  trackingNumber: exported['หมายเลขติดตามพัสดุ'],
  type: exported['ประเภทการขนส่ง'],
  service: exported['บริการ'],
  eArService: exported['บริการ e-AR'],
  product: orDash(row['สินค้า']),
  receiverName: row['ชื่อผู้รับ'],
  address: row['ที่อยู่'],
  country: row['ประเทศ'] || 'Thailand',
  postalCode: row['รหัสไปรษณีย์'],
  phone: orDash(row['เบอร์ติดต่อ']),
  email: orDash(row['อีเมล']),
  weight: Number(row['น้ำหนักต่อชิ้น (กรัม)']).toFixed(2),
  hasInsurance: row['ประกันภัย'] === 'Y' ? 'มี' : 'ไม่มี',
  insuranceAmount: money(row['มูลค่าประกัน']),
  ref1: row['หมายเลขอ้างอิง 1'],
  ref2: orDash(row['หมายเลขอ้างอิง 2']),
  remark: '-',
});
// รูปแบบซอง is kept for seal / ซอง, any other value is อื่นๆ (as dev shows it, Nov 2026)
const envelopeStyle = (value) => (!value ? '-' : ['seal', 'ซอง'].includes(value) ? value : 'อื่นๆ');
const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key]]));

/** Opens the order at drop off; returns the detail URL */
async function openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d }) {
  await dropOffOrdersPage.goto();
  await dropOffOrdersPage.search(order.number);
  await dropOffOrdersPage.openDetail(order.number);
  await d.waitForOrder();
  return page.url();
}

async function expectStatus(page, d, url, { status, received }) {
  await expect(async () => {
    await page.goto(url);
    await d.waitForOrder();
    await expect(d.field('สถานะ')).toHaveText(status, { timeout: 2000 });
    await expect(d.field('รับฝากแล้ว')).toHaveText(`${received} ชิ้น`, { timeout: 2000 });
  }).toPass({ timeout: 60000 });
}

/** The customer's order detail, opened from การฝากส่งของฉัน; รับฝากแล้ว shows up a moment after the status */
async function openPortalOrder(portal, order, received) {
  await portal.ordersPage.goto();
  await portal.ordersPage.search(order.number);
  await portal.ordersPage.openDetail(order.number);
  const d = portal.orderDetailPage;
  await expect(d.field('สถานะการฝากส่ง')).toHaveText('รับฝากสำเร็จ');
  await expect(async () => {
    await portal.page.reload();
    await expect(d.field('รับฝากแล้ว')).toHaveText(`${received} ชิ้น`, { timeout: 2000 });
  }).toPass({ timeout: 30000 });
}

/** [barcode, postal code, type, weight] as the summary and scan pages list an item */
const summaryRowOf = ({ row, exported, trackingNumber }) => [
  trackingNumber || '-', row['รหัสไปรษณีย์'], exported['ประเภทการขนส่ง'], Number(row['น้ำหนักต่อชิ้น (กรัม)']).toFixed(2),
];
const sortRows = (rows) => [...rows].sort((a, b) => a.join('|').localeCompare(b.join('|')));
const TYPE_ORDER = [TYPE_LABELS.EMS, TYPE_LABELS.REGISTERED, TYPE_LABELS.NORMAL];
const typeOfLabel = (label) => TYPE_ORDER.find((type) => label === type || label.startsWith(`${type} `));

/** Scans one item and waits until it is in (the item count) and done (the field is cleared for the next scan) */
async function scanOne(d, trackingNumber, count) {
  await d.scanInput.fill(trackingNumber);
  await expect(d.itemCount).toHaveText(`${count} ชิ้น`);
  await expect(d.scanInput).toHaveValue('');
}

/** Scans a number the page rejects; expects the dialog's title and message, then closes it */
async function expectScanRejected(d, trackingNumber, title, message) {
  await d.scanInput.fill(trackingNumber);
  await expect(d.scanErrorDialog).toContainText(title);
  await expect(d.scanErrorDialog).toContainText(message);
  await d.scanErrorDialog.getByRole('button', { name: 'ตกลง' }).click();
  await expect(d.scanErrorDialog).toBeHidden();
}

/** The customer's view of who sent the order, as the portal shows it */
async function senderOf(browser, user, order) {
  const portal = await openPortal(browser, user.state);
  await portal.page.goto(`orders/${order.id}`);
  const sender = {};
  for (const label of ['ผู้ฝากส่ง', 'ชื่อผู้ติดต่อ', 'อีเมลติดต่อ', 'เบอร์ติดต่อ']) {
    await expect(portal.orderDetailPage.field(label)).not.toBeEmpty();
    sender[label] = await portal.orderDetailPage.field(label).innerText();
  }
  await portal.close();
  return sender;
}

/** The status each listed item should have: รับฝาก if scanned at drop off, else ยกเลิกรับฝาก */
const statusOf = (received) => (item) => (received.includes(item) ? RECEIVED : NOT_RECEIVED);

test.describe('Drop Off: ใบนำส่งที่สร้างจากไฟล์ CSV ของ user ปกติ และ user TSD', () => {
  test.use({ storageState: DROPOFF_STATE });

  // One order per user, received in full ("ทั้งหมด"), for every case below; they run in this order
  test.describe('รับฝากทั้งใบ (ใช้ใบเดียวกัน รันตามลำดับ)', () => {
    test.describe.configure({ mode: 'serial' });
    let backOffice;
    const orders = {};

    test.beforeAll(async ({ browser }, testInfo) => {
      testInfo.setTimeout(4 * 60 * 1000);
      backOffice = await BackOfficeApi.open(browser);
      for (const user of CSV_USERS) orders[user.name] = await createCsvOrder(browser, user);
    });

    test.afterAll(async () => {
      await backOffice?.close();
    });

    test.describe('TS04-TC04 ตรวจสอบหน้ารายละเอียดใบนำส่ง แบ่งตามสถานะรายการ (รอรับฝาก)', () => {
      test('user ปกติ / user TSD: ข้อมูลผู้ฝากส่ง บริการ และจำนวนชิ้นแยกตามประเภทตรงกับที่ preload ไม่เลือกวิธีนำส่งแล้วแจ้งเตือน', async ({ page, browser, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          const count = String(order.items.length);
          const sender = await senderOf(browser, user, order);
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });

          await expect(d.title).toHaveText(`รายละเอียดใบนำส่ง : ${order.number}`);
          // TS04-TC06
          await expect(d.breadcrumbs).toHaveText(['รายการใบนำส่ง', `หมายเลขใบนำส่ง : ${order.number}`]);
          await expect(d.field('สถานะ')).toHaveText(WAITING);
          await expect(d.field('หมายเลขใบนำส่ง')).toHaveText(order.number);
          await expect(d.field('ชื่อผู้ฝากส่ง')).toHaveText(sender['ผู้ฝากส่ง']);
          await expect(d.field('หมายเลขอ้างอิง')).toHaveText(order.reference);
          await expect(d.field('เตรียมฝากส่ง')).toHaveText(`${count} ชิ้น`);
          await expect(d.field('รับฝากแล้ว')).toHaveText('0 ชิ้น');
          await expect(d.field('สาเหตุที่รับฝากไม่ครบ')).toHaveText('-');
          await expect(d.field('รายละเอียดเพิ่มเติม')).toHaveText('-');
          await expect(d.field('วันที่/เวลาที่สร้าง')).toHaveText(new RegExp(`^${thaiDate()} - \\d{2}:\\d{2}$`));
          await expect(d.field('ที่อยู่ผู้ฝากส่ง')).not.toBeEmpty();
          for (const label of ['ชื่อผู้ติดต่อ', 'อีเมลติดต่อ', 'เบอร์ติดต่อ']) await expect(d.field(label)).toHaveText(sender[label]);
          await expect(d.csvButton).toBeVisible();

          // ข้อมูลตามใบนำส่ง: the order's preloaded summary, labelled as the uploaded items' CSV export labels them
          const { preloadedSummary } = await backOffice.order(order.id);
          const labels = (field, column) => Object.fromEntries(order.items.map((item) => [item[field], item.exported[column]]));
          const services = labels('service', 'บริการ');
          const eArs = labels('eAr', 'บริการ e-AR');
          const rows = await d.tableRows(d.serviceTable);
          const total = rows.pop();
          expect(sortRows(rows)).toEqual(sortRows(preloadedSummary.map((row) => [serviceLabel(row), services[row.service],
            eArs[row.eArService], row.weight, money(row.basePrice), String(row.total), money(row.totalPrice)])));
          const price = preloadedSummary.reduce((sum, row) => sum + Number(row.totalPrice), 0);
          expect(total).toEqual(['', 'รวมทั้งหมด', count, money(price)]);

          // ตารางสรุปจำนวนชิ้นแยกตามประเภทบริการ: every item, EMS first, then ลงทะเบียน, then ธรรมดา
          const received = (await d.receivedGrid.locator('[role=rowgroup] [role=row]').allInnerTexts()).map((text) => text.split('\n'));
          const types = received.map(([label]) => TYPE_ORDER.indexOf(typeOfLabel(label)));
          expect(types).toEqual([...types].sort((a, b) => a - b));
          const byLabel = countBy(preloadedSummary.flatMap((row) => Array(Number(row.total)).fill(serviceLabel(row))));
          expect(sortRows(received)).toEqual(sortRows(byLabel.map(([label, n]) => [label, String(n)])));

          await d.primaryButton.click();
          await expect(d.methodError).toBeVisible();
        });
      });
    });

    test.describe('TS04-TC05 ตรวจสอบการดาวน์โหลดข้อมูล', () => {
      test('user ปกติ / user TSD: CSV รายละเอียดการจัดส่งทั้งหมด ก่อนรับฝาก ทุกชิ้นรอรับฝาก ข้อมูลตรงกับไฟล์ที่อัปโหลด', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          const download = await d.download(d.csvButton);
          await expect(d.toast).toHaveText('ดาวน์โหลดสำเร็จ');
          expect(download.suggestedFilename()).toBe(`order-items-${order.id}.csv`);
          const buffer = await readDownload(download);
          expect(buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0].split(','))
            .toEqual(DELIVERY_CSV_COLUMNS.filter((c) => c !== 'เอกสารยืนยันการจัดส่ง'));
          const expected = tracked(order.items).map((item) => expectedCsvRow(user, item, WAITING, { dropOff: true }));
          const rows = parseCsv(buffer).map((row) => pick(row, Object.keys(expected[0])));
          expect(rows.sort(byId)).toEqual(expected.sort(byId));
        });
      });
    });

    test.describe('TS05-TC01 ตรวจสอบหน้าสรุปรายการรับฝากทั้งหมด', () => {
      test('user ปกติ / user TSD: เลือกนำส่งแบบทั้งหมด แสดงพัสดุครบทุกชิ้นตามที่ preload breadcrumb ถูกต้อง', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseReceiveAll();
          await expect(d.summaryTitle).toHaveText(`สรุปรายการใบนำส่งทั้งหมด : ${order.number}`);
          // TS05-TC02
          await expect(d.breadcrumbs).toHaveText(['รายการใบนำส่ง', `หมายเลขใบนำส่ง : ${order.number}`, 'สรุปรายการใบนำส่งทั้งหมด']);
          await expect(d.itemCount).toHaveText(`${order.items.length} ชิ้น`);
          await expect(d.deleteSelectedButton).toBeDisabled();
          await expect(d.typeFilter).toHaveValue('ทั้งหมด');
          await d.showAllRows();
          expect(sortRows(await d.summaryValues())).toEqual(sortRows(order.items.map(summaryRowOf)));
          await expect(d.primaryButton).toHaveText('รับฝาก');
          await d.cancelReceiving();
        });
      });
    });

    test.describe('TS05-TC03 ตรวจสอบการกรองรายการรับฝาก', () => {
      test('user ปกติ / user TSD: ค้นหาด้วย Barcode หรือรหัสไปรษณีย์ และกรองตามประเภทบริการ', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          const item = order.items.find((i) => i.trackingNumber && !i.country);
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseReceiveAll();
          await d.showAllRows();

          await d.summarySearch.fill(item.trackingNumber);
          await expect(d.summaryRows).toHaveCount(1);
          await expect(d.summaryRow(item.trackingNumber)).toBeVisible();

          const postalCode = item.row['รหัสไปรษณีย์'];
          await d.summarySearch.fill(postalCode);
          // The search matches part of a barcode too
          await expect(d.summaryRows).toHaveCount(order.items
            .filter((i) => i.row['รหัสไปรษณีย์'].includes(postalCode) || (i.trackingNumber ?? '').includes(postalCode)).length);

          await d.summarySearch.fill('');
          await d.typeFilter.click();
          await page.getByRole('option', { name: 'EMS', exact: true }).click();
          await expect(d.summaryRows).toHaveCount(order.items.filter((i) => i.type === 'EMS').length);
          await d.cancelReceiving();
        });
      });
    });

    test.describe('TS05-TC04 ตรวจสอบการลบรายการรับฝาก', () => {
      test('user ปกติ / user TSD: ลบทีละรายการและลบหลายรายการ modal แสดงประเภทและจำนวน จำนวนรวมอัปเดต ยกเลิกแล้วไม่ถูกบันทึก', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          const count = order.items.length;
          const ems = order.items.find((i) => i.type === 'EMS' && i.trackingNumber && !i.country);
          const registered = order.items.find((i) => i.type === 'REGISTERED' && i.trackingNumber && !i.country);
          const normal = order.items.find((i) => i.type === 'NORMAL' && i.trackingNumber);
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseReceiveAll();
          await d.showAllRows();

          await d.deleteButton(await d.revealRow(ems.trackingNumber)).click();
          await expect(d.deleteDialog).toContainText('EMS1 ชิ้น');
          await d.deleteDialog.getByRole('button', { name: 'ยืนยัน' }).click();
          await expect(d.itemCount).toHaveText(`${count - 1} ชิ้น`);
          await expect(d.summaryRow(ems.trackingNumber)).toHaveCount(0);

          for (const item of [registered, normal]) await (await d.revealRow(item.trackingNumber)).getByRole('checkbox').click();
          await expect(d.deleteSelectedButton).toBeEnabled();
          await d.deleteSelectedButton.click();
          await expect(d.deleteDialog).toContainText('ลงทะเบียน1 ชิ้น');
          await expect(d.deleteDialog).toContainText('ธรรมดา1 ชิ้น');
          await d.deleteDialog.getByRole('button', { name: 'ยืนยัน' }).click();
          await expect(d.itemCount).toHaveText(`${count - 3} ชิ้น`);

          // TS06-TC11-like: ยกเลิก keeps nothing that was removed
          await d.cancelReceiving();
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseReceiveAll();
          await expect(d.itemCount).toHaveText(`${count} ชิ้น`);
          await d.cancelReceiving();
        });
      });
    });

    test.describe('TS05-TC05 ตรวจสอบการแก้ไขน้ำหนักรายการรับฝาก', () => {
      test('user ปกติ / user TSD: modal แก้ไขน้ำหนัก ไม่กรอก / เกินน้ำหนักที่กำหนดแจ้งเตือน พิมพ์ติดลบไม่ได้ บันทึกแล้วน้ำหนักเปลี่ยน', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          const item = order.items.find((i) => i.type === 'EMS' && i.trackingNumber && !i.country);
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseReceiveAll();
          await d.showAllRows();
          const row = await d.revealRow(item.trackingNumber);

          await d.editButton(row).click();
          for (const value of [item.trackingNumber, item.row['รหัสไปรษณีย์'], 'EMS']) await expect(d.editDialog).toContainText(value);
          await expect(d.weightInput).toHaveValue(String(Number(item.row['น้ำหนักต่อชิ้น (กรัม)'])));
          await d.editDialog.getByRole('button', { name: 'ยกเลิก' }).click();
          await expect(d.editDialog).toBeHidden();

          await d.editButton(row).click();
          await d.weightInput.fill('');
          await d.editDialog.getByRole('button', { name: 'ยืนยัน' }).click();
          await expect(d.editDialog.getByText('กรุณากรอกน้ำหนักต่อชิ้น (กรัม)', { exact: true })).toBeVisible();
          // The heaviest band of domestic EMS (40000 on dev, 30000 on UAT)
          const maxWeight = Math.max(...(await backOffice.fees()).domestic.EMS.map((band) => Number(band.maxWeight)));
          await d.weightInput.fill(String(maxWeight + 1));
          await d.editDialog.getByRole('button', { name: 'ยืนยัน' }).click();
          await expect(d.editDialog.getByText(`กรุณากรอกน้ำหนักไม่เกิน ${maxWeight} กรัม`, { exact: true })).toBeVisible();
          await d.weightInput.fill('');
          await d.weightInput.pressSequentially('-5');
          await expect(d.weightInput).not.toHaveValue(/-/);
          await d.saveWeight('2.5');
          await expect(d.toast).toHaveText('แก้ไขน้ำหนักสำเร็จ');
          await expect(row.getByRole('gridcell').nth(4)).toHaveText('2.50');
          await d.cancelReceiving();
        });
      });
    });

    test.describe('TS05-TC06 ตรวจสอบการส่งรายการเข้าสู่ระบบ', () => {
      test('user ปกติ / user TSD: รับฝากทั้งใบ สถานะเป็นรับฝากสำเร็จทั้ง drop off และการฝากส่งของฉัน', async ({ page, browser, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          const url = await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseReceiveAll();
          await d.primaryButton.click();
          for (const value of [order.number, order.reference, `${order.items.length} ชิ้น`]) await expect(d.receiveDialog).toContainText(value);
          await expect(d.mismatchWarning).toBeHidden();
          await d.receiveDialog.getByRole('button', { name: 'ยกเลิก' }).click();
          await expect(d.receiveDialog).toBeHidden();
          await d.primaryButton.click();
          await d.receiveDialog.getByRole('button', { name: 'ยืนยัน' }).click();
          await expect(d.toast).toHaveText('ส่งรายการเข้าสู่ระบบสำเร็จ');
          await expectStatus(page, d, url, { status: 'รับฝากสำเร็จ', received: order.items.length });
          // TS05-TC07: the received order has no receiving method to choose any more
          await expect(d.methodSelect).toBeHidden();

          const portal = await openPortal(browser, user.state);
          await openPortalOrder(portal, order, order.items.length);
          await portal.close();
          order.received = order.items;
        });
      });
    });

    test.describe('TS06-TC04 user ปกติ / TS04-TC04 user TSD ตรวจสอบหน้ารายละเอียดการฝากส่ง (สถานะรับฝากสำเร็จ)', () => {
      test('user ปกติ / user TSD: แสดงรายละเอียดการนำส่งและจัดส่ง รับฝากแล้ว ชื่อผู้รับฝาก และจำนวนรับฝากสำเร็จ (เฉพาะ Plus/Premium)', async ({ browser }) => {
        await forUsers(browser, CSV_USERS, async (user, portal) => {
          const order = orders[user.name];
          const d = portal.orderDetailPage;
          await openPortalOrder(portal, order, order.received.length);
          await expect(d.field('วันที่/เวลาที่ปณ.ได้รับ')).toHaveText(/^\d{2}\/\d{2}\/\d{4} - \d{2}:\d{2}$/);
          await expect(d.deliverySection).toBeVisible();
          await expect(d.field('ชื่อผู้รับฝาก')).toHaveText((await backOffice.order(order.id)).dropOffBy.name);
          await expect(d.field('สาเหตุที่รับฝากไม่ครบ')).toHaveText('-');
          await expect(d.field('รายละเอียดเพิ่มเติม')).toHaveText('-');
          expect(await d.tableRows(d.deliveryTable)).toEqual([
            ['รับฝากสำเร็จ', String(tracked(order.received).length)], ['กำลังจัดส่ง', '0'], ['ส่งสำเร็จ', '0'], ['ส่งไม่สำเร็จ', '0'],
          ]);
          await expect(d.deliveryCsvButton).toBeVisible();
          await expect(d.itemsButton).toBeVisible();
        });
      });
    });

    test.describe('TS06-TC05 user ปกติ / TS04-TC05 user TSD ตรวจสอบการดาวน์โหลดข้อมูล CSV', () => {
      test('user ปกติ / user TSD: CSV รายละเอียดการจัดส่งทั้งหมด ทุกชิ้นสถานะรับฝาก ข้อมูลตรงกับไฟล์ที่อัปโหลด', async ({ browser }) => {
        await forUsers(browser, CSV_USERS, async (user, portal) => {
          const order = orders[user.name];
          const d = portal.orderDetailPage;
          await openPortalOrder(portal, order, order.received.length);
          const download = await d.download(d.deliveryCsvButton);
          await expect(portal.page.getByRole('alert').and(portal.page.locator('.MuiAlert-root'))).toHaveText('ดาวน์โหลดสำเร็จ');
          expect(download.suggestedFilename()).toBe(`order-items-${order.id}.csv`);
          const buffer = await readDownload(download);
          expect(buffer.toString('utf8').replace(/^﻿/, '').split(/\r?\n/)[0].split(',')).toEqual(deliveryCsvColumns(user));
          const expected = tracked(order.items).map((item) => expectedCsvRow(user, item, statusOf(order.received)(item)));
          const rows = parseCsv(buffer).map((row) => pick(row, Object.keys(expected[0])));
          expect(rows.sort(byId)).toEqual(expected.sort(byId));
        });
      });
    });

    test.describe('TS07-TC01 user ปกติ / TS05-TC01 user TSD ตรวจสอบหน้ารายละเอียดการจัดส่งรายพัสดุ', () => {
      test('user ปกติ / user TSD: กดดูรายละเอียด ทุกชิ้นสถานะรับฝาก ข้อมูลตรงกับไฟล์ที่อัปโหลด breadcrumb ถูกต้อง', async ({ browser }) => {
        await forUsers(browser, CSV_USERS, async (user, portal) => {
          const order = orders[user.name];
          await openPortalOrder(portal, order, order.received.length);
          await portal.orderDetailPage.itemsButton.click();
          await expect(portal.page).toHaveURL(new RegExp(`orders/${order.id}/items$`));
          await expect(portal.orderItemsPage.title).toHaveText(`${order.number} : รายละเอียดการจัดส่งรายพัสดุ`);
          // TS07-TC04 / TS05-TC04
          await expect(portal.page.getByRole('navigation').getByRole('listitem'))
            .toHaveText(['รายการฝากส่ง', `หมายเลขใบนำส่ง : ${order.number}`, 'รายละเอียดการจัดส่งรายพัสดุ']);
          const expected = tracked(order.items).map((item) => expectedItemRow(item, statusOf(order.received)(item)));
          const shown = (await portal.orderItemsPage.rowValues()).map((row) => pick(row, Object.keys(expected[0])));
          expect(shown.sort(byId)).toEqual(expected.sort(byId));
        });
      });
    });

    test.describe('TS08-TC01 user ปกติ / TS06-TC01 user TSD ตรวจสอบรายงานการฝากส่ง', () => {
      test('user ปกติ / user TSD: รายงานหลังรับฝาก แสดงวันที่ส่งออกและค่าบริการ', async ({ browser }) => {
        await forUsers(browser, CSV_USERS, async (user, portal) => {
          const order = orders[user.name];
          const d = portal.orderDetailPage;
          const r = portal.orderReportPage;
          await openPortalOrder(portal, order, order.received.length);
          await expect(d.field('ราคารวมทั้งหมด')).not.toHaveText('0.00 บาท');
          const price = await d.field('ราคารวมทั้งหมด').innerText();
          const sender = await d.field('ผู้ฝากส่ง').innerText();
          const receivedAt = await d.field('วันที่/เวลาที่ปณ.ได้รับ').innerText();

          await portal.ordersPage.goto();
          await portal.ordersPage.search(order.number);
          await portal.ordersPage.openReport(order.number);
          await expect(r.title).toHaveText(`${order.number} : รายงานการฝากส่ง`);
          await expect(r.field('ประเภทเอกสาร')).toHaveText(user.tsd ? 'AUTO เอกสาร' : '-');
          await expect(r.field('หมายเลขอ้างอิง')).toHaveText(order.reference);
          await expect(r.field('ผู้ฝากส่ง')).toHaveText(sender);
          // Received after TSD's export date (set to the time of the upload), so both show when it was received
          await expect(r.field('วันที่ส่งออก')).toHaveText(receivedAt);
          await expect(r.field('ค่าบริการ')).toHaveText(price);
        });
      });
    });
  });

  // One order per user, received in part ("สแกนทีละชิ้น", one Plus/Premium item left out), for every case below; they run in this order
  test.describe('รับฝากไม่ครบ (ใช้ใบเดียวกัน รันตามลำดับ)', () => {
    test.describe.configure({ mode: 'serial' });
    const reason = 'ขอแก้ไขจ่าหน้า';
    const detail = 'AUTO รับฝากไม่ครบ';
    let backOffice;
    const orders = {};

    test.beforeAll(async ({ browser }, testInfo) => {
      testInfo.setTimeout(4 * 60 * 1000);
      backOffice = await BackOfficeApi.open(browser);
      for (const user of CSV_USERS) {
        const order = await createCsvOrder(browser, user);
        // Items without a tracking number cannot be scanned; one more item is left out
        const left = tracked(order.items).filter((item) => item.trackingNumber).at(-1);
        orders[user.name] = { ...order, received: order.items.filter((item) => item.trackingNumber && item !== left) };
      }
    });

    test.afterAll(async () => {
      await backOffice?.close();
    });

    test.describe('TS06-TC01 ตรวจสอบหน้าสรุปรายการรับฝากสแกนทีละชิ้น', () => {
      test('user ปกติ / user TSD: เลือกสแกนทีละชิ้น ยังไม่มีรายการ ปุ่มรับฝากกดไม่ได้ breadcrumb ถูกต้อง', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseScanEach();
          await expect(d.scanTitle).toHaveText(`สแกนทีละชิ้น : ${order.number}`);
          // TS06-TC02
          await expect(d.breadcrumbs).toHaveText(['รายการใบนำส่ง', `หมายเลขใบนำส่ง : ${order.number}`, 'สแกนทีละชิ้น']);
          await expect(d.itemCount).toHaveText('0 ชิ้น');
          await expect(page.getByText('ไม่พบผลการค้นหา', { exact: true })).toBeVisible();
          await expect(d.deleteSelectedButton).toBeDisabled();
          await expect(d.primaryButton).toHaveText('รับฝาก');
          await expect(d.primaryButton).toBeDisabled();
        });
      });
    });

    test.describe('TS06-TC03 ตรวจสอบการสแกนทีละชิ้นไม่สำเร็จ', () => {
      test('user ปกติ / user TSD: หมายเลขที่ไม่อยู่ในใบนำส่งแจ้งไม่พบข้อมูล สแกนซ้ำแจ้งเคยถูกสแกนไปแล้ว', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          const otherOrder = orders[CSV_USERS.find((u) => u !== user).name];
          const [first] = order.received;
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseScanEach();

          for (const trackingNumber of ['TS000001234TH', otherOrder.received[0].trackingNumber]) {
            await expectScanRejected(d, trackingNumber, 'ไม่พบข้อมูล', 'กรุณาตรวจสอบความถูกต้องของรหัสบาร์โค้ด และสแกนใหม่อีกครั้ง');
          }
          await expect(d.itemCount).toHaveText('0 ชิ้น');
          await scanOne(d, first.trackingNumber, 1);
          await expectScanRejected(d, first.trackingNumber, 'รายการนี้เคยถูกสแกนไปแล้ว', 'รหัสบาร์โค้ดนี้ถูกใช้งานไปแล้ว จึงไม่สามารถสแกนซ้ำได้');
          await expect(d.itemCount).toHaveText('1 ชิ้น');
          await d.cancelReceiving();
        });
      });
    });

    test.describe('TS06-TC04 ตรวจสอบการสแกนทีละชิ้นสำเร็จ', () => {
      test('user ปกติ / user TSD: สแกนทีละชิ้น รายการเพิ่มในตารางพร้อมข้อมูลตามที่ preload จำนวนรวมอัปเดต', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          const scanned = order.received.slice(0, 3);
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseScanEach();
          for (const [i, item] of scanned.entries()) await scanOne(d, item.trackingNumber, i + 1);
          expect(sortRows(await d.summaryValues())).toEqual(sortRows(scanned.map(summaryRowOf)));
          await expect(d.primaryButton).toBeEnabled();
          await d.cancelReceiving();
        });
      });
    });

    test.describe('TS06-TC05 ตรวจสอบการลบรายการรับฝาก', () => {
      test('user ปกติ / user TSD: ลบทีละรายการและลบหลายประเภท modal แสดงประเภทและจำนวน จำนวนรวมอัปเดต', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          const pickType = (type) => order.received.find((i) => i.type === type && !i.country);
          const [normal, registered, ems] = ['NORMAL', 'REGISTERED', 'EMS'].map(pickType);
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseScanEach();
          for (const [i, item] of [normal, registered, ems].entries()) await scanOne(d, item.trackingNumber, i + 1);

          await d.deleteButton(d.summaryRow(normal.trackingNumber)).click();
          await expect(d.deleteDialog).toContainText('ธรรมดา1 ชิ้น');
          await d.deleteDialog.getByRole('button', { name: 'ยกเลิก' }).click();
          await expect(d.itemCount).toHaveText('3 ชิ้น');
          await d.deleteButton(d.summaryRow(normal.trackingNumber)).click();
          await d.deleteDialog.getByRole('button', { name: 'ยืนยัน' }).click();
          await expect(d.itemCount).toHaveText('2 ชิ้น');

          for (const item of [registered, ems]) await d.summaryRow(item.trackingNumber).getByRole('checkbox').click();
          await d.deleteSelectedButton.click();
          await expect(d.deleteDialog).toContainText('ลงทะเบียน1 ชิ้น');
          await expect(d.deleteDialog).toContainText('EMS1 ชิ้น');
          await d.deleteDialog.getByRole('button', { name: 'ยืนยัน' }).click();
          await expect(d.itemCount).toHaveText('0 ชิ้น');
          await expect(d.primaryButton).toBeDisabled();
          await d.cancelReceiving();
        });
      });
    });

    test.describe('TS06-TC06 ตรวจสอบการแก้ไขน้ำหนักรายการรับฝาก', () => {
      test('user ปกติ / user TSD: แก้ไขน้ำหนักรายการที่สแกน ไม่กรอกแจ้งเตือน บันทึกแล้วน้ำหนักเปลี่ยน', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          const [item] = order.received;
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseScanEach();
          await scanOne(d, item.trackingNumber, 1);
          const row = d.summaryRow(item.trackingNumber);
          await d.editButton(row).click();
          await expect(d.editDialog).toContainText(item.trackingNumber);
          await d.weightInput.fill('');
          await d.editDialog.getByRole('button', { name: 'ยืนยัน' }).click();
          await expect(d.editDialog.getByText('กรุณากรอกน้ำหนักต่อชิ้น (กรัม)', { exact: true })).toBeVisible();
          await d.saveWeight('3.25');
          await expect(d.toast).toHaveText('แก้ไขน้ำหนักสำเร็จ');
          await expect(row.getByRole('gridcell').nth(4)).toHaveText('3.25');
          await d.cancelReceiving();
        });
      });
    });

    test.describe('TS06-TC11 ตรวจสอบการยกเลิกการรับฝากเข้าระบบ', () => {
      test('user ปกติ / user TSD: สแกนแล้วยกเลิก modal ยืนยันการยกเลิก กลับหน้ารายการใบนำส่ง ใบนำส่งยังรอรับฝาก', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseScanEach();
          await scanOne(d, order.received[0].trackingNumber, 1);
          await d.cancelButton.click();
          await expect(d.cancelDialog).toContainText(order.number);
          await d.cancelDialog.getByRole('button', { name: 'ยืนยัน' }).click();
          await page.waitForURL(/dropoff\/orders$/);
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await expect(d.field('สถานะ')).toHaveText(WAITING);
          await expect(d.field('รับฝากแล้ว')).toHaveText('0 ชิ้น');
        });
      });
    });

    test.describe('TS06-TC07 ตรวจสอบการส่งรายการเข้าสู่ระบบ', () => {
      test('user ปกติ / user TSD: สแกนบางชิ้นแล้วรับฝาก modal แจ้งจำนวนไม่ตรง สถานะเป็นกำลังรับฝาก', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          const url = await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.chooseScanEach();
          for (const [i, item] of order.received.entries()) await scanOne(d, item.trackingNumber, i + 1);
          await d.primaryButton.click();
          for (const value of [order.number, order.reference, `${order.received.length} ชิ้น`]) await expect(d.receiveDialog).toContainText(value);
          await expect(d.mismatchWarning).toBeVisible();
          await d.receiveDialog.getByRole('button', { name: 'ยกเลิก' }).click();
          await expect(d.receiveDialog).toBeHidden();
          await d.primaryButton.click();
          await d.receiveDialog.getByRole('button', { name: 'ยืนยัน' }).click();
          await expect(d.toast).toHaveText('ส่งรายการเข้าสู่ระบบสำเร็จ');
          await expectStatus(page, d, url, { status: 'กำลังรับฝาก', received: order.received.length });
        });
      });
    });

    test.describe('TS06-TC08 ดูประวัติการรับฝากรายการใบนำส่ง', () => {
      test('user ปกติ / user TSD: ใบที่กำลังรับฝาก มีปุ่มสิ้นสุดการรับฝาก สแกนชิ้นที่รับฝากแล้วซ้ำไม่ได้', async ({ page, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await expect(d.field('สถานะ')).toHaveText('กำลังรับฝาก');
          await expect(d.field('รับฝากแล้ว')).toHaveText(`${order.received.length} ชิ้น`);
          await expect(d.finishButton).toBeVisible();
          await d.chooseScanEach();
          // TS06-TC03 กรณี 3
          await expectScanRejected(d, order.received[0].trackingNumber, 'รายการนี้ถูกรับฝากแล้ว', 'รหัสบาร์โค้ดนี้ถูกรับฝากแล้ว จึงไม่สามารถสแกนซ้ำได้');
          await d.cancelReceiving();
        });
      });
    });

    test.describe('TS06-TC09 ตรวจสอบการปิดคำสั่งฝากส่งให้กับ order ที่ส่งไม่ครบ', () => {
      test('user ปกติ / user TSD: สิ้นสุดการรับฝาก ไม่เลือกสาเหตุแจ้งเตือน สถานะรับฝากสำเร็จทั้ง drop off และการฝากส่งของฉัน', async ({ page, browser, dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
        test.setTimeout(2 * 60 * 1000);
        for (const user of CSV_USERS) await test.step(user.name, async () => {
          const order = orders[user.name];
          const url = await openOrder(page, order, { dropOffOrdersPage, dropOffOrderDetailPage: d });
          await d.finishButton.click();
          await d.finishDialog.getByRole('button', { name: 'ยืนยัน' }).click();
          await expect(d.finishDialog.getByText('กรุณาเลือกสาเหตุที่รับฝากไม่ครบ', { exact: true })).toBeVisible();
          await d.finishDialog.getByRole('button', { name: 'ยกเลิก' }).click();
          await expect(d.finishDialog).toBeHidden();

          await d.finishReceiving(reason, detail);
          await expect(d.toast).toHaveText('สิ้นสุดการรับฝากสำเร็จ');
          await expectStatus(page, d, url, { status: 'รับฝากสำเร็จ', received: order.received.length });
          await expect(d.field('สาเหตุที่รับฝากไม่ครบ')).toHaveText(reason);
          await expect(d.field('รายละเอียดเพิ่มเติม')).toHaveText(detail);

          const portal = await openPortal(browser, user.state);
          await openPortalOrder(portal, order, order.received.length);
          await portal.close();
        });
      });
    });

    test.describe('TS06-TC04 user ปกติ / TS04-TC04 user TSD ตรวจสอบหน้ารายละเอียดการฝากส่ง (รับฝากไม่ครบ)', () => {
      test('user ปกติ / user TSD: แสดงรับฝากแล้ว สาเหตุที่รับฝากไม่ครบ รายละเอียดเพิ่มเติม และจำนวนรับฝากสำเร็จ (เฉพาะ Plus/Premium)', async ({ browser }) => {
        await forUsers(browser, CSV_USERS, async (user, portal) => {
          const order = orders[user.name];
          const d = portal.orderDetailPage;
          await openPortalOrder(portal, order, order.received.length);
          await expect(d.field('ชื่อผู้รับฝาก')).toHaveText((await backOffice.order(order.id)).dropOffBy.name);
          await expect(d.field('สาเหตุที่รับฝากไม่ครบ')).toHaveText(reason);
          await expect(d.field('รายละเอียดเพิ่มเติม')).toHaveText(detail);
          expect(await d.tableRows(d.deliveryTable)).toEqual([
            ['รับฝากสำเร็จ', String(tracked(order.received).length)], ['กำลังจัดส่ง', '0'], ['ส่งสำเร็จ', '0'], ['ส่งไม่สำเร็จ', '0'],
          ]);
        });
      });
    });

    test.describe('TS06-TC05 user ปกติ / TS04-TC05 user TSD ตรวจสอบการดาวน์โหลดข้อมูล CSV', () => {
      test('user ปกติ / user TSD: CSV รายละเอียดการจัดส่งทั้งหมด ชิ้นที่สแกนเป็นรับฝาก ชิ้นที่เหลือเป็นยกเลิกรับฝาก', async ({ browser }) => {
        await forUsers(browser, CSV_USERS, async (user, portal) => {
          const order = orders[user.name];
          const d = portal.orderDetailPage;
          await openPortalOrder(portal, order, order.received.length);
          const rows = parseCsv(await readDownload(await d.download(d.deliveryCsvButton)));
          const expected = tracked(order.items).map((item) => expectedCsvRow(user, item, statusOf(order.received)(item)));
          expect(rows.map((row) => pick(row, Object.keys(expected[0]))).sort(byId)).toEqual(expected.sort(byId));
        });
      });
    });

    test.describe('TS07-TC01 user ปกติ / TS05-TC01 user TSD ตรวจสอบหน้ารายละเอียดการจัดส่งรายพัสดุ', () => {
      test('user ปกติ / user TSD: กดดูรายละเอียด ชิ้นที่สแกนเป็นรับฝาก ชิ้นที่เหลือเป็นยกเลิกรับฝาก', async ({ browser }) => {
        await forUsers(browser, CSV_USERS, async (user, portal) => {
          const order = orders[user.name];
          await openPortalOrder(portal, order, order.received.length);
          await portal.orderDetailPage.itemsButton.click();
          const expected = tracked(order.items).map((item) => expectedItemRow(item, statusOf(order.received)(item)));
          const shown = (await portal.orderItemsPage.rowValues()).map((row) => pick(row, Object.keys(expected[0])));
          expect(shown.sort(byId)).toEqual(expected.sort(byId));
        });
      });
    });
  });
});
