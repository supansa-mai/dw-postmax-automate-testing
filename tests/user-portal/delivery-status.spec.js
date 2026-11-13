const { test, expect } = require('../../fixtures');
const { env, ENV_NAME } = require('../../config/environments');
const { DROPOFF_STATE } = require('../../config/auth');
const { openPortal } = require('../../helpers/portal');
const { CSV_USERS, createCsvOrder } = require('../../helpers/preloadCsv');
const { BackOfficeApi } = require('../../helpers/backOfficeApi');
const { DropOffOrdersPage } = require('../../pages/DropOffOrdersPage');
const { DropOffOrderDetailPage } = require('../../pages/DropOffOrderDetailPage');

const [NORMAL_USER, TSD_USER] = CSV_USERS;
// Thai Post's status of an item once received at drop off
const RECEIVED = '103';
// The items page shows Thai Post's own status description
const ITEM_STATUS = { received: 'รับฝาก', inTransit: 'ออกจากที่ทำการ/ศูนย์ไปรษณีย์', delivered: 'นำจ่ายสำเร็จ', failed: 'นำจ่ายไม่สำเร็จ' };

/** Items with a delivery status of their own (not Lite), sent within Thailand */
const trackedInThailand = (order) => order.items.filter((item) => item.trackingNumber && !item.country && !item.service.startsWith('LITE'));
// dev hands out the same few EMS-abroad tracking numbers (EE...) to many orders and updates the wrong one (CPM-1841)
const notEmsAbroad = (row) => !(row['รหัสบริการ'].startsWith('EMS') && row['ประเทศ']);
const HOUR = 60 * 60 * 1000;

/**
 * An order of `user` received in full at drop off, with the items the cases below update: `inTransit` and `delivered`
 * without e-AR, `failed` with e-AR
 */
async function receivedOrder(browser, backOffice, user) {
  const order = await createCsvOrder(browser, user, { only: notEmsAbroad });
  const context = await browser.newContext({ storageState: DROPOFF_STATE, baseURL: `${env.baseURL}/` });
  const page = await context.newPage();
  const dropOffOrders = new DropOffOrdersPage(page);
  const dropOffOrder = new DropOffOrderDetailPage(page);
  await dropOffOrders.goto();
  await dropOffOrders.search(order.number);
  await dropOffOrders.openDetail(order.number);
  await dropOffOrder.waitForOrder();
  await dropOffOrder.receiveAll();
  await context.close();
  // Received is saved a moment later and would overwrite an update sent before it
  await expect.poll(async () => (await backOffice.orderItems(order.id)).every((item) => item.status === RECEIVED),
    { message: `items of ${order.number} received`, timeout: 60000, intervals: [2000] }).toBe(true);

  const items = trackedInThailand(order);
  const withoutEAr = items.filter((item) => item.eAr === 'NON');
  return {
    ...order,
    tracked: order.items.filter((item) => item.trackingNumber && !item.service.startsWith('LITE')),
    inTransit: withoutEAr[0],
    delivered: withoutEAr[1],
    failed: items.find((item) => item.eAr !== 'NON'),
  };
}

/** สถานะการฝากส่ง and the items per delivery status of the order detail page, once the update has come through */
async function expectOrderStatus(portal, order, status, { received, inTransit = 0, delivered = 0, failed = 0 }) {
  const d = portal.orderDetailPage;
  await expect(async () => {
    await portal.page.goto(`orders/${order.id}`);
    await expect(d.field('สถานะการฝากส่ง')).toHaveText(status, { timeout: 5000 });
    expect(await d.tableRows(d.deliveryTable)).toEqual([
      ['รับฝากสำเร็จ', String(received)], ['กำลังจัดส่ง', String(inTransit)], ['ส่งสำเร็จ', String(delivered)], ['ส่งไม่สำเร็จ', String(failed)],
    ]);
  }).toPass({ timeout: 60000 });
}

/** The items page: the updated items show Thai Post's status, the rest are still รับฝาก */
async function expectItemStatuses(portal, order, statuses) {
  const p = portal.orderItemsPage;
  await portal.page.goto(`orders/${order.id}/items`);
  await expect(p.title).toHaveText(`${order.number} : รายละเอียดการจัดส่งรายพัสดุ`);
  const rows = await p.rowValues();
  expect(Object.fromEntries(rows.map((row) => [row.trackingNumber, row.status]))).toEqual(Object.fromEntries(order.tracked.map(
    (item) => [item.trackingNumber, statuses[item.trackingNumber] ?? ITEM_STATUS.received],
  )));
}

