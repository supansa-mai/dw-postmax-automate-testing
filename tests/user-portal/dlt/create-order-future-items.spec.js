const { test, expect } = require('../../../fixtures');
const { env } = require('../../../config/environments');
const { USER_STATE } = require('../../../config/auth');
const { CreateFutureItemPage } = require('../../../pages/CreateFutureItemPage');
const { FutureItemsPage } = require('../../../pages/FutureItemsPage');
const { FutureItemsApi, createBatch } = require('../../../helpers/futureItemsApi');
const { readEodItems } = require('../../../helpers/eodItems');
const { thaiDate } = require('../../../helpers/thaiDate');

const TODAY = thaiDate();
const NOT_FOUND = 'ไม่พบหมายเลขติดตามพัสดุนี้';
const SCAN_ANOTHER = 'กรุณานำเข้าข้อมูลพัสดุรายการอื่นเพื่อสร้างใบนำส่ง';
const ORDER_FAILED = 'สร้างใบนำส่งไม่สำเร็จ';
const SHORT_VALUES = ['ABC', '12345', '1234567890TH'];

async function openAnotherBrowser(browser) {
  const context = await browser.newContext({ storageState: USER_STATE, baseURL: `${env.baseURL}/`, timezoneId: 'Asia/Bangkok' });
  const page = await context.newPage();
  return { context, createPage: new CreateFutureItemPage(page), listPage: new FutureItemsPage(page) };
}

// One test at a time: tests share the scanned items and dev's API is rate limited per huid
test.describe.configure({ mode: 'default' });

test.describe('Create order from future items (DLT)', () => {
  let groups;

  test.beforeAll(() => {
    ({ groups } = readEodItems());
  });

  test.beforeEach(async ({ createFutureItemPage }) => {
    await createFutureItemPage.goto();
  });

  test.describe('TS01-TC04 step 3 สแกนหมายเลขติดตามของบริษัท DLT อื่น', () => {
    test('สแกนพัสดุของบริษัทอื่น ขึ้นไม่พบ', async ({ request, createFutureItemPage: p }) => {
      const { dltB } = env;
      test.skip(!(dltB.huid && dltB.secretKey), 'DLT_B_HUID / DLT_B_SECRET_KEY (second DLT company) not set in .env');
      const { items: [item] } = await createBatch(new FutureItemsApi(request, { apiURL: env.apiURL, dlt: dltB }), 1);

      await p.scan(item.trackingNumber);
      await expect(p.dialog(NOT_FOUND)).toBeVisible();
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
    });
  });

  test.describe('TS06-TC01 ผู้ใช้งาน DLT สามารถเห็นหน้า "สร้างใบนำส่ง"', () => {
    test('หน้าเริ่มต้นยังไม่มีรายการ ปุ่มกดไม่ได้', async ({ createFutureItemPage: p }) => {
      await expect(p.title).toBeVisible();
      await expect(p.breadcrumbList).toHaveText('รายการพัสดุล่วงหน้า (DLT)');
      await expect(p.breadcrumbCurrent).toHaveText('สร้างใบนำส่ง');
      await expect(p.scanTitle).toBeVisible();
      await expect(p.page.getByText('หรือกรอกหมายเลขติดตามพัสดุเพื่อนำเข้าข้อมูลเพื่อสร้างใบนำส่ง')).toBeVisible();
      await expect(p.scanInput).toBeEditable();
      await expect(p.listTitle).toBeVisible();
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
      await expect(p.deleteButton).toHaveText('ลบรายการ (0)');
      await expect(p.deleteButton).toBeDisabled();
      await expect(p.emptyState).toBeVisible();
      await expect(p.page.getByText('เพื่อนำเข้าข้อมูลเพื่อสร้างใบนำส่ง', { exact: true })).toBeVisible();
      await expect(p.cancelButton).toBeEnabled();
      await expect(p.createButton).toBeDisabled();
    });

    test('เข้าจากหน้ารายการ และ breadcrumb กลับโดยคงตัวกรอง', async ({ futureItemsPage, createFutureItemPage: p }) => {
      const { batchRef } = groups.scan;
      await futureItemsPage.openBatch(batchRef, TODAY);
      await futureItemsPage.createShipmentButton.click();
      await expect(p.page).toHaveURL(/\/th\/future-items\/create/);

      await p.breadcrumbList.click();
      await expect(p.page).toHaveURL(/\/th\/future-items(?!\/create)/);
      await expect(futureItemsPage.startDate).toHaveValue(TODAY);
      await expect(futureItemsPage.endDate).toHaveValue(TODAY);
      await expect(futureItemsPage.batchFilter).toHaveValue(batchRef);
    });
  });

  test.describe('TS06-TC02 นำเข้ารายการพัสดุสำเร็จ - ชำระเงินแล้ว และรอสร้างใบนำส่ง', () => {
    test('สแกนพัสดุที่ชำระเงินแล้วเข้าตาราง', async ({ createFutureItemPage: p }) => {
      const [first, second] = groups.scan.paid;
      const [otherBatch, lowercase] = groups.scanOtherBatch.paid;

      await p.scan(first.trackingNumber);
      await expect(p.total).toHaveText('ทั้งหมด 1 รายการ');
      await expect(p.scanInput).toHaveValue('');
      expect(await p.visibleColumnHeaders()).toEqual(['หมายเลขติดตาม', 'หมายเลขอ้างอิง (DLT)', 'ชื่อผู้รับ', 'เบอร์โทรศัพท์', 'อีเมล']);
      for (const value of [first.trackingNumber, first.refCode, first.receiverName, first.receiverPhone, first.receiverEmail]) {
        await expect(p.row(first.trackingNumber)).toContainText(value);
      }

      await p.scanItems([second, otherBatch]);
      await p.scan(lowercase.trackingNumber.toLowerCase());
      await expect(p.total).toHaveText('ทั้งหมด 4 รายการ');
      await expect(p.row(lowercase.trackingNumber)).toBeVisible();
    });
  });

  test.describe('TS06-TC03 นำเข้ารายการพัสดุไม่สำเร็จ - ไม่พบหมายเลขติดตาม', () => {
    test('หมายเลขที่ไม่มีในระบบ ขึ้นไม่พบ', async ({ createFutureItemPage: p }) => {
      await p.scan('XX000000000TH');
      const dialog = p.dialog(NOT_FOUND);
      await expect(dialog).toContainText('กรุณาตรวจสอบ และลองอีกครั้ง');
      await dialog.getByRole('button', { name: 'ตกลง' }).click();
      await expect(dialog).toBeHidden();
      await expect(p.scanInput).toHaveValue('');
      await expect(p.scanInput).toBeFocused();
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
    });

    test('พิมพ์ครบ 13 หลักนำเข้าเองโดยไม่ต้องกด Enter', async ({ createFutureItemPage: p }) => {
      for (const value of SHORT_VALUES) await p.scanInput.fill(value);
      const [item] = groups.scan.paid;
      await p.scanInput.fill(item.trackingNumber);
      await expect(p.total).toHaveText('ทั้งหมด 1 รายการ');
      await expect(p.row(item.trackingNumber)).toBeVisible();
      await expect(p.page.getByRole('dialog')).toHaveCount(0);
    });

    test('พิมพ์ไม่ครบ 13 หลักแล้วกด Enter ขึ้นไม่พบ', async ({ createFutureItemPage: p }) => {
      for (const value of SHORT_VALUES) {
        await p.scan(value);
        const dialog = p.dialog(NOT_FOUND);
        await dialog.getByRole('button', { name: 'ตกลง' }).click();
        await expect(dialog).toBeHidden();
      }
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
    });

    test('กรอกหมายเลขอ้างอิง (DLT) แทน ขึ้นไม่พบ', async ({ createFutureItemPage: p }) => {
      await p.scan(groups.scan.paid[0].refCode);
      await expect(p.dialog(NOT_FOUND)).toBeVisible();
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
    });
  });

  test.describe('TS06-TC04 นำเข้ารายการพัสดุไม่สำเร็จ - ยังไม่ชำระเงิน', () => {
    test('สแกนพัสดุที่ยังไม่ชำระเงิน ไม่นำเข้า', async ({ futureItemsApi, createFutureItemPage: p }) => {
      const { items: [unpaid] } = await createBatch(futureItemsApi, 1);
      expect(unpaid.paymentStatus).toBe('UNPAID');

      await p.scan(unpaid.trackingNumber);
      await expect(p.dialog('พัสดุนี้ยังไม่ชำระเงิน')).toContainText(SCAN_ANOTHER);
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
    });
  });

  test.describe('TS06-TC05 นำเข้ารายการพัสดุไม่สำเร็จ - สร้างใบนำส่งแล้ว', () => {
    test('สแกนพัสดุที่สร้างใบนำส่งแล้ว ไม่นำเข้า', async ({ createFutureItemPage: p }) => {
      const [item] = groups.ordered.paid;
      await p.scanItems([item]);
      await p.createOrder();
      await expect(p.page).toHaveURL(/\/th\/orders/);

      await p.goto();
      await p.scan(item.trackingNumber);
      await expect(p.dialog('พัสดุนี้ถูกสร้างใบนำส่งแล้ว')).toContainText(SCAN_ANOTHER);
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
    });
  });

  test.describe('TS05-TC02 ยกเลิกไม่ได้เมื่อสร้างใบนำส่งแล้ว', () => {
    test('ยกเลิกพัสดุที่สร้างใบนำส่งแล้วไม่ได้', async ({ futureItemsPage }) => {
      const { batchRef, paid: [item] } = groups.ordered;
      await futureItemsPage.openBatch(batchRef, TODAY);
      await futureItemsPage.scrollGrid('end');
      await expect(futureItemsPage.cell(item.id, 'status')).toHaveText('สร้างใบนำส่งแล้ว');
      await expect(futureItemsPage.cancelButton(item.id)).toBeDisabled();
    });
  });

  test.describe('TS06-TC06 นำเข้ารายการพัสดุไม่สำเร็จ - ถูกยกเลิกแล้ว (รวม TS05-TC01 step 6)', () => {
    test('สแกนพัสดุที่ถูกยกเลิก ไม่นำเข้า', async ({ futureItemsApi, futureItemsPage, createFutureItemPage: p }) => {
      const { batchRef, items: [item] } = await createBatch(futureItemsApi, 1);
      await futureItemsPage.openBatch(batchRef, TODAY);
      await futureItemsPage.cancelItem(item.id);
      await expect(futureItemsPage.cell(item.id, 'status')).toHaveText('ยกเลิก');

      await p.goto();
      await p.scan(item.trackingNumber);
      await expect(p.dialog('พัสดุนี้ถูกยกเลิกแล้ว')).toContainText(SCAN_ANOTHER);
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
    });
  });

  test.describe('TS06-TC07 ตรวจสอบการสแกนหมายเลขติดตามซ้ำในรายการเดียวกัน', () => {
    test('สแกนซ้ำไม่เพิ่มรายการ', async ({ createFutureItemPage: p }) => {
      const [item] = groups.scan.paid;
      await p.scanItems([item]);

      await p.scan(item.trackingNumber);
      await expect(p.toast).toContainText('รายการนี้อยู่ในตารางแล้ว');
      await expect(p.total).toHaveText('ทั้งหมด 1 รายการ');
    });
  });

  test.describe('TS06-TC08 ตรวจสอบการค้นหาในตารางรายการพัสดุ', () => {
    test('ค้นหาและเปลี่ยนหน้าในตารางที่สแกน', async ({ createFutureItemPage: p }) => {
      const items = [...groups.scan.paid, ...groups.scanOtherBatch.paid];
      await p.scanItems(items);
      await expect(p.paginationLabel).toHaveText(`1–10 of ${items.length}`);
      await p.nextPageButton.click();
      await expect(p.paginationLabel).toHaveText(`11–${items.length} of ${items.length}`);
      await expect(p.rows).toHaveCount(items.length - 10);

      const [target] = items;
      await p.searchInput.fill(target.trackingNumber);
      await expect.poll(() => p.visibleTrackingNumbers()).toEqual([target.trackingNumber]);
      await p.searchInput.fill(target.refCode);
      await expect.poll(() => p.visibleTrackingNumbers()).toEqual([target.trackingNumber]);
      await p.searchInput.fill('XX000000000TH');
      await expect(p.rows).toHaveCount(0);
      await expect(p.grid).toContainText('ไม่พบ');
    });
  });

  test.describe('TS06-TC10 ตรวจสอบการเก็บรายการที่สแกนไว้ (Local storage)', () => {
    test('รายการที่สแกนยังอยู่หลัง refresh แต่อีก browser ไม่เห็น', async ({ browser, basePage, createFutureItemPage: p }) => {
      const items = groups.scan.paid.slice(0, 5);
      await p.scanItems(items);

      await p.page.reload();
      await expect(p.total).toHaveText('ทั้งหมด 5 รายการ');

      await basePage.menuLink('การฝากส่งของฉัน').click();
      await expect(p.page).toHaveURL(/\/th\/orders/);
      await p.goto();
      await expect(p.total).toHaveText('ทั้งหมด 5 รายการ');

      const other = await openAnotherBrowser(browser);
      await other.createPage.goto();
      await expect(other.createPage.total).toHaveText('ทั้งหมด 0 รายการ');
      await other.context.close();
    });

    test('เก็บเวลาที่สแกนชิ้นแรก ไม่เปลี่ยนเมื่อสแกนเพิ่มหรือ refresh', async ({ createFutureItemPage: p }) => {
      const [first, second] = groups.scan.paid;
      const before = Date.now();
      await p.scanItems([first]);
      const { firstScannedAt, items } = await p.storedScan();
      expect(firstScannedAt).toBeGreaterThanOrEqual(before);
      expect(firstScannedAt).toBeLessThanOrEqual(Date.now());
      expect(items.map((item) => item.trackingNumber)).toEqual([first.trackingNumber]);

      await p.scanItems([second]);
      expect(await p.storedScan()).toMatchObject({ firstScannedAt, items: [{}, {}] });
      await p.page.reload();
      await expect(p.total).toHaveText('ทั้งหมด 2 รายการ');
      expect((await p.storedScan()).firstScannedAt).toBe(firstScannedAt);
    });

    test('รายการที่สแกนไว้เกิน 1 วันถูกล้าง', async ({ createFutureItemPage: p }) => {
      const hour = 60 * 60 * 1000;
      await p.scanItems(groups.scan.paid.slice(0, 2));

      await p.setFirstScannedAt(Date.now() - 23 * hour);
      await p.page.reload();
      await expect(p.total).toHaveText('ทั้งหมด 2 รายการ');

      await p.setFirstScannedAt(Date.now() - 24 * hour - 60 * 1000);
      await p.page.reload();
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
      await expect(p.emptyState).toBeVisible();
    });
  });

  test.describe('TS07-TC01 ตรวจสอบปุ่มลบรายการ', () => {
    test('ปุ่มลบนับตามรายการที่เลือก', async ({ createFutureItemPage: p }) => {
      const items = [...groups.scan.paid, ...groups.scanOtherBatch.paid];
      await p.scanItems(items);
      await expect(p.deleteButton).toHaveText('ลบรายการ (0)');
      await expect(p.deleteButton).toBeDisabled();

      await p.toggle(items.at(-1).trackingNumber);
      await p.toggle(items.at(-2).trackingNumber);
      await expect(p.deleteButton).toHaveText('ลบรายการ (2)');
      await expect(p.deleteButton).toBeEnabled();
      await p.toggle(items.at(-1).trackingNumber);
      await p.toggle(items.at(-2).trackingNumber);
      await expect(p.deleteButton).toHaveText('ลบรายการ (0)');

      await p.toggleAll();
      await expect(p.deleteButton).toHaveText(`ลบรายการ (${items.length})`);
      await p.toggleAll();
      await expect(p.deleteButton).toHaveText('ลบรายการ (0)');
      await expect(p.deleteButton).toBeDisabled();
    });
  });

  test.describe('TS07-TC02 ผู้ใช้งานสามารถลบรายการพัสดุที่นำเข้า', () => {
    test('ลบรายการที่เลือก แล้วสแกนกลับมาได้', async ({ futureItemsPage, createFutureItemPage: p }) => {
      const items = groups.scan.paid;
      const removed = items.slice(0, 2);
      await p.scanItems(items);
      for (const { trackingNumber } of removed) await p.toggle(trackingNumber);

      await p.deleteButton.click();
      const dialog = p.dialog('ลบรายการพัสดุ?');
      await expect(dialog).toContainText('2 รายการ');
      await expect(dialog).toContainText('หากคุณต้องการคืนค่ารายการนี้ คุณสามารถสแกนหรือกรอกเพื่อนำเข้าข้อมูลอีกครั้งได้');
      await dialog.getByRole('button', { name: 'กลับ' }).click();
      await expect(dialog).toBeHidden();
      await expect(p.deleteButton).toHaveText('ลบรายการ (2)');

      await p.deleteSelected();
      await expect(p.toast).toContainText('ลบรายการพัสดุสำเร็จ');
      await expect(p.total).toHaveText(`ทั้งหมด ${items.length - 2} รายการ`);
      await expect(p.deleteButton).toHaveText('ลบรายการ (0)');
      for (const { trackingNumber } of removed) await expect(p.row(trackingNumber)).toHaveCount(0);

      await futureItemsPage.openBatch(groups.scan.batchRef, TODAY);
      await futureItemsPage.scrollGrid('end');
      for (const { id } of removed) await expect(futureItemsPage.cell(id, 'status')).toHaveText('รอสร้างใบนำส่ง');

      await p.goto();
      await p.scanItems(removed.slice(0, 1));
      await expect(p.row(removed[0].trackingNumber)).toBeVisible();
    });
  });

  test.describe('TS07-TC03 ตรวจสอบการลบรายการทั้งหมด', () => {
    test('ลบทั้งหมดแล้วตารางว่าง', async ({ createFutureItemPage: p }) => {
      await p.scanItems(groups.scan.paid.slice(0, 3));
      await p.toggleAll();
      await p.deleteSelected();

      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
      await expect(p.emptyState).toBeVisible();
      await expect(p.createButton).toBeDisabled();
    });
  });

  test.describe('TS08-TC01 ผู้ใช้งาน DLT สามารถสร้างใบนำส่งจากรายการพัสดุล่วงหน้า', () => {
    test('สร้างใบนำส่งสำเร็จ', async ({ ordersPage, futureItemsPage, createFutureItemPage: p }) => {
      const { batchRef, paid: items } = groups.createOrder;
      await p.scanItems(items);

      await p.createButton.click();
      const dialog = p.dialog('สร้างใบนำส่ง?');
      await expect(dialog).toContainText(`${items.length} รายการ`);
      await dialog.getByRole('button', { name: 'ยกเลิก' }).click();
      await expect(dialog).toBeHidden();
      await expect(p.total).toHaveText(`ทั้งหมด ${items.length} รายการ`);

      await p.createOrder();
      await expect(p.page).toHaveURL(/\/th\/orders/);
      // e.g. "สร้างใบนำส่งสำเร็จ เลขที่เอกสาร: PM112600320002"
      await expect(p.toast).toContainText(/สร้างใบนำส่งสำเร็จ เลขที่เอกสาร: PM\d+/);
      const [orderNumber] = (await p.toast.innerText()).match(/PM\d+/);
      await ordersPage.waitForRows();
      const order = ordersPage.rows.first();
      await expect(ordersPage.cell(order, 'orderNumber')).toHaveText(orderNumber);
      await expect(ordersPage.cell(order, 'reference')).toHaveText('จากรายการล่วงหน้า');
      await expect(ordersPage.cell(order, 'prepared')).toHaveText(String(items.length));
      await expect(ordersPage.cell(order, 'status')).toHaveText('สร้างแล้ว');

      // TS06-TC10 step 5: the scanned list is cleared once the order is created
      await p.goto();
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');

      await futureItemsPage.openBatch(batchRef, TODAY);
      await expect(futureItemsPage.summaryCount('pending')).toHaveText('0');
      await expect(futureItemsPage.summaryCount('converted')).toHaveText(String(items.length));
      await futureItemsPage.scrollGrid('end');
      for (const { id } of items) {
        await expect(futureItemsPage.cell(id, 'status')).toHaveText('สร้างใบนำส่งแล้ว');
        await expect(futureItemsPage.cancelButton(id)).toBeDisabled();
      }
    });
  });

  // CPM-1805: the order is validated again on confirm; items changed in the meantime are listed and removed
  test.describe('TS08-TC02 รายการถูกสร้างใบนำส่งจากอีก browser ก่อนยืนยัน', () => {
    test('รายการถูกสร้างใบนำส่งจากอีก browser ระบบเอาออกให้', async ({ browser, createFutureItemPage: p }) => {
      const [taken, kept] = groups.orderedElsewhere.paid;
      await p.scanItems([taken, kept]);

      const other = await openAnotherBrowser(browser);
      await other.createPage.goto();
      await other.createPage.scanItems([taken]);
      await other.createPage.createOrder();
      await expect(other.createPage.page).toHaveURL(/\/th\/orders/);
      await other.context.close();

      await p.createOrder();
      const dialog = p.dialog(ORDER_FAILED);
      await expect(dialog).toContainText(taken.trackingNumber);
      await expect(dialog).toContainText(taken.refCode);
      await expect(dialog).not.toContainText(kept.trackingNumber);
      await dialog.getByRole('button').last().click();
      await expect(p.row(taken.trackingNumber)).toHaveCount(0);
      await expect(p.total).toHaveText('ทั้งหมด 1 รายการ');
    });
  });

  test.describe('TS05-TC04 ตรวจสอบการยกเลิกรายการที่อยู่ระหว่างนำเข้าในหน้าสร้างใบนำส่ง', () => {
    test('รายการถูกยกเลิกจากอีก browser ระบบเอาออกให้', async ({ browser, createFutureItemPage: p }) => {
      const { batchRef, paid: [cancelled, kept] } = groups.cancelledElsewhere;
      await p.scanItems([cancelled, kept]);

      const other = await openAnotherBrowser(browser);
      await other.listPage.openBatch(batchRef, TODAY);
      await other.listPage.cancelItem(cancelled.id);
      await expect(other.listPage.cell(cancelled.id, 'status')).toHaveText('ยกเลิก');
      await other.context.close();

      await p.createOrder();
      const dialog = p.dialog(ORDER_FAILED);
      await expect(dialog).toContainText(cancelled.trackingNumber);
      await expect(dialog).toContainText(cancelled.refCode);
      await dialog.getByRole('button').last().click();
      await expect(p.row(cancelled.trackingNumber)).toHaveCount(0);
      await expect(p.total).toHaveText('ทั้งหมด 1 รายการ');
    });
  });

  test.describe('TS08-TC04 ตรวจสอบปุ่มสร้างใบนำส่งเมื่อยังไม่มีรายการ', () => {
    test('ยังไม่นำเข้ารายการ ปุ่มสร้างใบนำส่ง disable', async ({ createFutureItemPage: p }) => {
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
      await expect(p.createButton).toBeDisabled();
    });
  });

  test.describe('TS08-TC05 ผู้ใช้งานสามารถยกเลิกการสร้างใบนำส่ง', () => {
    test('ยกเลิกการสร้างใบนำส่ง ล้างรายการที่สแกน', async ({ futureItemsPage, createFutureItemPage: p }) => {
      const items = groups.scan.paid;
      await p.scanItems(items);

      await p.cancelButton.click();
      const dialog = p.dialog('ยกเลิกการสร้างใบนำส่ง?');
      await expect(dialog).toContainText('หากยกเลิกการสร้างใบนำส่ง ข้อมูลจะถูกลบและต้องทำรายการใหม่ทั้งหมด');
      await dialog.getByRole('button', { name: 'ยกเลิก' }).click();
      await expect(dialog).toBeHidden();
      await expect(p.total).toHaveText(`ทั้งหมด ${items.length} รายการ`);

      await p.cancelButton.click();
      await dialog.getByRole('button', { name: 'ยืนยัน' }).click();
      // TS06-TC10 step 6: cleared after cancelling
      await p.goto();
      await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');

      await futureItemsPage.openBatch(groups.scan.batchRef, TODAY);
      await futureItemsPage.scrollGrid('end');
      for (const { id } of items) await expect(futureItemsPage.cell(id, 'status')).toHaveText('รอสร้างใบนำส่ง');
    });
  });
});