/** e-AR can't be opened before the signed file is in: an item without e-AR, and a failed one within 30 days */
async function expectDocumentsDisabled(portal, order) {
  const p = portal.orderItemsPage;
  for (const item of [order.delivered, order.failed]) {
    await portal.page.goto(`orders/${order.id}/items`);
    await p.search(item.trackingNumber);
    await expect(p.documentButton(item.trackingNumber)).toBeDisabled();
  }
}

async function expectStatusFilter(portal, order) {
  const p = portal.orderItemsPage;
  await portal.page.goto(`orders/${order.id}/items`);
  await expect(p.rows.first()).toBeVisible({ timeout: 30000 });
  await p.filterStatus(ITEM_STATUS.delivered);
  await expect(p.rows).toHaveCount(1);
  await expect(p.rows).toContainText(order.delivered.trackingNumber);
}

/**
 * อัตราและจำนวนการนำจ่ายสำเร็จ: delivered / items per postal code; รวมทั้งหมด's rate is the mean of the postal codes'
 * rates, not delivered / items (as the system does it, Nov 2026)
 */
async function expectDeliveryRates(portal, order, deliveredItems) {
  const percent = (fraction) => `${(fraction * 100).toFixed(2)}%`;
  const postalCodes = [...new Set(order.tracked.map((item) => item.postalCode))];
  const byPostalCode = postalCodes.map((code) => {
    const all = order.tracked.filter((item) => item.postalCode === code);
    const done = all.filter((item) => deliveredItems.includes(item)).length;
    return { code, done, all: all.length };
  });
  const meanRate = byPostalCode.reduce((sum, { done, all }) => sum + done / all, 0) / byPostalCode.length;
  const r = portal.orderReportPage;
  await portal.page.goto(`orders/${order.id}/report`);
  await expect(r.deliveryTable).toBeVisible({ timeout: 30000 });
  // Not 90% delivered yet
  await expect(r.field('ระยะเวลาที่ส่งสำเร็จ 90%')).toHaveText('-');
  const [total, ...rows] = await r.tableRows(r.deliveryTable);
  expect(rows.sort()).toEqual(byPostalCode.map(({ code, done, all }) => [code, percent(done / all), `${done}/${all}`]).sort());
  expect(total).toEqual(['รวมทั้งหมด', percent(meanRate), `${deliveredItems.length}/${order.tracked.length}`]);
}

/**
 * ระยะเวลาที่ส่งสำเร็จ 90%: once 90% of the tracked items are delivered, the latest status_date of any item's update
 * minus the order's dropOffAt, in hours rounded to the nearest (dev's answer, Nov 2026). Delivers every item not
 * delivered yet (a failed one takes updates still, a delivered one no more), the last `hours` after drop off (in the
 * future is fine)
 */
async function expectNinetyPercentTime(portal, backOffice, order, hours) {
  const { dropOffAt } = await backOffice.order(order.id);
  const left = order.tracked.filter((item) => item !== order.delivered);
  for (const [i, item] of left.entries()) {
    const at = new Date(new Date(dropOffAt).getTime() + (i === left.length - 1 ? hours * HOUR : (i + 1) * 0.5 * HOUR));
    await backOffice.updateItemStatus(item.trackingNumber, 'delivered', { at, orderId: order.id });
  }
  const r = portal.orderReportPage;
  await expect(async () => {
    await portal.page.goto(`orders/${order.id}/report`);
    await expect(r.field('ระยะเวลาที่ส่งสำเร็จ 90%')).toHaveText(`${Math.round(hours)} ชั่วโมง`, { timeout: 5000 });
  }).toPass({ timeout: 60000 });
}