// Logs in afresh: logging out the shared saved session could end it for the other tests
test.describe('TS06-TC10 step 9 Log out แล้ว Log in ใหม่บน browser เดิม', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  let groups;

  test.beforeAll(() => {
    ({ groups } = readEodItems());
  });

  test.beforeEach(async ({ loginPage, createFutureItemPage }) => {
    await loginPage.loginAs(env.user, 'DLT_USER_EMAIL / DLT_USER_PASSWORD');
    await createFutureItemPage.goto();
  });

  test('ผู้ใช้งานเดิม log in ใหม่ เห็นรายการที่สแกนค้างไว้', async ({ basePage, loginPage, createFutureItemPage: p }) => {
    const items = groups.scan.paid.slice(0, 2);
    await p.scanItems(items);

    await basePage.logout();
    await loginPage.loginAs(env.user, 'DLT_USER_EMAIL / DLT_USER_PASSWORD');
    await p.goto();
    await expect(p.total).toHaveText('ทั้งหมด 2 รายการ');
    for (const { trackingNumber } of items) await expect(p.row(trackingNumber)).toBeVisible();
  });

  test('ผู้ใช้งานอื่น log in บน browser เดิม ไม่เห็นรายการของผู้ใช้งานคนก่อน', async ({ basePage, loginPage, createFutureItemPage: p }) => {
    const { dltB } = env;
    test.skip(!(dltB.user.email && dltB.user.password), 'DLT_B_USER_* (another DLT user) not set in .env');
    await p.scanItems(groups.scan.paid.slice(0, 2));

    await basePage.logout();
    await loginPage.loginAs(dltB.user, 'DLT_B_USER_EMAIL / DLT_B_USER_PASSWORD');
    await p.goto();
    await expect(p.total).toHaveText('ทั้งหมด 0 รายการ');
  });
});