test.describe('อัปเดตสถานะจัดส่ง (mock สถานะจากไปรษณีย์)', () => {
  test.skip(ENV_NAME !== 'dev', 'the Thai Post status mock (PATCH order-items/:tracking/status) is only known to be on dev');
  test.describe.configure({ timeout: 4 * 60 * 1000 });

  let backOffice;

  test.beforeAll(async ({ browser }) => {
    backOffice = await BackOfficeApi.open(browser);
  });

  test.afterAll(async () => {
    await backOffice?.close();
  });

  // One order, updated step by step; the cases run in this order
  test.describe('user ปกติ (ใช้ใบเดียวกัน รันตามลำดับ)', () => {
    test.describe.configure({ mode: 'serial' });
    let order;
    let portal;

    test.beforeAll(async ({ browser }, testInfo) => {
      testInfo.setTimeout(4 * 60 * 1000);
      order = await receivedOrder(browser, backOffice, NORMAL_USER);
      portal = await openPortal(browser, NORMAL_USER.state);
    });

    test.afterAll(async () => {
      await portal?.close();
    });

    test.describe('TS06-TC04 user ปกติ ตรวจสอบหน้ารายละเอียดการฝากส่ง แบ่งตามสถานะจัดส่ง (กำลังจัดส่ง)', () => {
      test('user ปกติ: พัสดุชิ้นแรกออกจากที่ทำการ ใบนำส่งเป็นกำลังจัดส่ง', async () => {
        await backOffice.updateItemStatus(order.inTransit.trackingNumber, 'inTransit', { orderId: order.id });
        await expectOrderStatus(portal, order, 'กำลังจัดส่ง', { received: order.tracked.length - 1, inTransit: 1 });
      });
    });

    test.describe('TS07-TC01 user ปกติ ตรวจสอบหน้ารายละเอียดการจัดส่งรายพัสดุสถานะ "กำลังจัดส่ง"', () => {
      test('user ปกติ: พัสดุที่ออกจากที่ทำการแสดงสถานะจากไปรษณีย์ ชิ้นอื่นยังเป็นรับฝาก', async () => {
        await expectItemStatuses(portal, order, { [order.inTransit.trackingNumber]: ITEM_STATUS.inTransit });
      });
    });

    test.describe('TS06-TC04 user ปกติ ตรวจสอบหน้ารายละเอียดการฝากส่ง แบ่งตามสถานะจัดส่ง (ส่งสำเร็จ)', () => {
      test('user ปกติ: ส่งสำเร็จ 1 ชิ้น ใบนำส่งเป็นส่งสำเร็จ ชิ้นที่ส่งไม่สำเร็จไม่เปลี่ยนสถานะใบนำส่ง', async () => {
        await backOffice.updateItemStatus(order.failed.trackingNumber, 'failed', { reason: 'บ้านปิด', orderId: order.id });
        await expectOrderStatus(portal, order, 'กำลังจัดส่ง', { received: order.tracked.length - 2, inTransit: 1, failed: 1 });
        await backOffice.updateItemStatus(order.delivered.trackingNumber, 'delivered', { orderId: order.id });
        await expectOrderStatus(portal, order, 'ส่งสำเร็จ', { received: order.tracked.length - 3, inTransit: 1, delivered: 1, failed: 1 });
      });
    });

    test.describe('TS07-TC03 user ปกติ ตรวจสอบหน้ารายละเอียดการจัดส่งรายพัสดุสถานะ "ส่งสำเร็จ" หรือ "ส่งไม่สำเร็จ"', () => {
      test('user ปกติ: สถานะนำจ่ายสำเร็จ / ไม่สำเร็จ เอกสารยืนยันการจัดส่งกดไม่ได้ (ไม่ใช้ e-AR / ไม่สำเร็จไม่เกิน 30 วัน)', async () => {
        await expectItemStatuses(portal, order, {
          [order.inTransit.trackingNumber]: ITEM_STATUS.inTransit,
          [order.delivered.trackingNumber]: ITEM_STATUS.delivered,
          [order.failed.trackingNumber]: ITEM_STATUS.failed,
        });
        await expectDocumentsDisabled(portal, order);
      });
    });

    test.describe('TS07-TC02 user ปกติ ตรวจสอบการกรองพัสดุ', () => {
      test('user ปกติ: กรองสถานะนำจ่ายสำเร็จ เหลือเฉพาะชิ้นที่ส่งสำเร็จ', async () => {
        await expectStatusFilter(portal, order);
      });
    });

    test.describe('TS08-TC01 user ปกติ ตรวจสอบรายงานการฝากส่ง', () => {
      test('user ปกติ: อัตราการนำจ่ายสำเร็จแยกตามรหัสไปรษณีย์และรวมทั้งหมด', async () => {
        await expectDeliveryRates(portal, order, [order.delivered]);
      });

      test('user ปกติ: ส่งสำเร็จถึง 90% แสดงระยะเวลาที่ส่งสำเร็จ 90% จาก log ล่าสุด', async () => {
        await expectNinetyPercentTime(portal, backOffice, order, 26 + 1 / 6);
      });
    });
  });

  test.describe('user TSD (ใช้ใบเดียวกัน รันตามลำดับ)', () => {
    test.describe.configure({ mode: 'serial' });
    let order;
    let portal;

    test.beforeAll(async ({ browser }, testInfo) => {
      testInfo.setTimeout(4 * 60 * 1000);
      order = await receivedOrder(browser, backOffice, TSD_USER);
      portal = await openPortal(browser, TSD_USER.state);
    });

    test.afterAll(async () => {
      await portal?.close();
    });

    test.describe('TS04-TC04 user TSD ตรวจสอบหน้ารายละเอียดการฝากส่ง แบ่งตามสถานะจัดส่ง (กำลังจัดส่ง)', () => {
      test('user TSD: พัสดุชิ้นแรกออกจากที่ทำการ ใบนำส่งเป็นกำลังจัดส่ง', async () => {
        await backOffice.updateItemStatus(order.inTransit.trackingNumber, 'inTransit', { orderId: order.id });
        await expectOrderStatus(portal, order, 'กำลังจัดส่ง', { received: order.tracked.length - 1, inTransit: 1 });
      });
    });

    test.describe('TS05-TC01 user TSD ตรวจสอบหน้ารายละเอียดการจัดส่งรายพัสดุสถานะ "กำลังจัดส่ง"', () => {
      test('user TSD: พัสดุที่ออกจากที่ทำการแสดงสถานะจากไปรษณีย์ ชิ้นอื่นยังเป็นรับฝาก', async () => {
        await expectItemStatuses(portal, order, { [order.inTransit.trackingNumber]: ITEM_STATUS.inTransit });
      });
    });

    test.describe('TS04-TC04 user TSD ตรวจสอบหน้ารายละเอียดการฝากส่ง แบ่งตามสถานะจัดส่ง (นำส่งแล้ว)', () => {
      test('user TSD: ส่งสำเร็จ 1 ชิ้น ใบนำส่งเป็นนำส่งแล้ว ชิ้นที่ส่งไม่สำเร็จไม่เปลี่ยนสถานะใบนำส่ง', async () => {
        await backOffice.updateItemStatus(order.failed.trackingNumber, 'failed', { reason: 'บ้านปิด', orderId: order.id });
        await expectOrderStatus(portal, order, 'กำลังจัดส่ง', { received: order.tracked.length - 2, inTransit: 1, failed: 1 });
        await backOffice.updateItemStatus(order.delivered.trackingNumber, 'delivered', { orderId: order.id });
        await expectOrderStatus(portal, order, 'นำส่งแล้ว', { received: order.tracked.length - 3, inTransit: 1, delivered: 1, failed: 1 });
      });
    });

    test.describe('TS05-TC03 user TSD ตรวจสอบหน้ารายละเอียดการจัดส่งรายพัสดุสถานะ "นำส่งแล้ว" หรือ "นำส่งไม่สำเร็จ"', () => {
      test('user TSD: สถานะนำจ่ายสำเร็จ / ไม่สำเร็จ เอกสารยืนยันการจัดส่งกดไม่ได้ (ไม่ใช้ e-AR / ไม่สำเร็จไม่เกิน 30 วัน)', async () => {
        await expectItemStatuses(portal, order, {
          [order.inTransit.trackingNumber]: ITEM_STATUS.inTransit,
          [order.delivered.trackingNumber]: ITEM_STATUS.delivered,
          [order.failed.trackingNumber]: ITEM_STATUS.failed,
        });
        await expectDocumentsDisabled(portal, order);
      });
    });

    test.describe('TS05-TC02 user TSD ตรวจสอบการกรองพัสดุ', () => {
      test('user TSD: กรองสถานะนำจ่ายสำเร็จ เหลือเฉพาะชิ้นที่ส่งสำเร็จ', async () => {
        await expectStatusFilter(portal, order);
      });
    });

    test.describe('TS06-TC01 user TSD ตรวจสอบรายงานการฝากส่ง', () => {
      test('user TSD: อัตราการนำจ่ายสำเร็จแยกตามรหัสไปรษณีย์และรวมทั้งหมด', async () => {
        await expectDeliveryRates(portal, order, [order.delivered]);
      });

      test('user TSD: ส่งสำเร็จถึง 90% แสดงระยะเวลาที่ส่งสำเร็จ 90% จาก log ล่าสุด', async () => {
        await expectNinetyPercentTime(portal, backOffice, order, 26 + 1 / 6);
      });
    });
  });
});
