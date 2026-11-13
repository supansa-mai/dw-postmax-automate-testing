const { test, expect } = require('../../fixtures');
const { DROPOFF_STATE } = require('../../config/auth');
const { openPortal } = require('../../helpers/portal');
const { ENV_NAME } = require('../../config/environments');
const { readEodItems } = require('../../helpers/eodItems');
const { BackOfficeApi } = require('../../helpers/backOfficeApi');
const { readDownload, parseCsv, countBy, grams } = require('../../helpers/orderData');
const { thaiDate } = require('../../helpers/thaiDate');

const TODAY = thaiDate();
const FROM_FUTURE_ITEMS = 'จากรายการล่วงหน้า';
const CREATED_TODAY = new RegExp(`^${TODAY} - \\d{2}:\\d{2}$`);

test.describe('Drop Off: orders created from future items (DLT)', () => {
  test.use({ storageState: DROPOFF_STATE });

  /** Created by tests/eod.setup.js, never received */
  let order;
  /** Created by tests/eod.setup.js, received at drop off by TS10-TC04 */
  let receiveOrder;
  /** Created by tests/eod.setup.js, received in part by TS10-TC06 */
  let partialReceiveOrder;

  test.beforeAll(() => {
    ({ order, receiveOrder, partialReceiveOrder } = readEodItems());
  });

  test.describe('TS10-TC01 ตรวจสอบรายการใบนำส่ง DLT ที่ drop off', () => {
    test('ใบนำส่งแสดงในรายการของสาขา สถานะรอรับฝาก', async ({ browser, dropOffOrdersPage: p }) => {
      const portal = await openPortal(browser);
      await portal.profilePage.goto();
      await expect(portal.profilePage.title).toBeVisible();
      const { name } = await portal.profilePage.sender();
      await portal.close();

      await p.goto();
      await p.search(order.number);
      await expect(p.cell(order.number, 'companyName')).toHaveText(name);
      await expect(p.cell(order.number, 'formattedRefNo')).toHaveText(FROM_FUTURE_ITEMS);
      await expect(p.cell(order.number, 'createdAt')).toHaveText(CREATED_TODAY);
      await expect(p.cell(order.number, 'totalOrderItems')).toHaveText(String(order.items.length));
      await p.scrollGrid('end');
      await expect(p.cell(order.number, 'totalDroppedOffOrderItems')).toHaveText('0');
      await expect(p.cell(order.number, 'status')).toHaveText('รอรับฝาก');
    });
  });

  test.describe('TS10-TC02 ตรวจสอบรายละเอียดใบนำส่ง จากรายการล่วงหน้า', () => {
    test('สรุปข้อมูลการฝากส่ง และบริการ EMS / Plus DLT แยกตามน้ำหนัก', async ({ dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
      const count = String(order.items.length);
      await dropOffOrdersPage.goto();
      await dropOffOrdersPage.search(order.number);
      await dropOffOrdersPage.openDetail(order.number);
      await d.waitForOrder();

      await expect(d.title).toHaveText(`รายละเอียดใบนำส่ง : ${order.number}`);
      await expect(d.field('สถานะ')).toHaveText('รอรับฝาก');
      await expect(d.field('หมายเลขใบนำส่ง')).toHaveText(order.number);
      await expect(d.field('หมายเลขอ้างอิง')).toHaveText(FROM_FUTURE_ITEMS);
      await expect(d.field('เตรียมฝากส่ง')).toHaveText(`${count} ชิ้น`);
      await expect(d.field('รับฝากแล้ว')).toHaveText('0 ชิ้น');
      await expect(d.field('วันที่/เวลาที่สร้าง')).toHaveText(CREATED_TODAY);
      await expect(d.csvButton).toBeVisible();

      const rows = await d.tableRows(d.serviceTable);
      const total = rows.pop();
      for (const row of rows) expect(row.slice(0, 3)).toEqual(['EMS', 'Plus DLT', 'ไม่ใช้บริการ']);
      // One row per weight, with the number of items of that weight
      expect(rows.map((row) => [row[3], Number(row[5])]).sort())
        .toEqual(countBy(order.items.map((item) => grams(item.weight))).sort());
      const price = rows.reduce((sum, row) => sum + Number(row[6]), 0).toFixed(2);
      expect(total.slice(-3)).toEqual(['รวมทั้งหมด', count, price]);

      await expect(d.receivedGrid.locator('[role=rowgroup] [role=row]')).toHaveText([`EMS${count}`]);
    });
  });

  test.describe('TS10-TC03 ตรวจสอบการดาวน์โหลดเอกสาร', () => {
    test('CSV รายละเอียดการจัดส่งตรงกับข้อมูลจาก DLT', async ({ dropOffOrdersPage, dropOffOrderDetailPage: d }) => {
      await dropOffOrdersPage.goto();
      await dropOffOrdersPage.search(order.number);
      await dropOffOrdersPage.openDetail(order.number);
      await d.waitForOrder();

      const csv = await d.download(d.csvButton);
      expect(csv.suggestedFilename()).toMatch(/^order-items-\d+\.csv$/);
      const rows = parseCsv(await readDownload(csv));
      expect(rows).toHaveLength(order.items.length);
      for (const item of order.items) {
        const row = rows.find((r) => r['หมายเลขติดตามพัสดุ'] === item.trackingNumber);
        // Drop Off writes weights without trailing zeros, e.g. 22.7
        expect(Number(row['น้ำหนักต่อชิ้น (กรัม)'])).toBe(Number(item.weight));
        expect({ ...row, 'น้ำหนักต่อชิ้น (กรัม)': undefined }).toEqual({
          ID: item.refCode,
          'สถานะจัดส่ง': 'รอรับฝาก',
          'หมายเลขติดตามพัสดุ': item.trackingNumber,
          'ประเภทการขนส่ง': 'EMS',
          'บริการ': 'Plus DLT',
          'บริการ e-AR': 'ไม่ใช้บริการ',
          'สินค้า': '',
          'ชื่อผู้รับ': item.receiverName,
          'ที่อยู่': item.receiverAddress,
          'ประเทศ': 'Thailand',
          'รหัสไปรษณีย์': item.receiverPostalCode,
          'พื้นที่พิเศษ': '-',
          'เบอร์ติดต่อ': item.receiverPhone,
          'อีเมล': item.receiverEmail,
          'น้ำหนักต่อชิ้น (กรัม)': undefined,
          'ประกันภัย': 'N',
          'มูลค่าประกัน': '0',
          'หมายเลขอ้างอิง 1': order.batchRef,
          'หมายเลขอ้างอิง 2': '',
          'หมายเหตุพัสดุ': '-',
        });
      }
    });
  });

  test.describe('Receive at drop off', () => {
    test.describe.configure({ mode: 'serial' });

    test.describe('TS10-TC04 ตรวจสอบการนำเข้าข้อมูลใบนำส่ง DLT', () => {
      test('รับฝากทั้งใบ สถานะเป็นรับฝากสำเร็จทั้ง drop off และการฝากส่งของฉัน', async ({ browser, dropOffOrdersPage: p, dropOffOrderDetailPage: d }) => {
        test.slow();
        const count = String(receiveOrder.items.length);
        await p.goto();
        await p.search(receiveOrder.number);
        await p.openDetail(receiveOrder.number);
        await d.waitForOrder();

        await d.chooseReceiveAll();
        await expect(d.summaryTitle).toHaveText(`สรุปรายการใบนำส่งทั้งหมด : ${receiveOrder.number}`);
        await expect(d.summaryRows).toHaveCount(receiveOrder.items.length);
        for (const item of receiveOrder.items) {
          await expect(d.summaryRows.filter({ hasText: item.trackingNumber })).toContainText(item.receiverPostalCode);
        }
        await d.primaryButton.click();
        await expect(d.receiveDialog).toContainText(receiveOrder.number);
        await expect(d.receiveDialog).toContainText(FROM_FUTURE_ITEMS);
        await expect(d.receiveDialog).toContainText(`${count} ชิ้น`);
        await d.receiveDialog.getByRole('button', { name: 'ยืนยัน' }).click();
        await expect(d.toast).toHaveText('ส่งรายการเข้าสู่ระบบสำเร็จ');

        await expect(async () => {
          await p.goto();
          await p.search(receiveOrder.number);
          await p.scrollGrid('end');
          await expect(p.cell(receiveOrder.number, 'totalDroppedOffOrderItems')).toHaveText(count);
          await expect(p.cell(receiveOrder.number, 'status')).toHaveText('รับฝากสำเร็จ');
        }).toPass({ timeout: 60000 });

        const portal = await openPortal(browser);
        const row = portal.ordersPage.row(receiveOrder.number);
        await expect(async () => {
          await portal.ordersPage.goto();
          await expect(portal.ordersPage.cell(row, 'received')).toHaveText(count);
          await expect(portal.ordersPage.cell(row, 'status')).toHaveText('รับฝากสำเร็จ');
        }).toPass({ timeout: 60000 });
        await portal.ordersPage.openDetail(receiveOrder.number);
        await expect(portal.orderDetailPage.field('สถานะการฝากส่ง')).toHaveText('รับฝากสำเร็จ');
        await expect(portal.orderDetailPage.field('วันที่/เวลาที่ปณ.ได้รับ')).toHaveText(CREATED_TODAY);
        await portal.close();
      });
    });

    test.describe('TS10-TC05 ตรวจสอบการจัดส่งและอัพเดทสถานะรายการ ที่ User DLT', () => {
      test('รายละเอียดการนำส่งและจัดส่ง และรายละเอียดรายพัสดุของใบที่รับฝากแล้ว', async ({ browser }) => {
        const count = String(receiveOrder.items.length);
        const { context, ordersPage, orderDetailPage: d, orderItemsPage } = await openPortal(browser);
        await ordersPage.goto();
        await ordersPage.openDetail(receiveOrder.number);
        await expect(d.deliverySection).toBeVisible();
        await expect(d.field('รับฝากแล้ว')).toHaveText(`${count} ชิ้น`);
        await expect(d.field('สาเหตุที่รับฝากไม่ครบ')).toHaveText('-');
        // Delivery updates come from Thai Post tracking, so a freshly received order has none yet
        expect(await d.tableRows(d.deliveryTable))
          .toEqual([['รับฝากสำเร็จ', count], ['กำลังจัดส่ง', '0'], ['ส่งสำเร็จ', '0'], ['ส่งไม่สำเร็จ', '0']]);

        const csv = parseCsv(await readDownload(await d.download(d.deliveryCsvButton)));
        expect(csv.map((row) => [row['หมายเลขติดตามพัสดุ'], row.ID, row['หมายเลขอ้างอิง 1']]).sort())
          .toEqual(receiveOrder.items.map((item) => [item.trackingNumber, item.refCode, receiveOrder.batchRef]).sort());

        await d.itemsButton.click();
        await expect(orderItemsPage.title).toHaveText(`${receiveOrder.number} : รายละเอียดการจัดส่งรายพัสดุ`);
        const rows = await orderItemsPage.rowValues();
        expect(rows).toHaveLength(receiveOrder.items.length);
        for (const item of receiveOrder.items) {
          expect(rows.find((row) => row.trackingNumber === item.trackingNumber)).toMatchObject({
            refId: item.refCode,
            status: 'รับฝาก',
            type: 'EMS',
            service: 'Plus DLT',
            eArService: 'ไม่ใช้บริการ',
            product: '-',
            receiverName: item.receiverName,
            postalCode: item.receiverPostalCode,
            phone: item.receiverPhone,
            weight: grams(item.weight),
            hasInsurance: 'ไม่มี',
            ref1: receiveOrder.batchRef,
          });
        }
        await context.close();
      });

      test('อัปเดตสถานะกำลังจัดส่ง / ส่งสำเร็จ / ส่งไม่สำเร็จ แสดงในรายละเอียดใบนำส่งและรายพัสดุ', async ({ browser }) => {
        test.skip(ENV_NAME !== 'dev', 'the Thai Post status mock (PATCH order-items/:tracking/status) is only known to be on dev');
        const [inTransit, delivered, failed] = receiveOrder.items;
        const backOffice = await BackOfficeApi.open(browser);
        const { id } = await backOffice.findOrder(receiveOrder.number);
        // Received (103) is saved a moment after drop off and would overwrite an update sent before it
        await expect.poll(async () => (await backOffice.orderItems(id)).every((item) => item.status === '103'),
          { message: `items of ${receiveOrder.number} received`, timeout: 60000, intervals: [2000] }).toBe(true);
        await backOffice.updateItemStatus(inTransit.trackingNumber, 'inTransit', { orderId: id });
        await backOffice.updateItemStatus(delivered.trackingNumber, 'delivered', { orderId: id });
        await backOffice.updateItemStatus(failed.trackingNumber, 'failed', { reason: 'บ้านปิด', orderId: id });
        await backOffice.close();

        const { context, page, orderDetailPage: d, orderItemsPage } = await openPortal(browser);
        await expect(async () => {
          await page.goto(`orders/${id}`);
          await expect(d.field('สถานะการฝากส่ง')).toHaveText('ส่งสำเร็จ', { timeout: 5000 });
          expect(await d.tableRows(d.deliveryTable))
            .toEqual([['รับฝากสำเร็จ', '0'], ['กำลังจัดส่ง', '1'], ['ส่งสำเร็จ', '1'], ['ส่งไม่สำเร็จ', '1']]);
        }).toPass({ timeout: 60000 });

        await d.itemsButton.click();
        const rows = await orderItemsPage.rowValues();
        expect(Object.fromEntries(rows.map((row) => [row.trackingNumber, row.status]))).toEqual({
          [inTransit.trackingNumber]: 'ออกจากที่ทำการ/ศูนย์ไปรษณีย์',
          [delivered.trackingNumber]: 'นำจ่ายสำเร็จ',
          [failed.trackingNumber]: 'นำจ่ายไม่สำเร็จ',
        });
        await context.close();
      });
    });
  });

  test.describe('TS10-TC06 รับฝากใบนำส่ง DLT ไม่ครบ', () => {
    test('สแกนรับฝากบางชิ้นแล้วสิ้นสุดการรับฝาก ชิ้นที่เหลือเป็นยกเลิกรับฝาก', async ({ page, browser, dropOffOrdersPage: p, dropOffOrderDetailPage: d }) => {
      test.slow();
      const { number, batchRef, items } = partialReceiveOrder;
      const received = items.slice(0, -1);
      const [left] = items.slice(-1);
      const reason = 'ขอแก้ไขจ่าหน้า';
      const detail = 'AUTO รับฝากไม่ครบ';

      await p.goto();
      await p.search(number);
      await p.openDetail(number);
      await d.waitForOrder();
      const detailUrl = page.url();

      await d.chooseScanEach();
      await d.scan(received.map((item) => item.trackingNumber));
      await d.primaryButton.click();
      await expect(d.receiveDialog).toContainText(`${received.length} ชิ้น`);
      await expect(d.mismatchWarning).toBeVisible();
      await d.receiveDialog.getByRole('button', { name: 'ยืนยัน' }).click();
      await expect(d.toast).toHaveText('ส่งรายการเข้าสู่ระบบสำเร็จ');

      await expect(async () => {
        await page.goto(detailUrl);
        await d.waitForOrder();
        await expect(d.field('สถานะ')).toHaveText('กำลังรับฝาก');
        await expect(d.field('รับฝากแล้ว')).toHaveText(`${received.length} ชิ้น`);
      }).toPass({ timeout: 60000 });

      await d.finishButton.click();
      await d.finishDialog.getByRole('button', { name: 'ยืนยัน' }).click();
      await expect(d.finishDialog).toContainText('กรุณาเลือกสาเหตุที่รับฝากไม่ครบ');
      await d.finishDialog.getByRole('button', { name: 'ยกเลิก' }).click();
      await d.finishReceiving(reason, detail);
      await expect(d.toast).toHaveText('สิ้นสุดการรับฝากสำเร็จ');

      await expect(async () => {
        await page.goto(detailUrl);
        await d.waitForOrder();
        await expect(d.field('สถานะ')).toHaveText('รับฝากสำเร็จ');
      }).toPass({ timeout: 60000 });
      await expect(d.field('รับฝากแล้ว')).toHaveText(`${received.length} ชิ้น`);
      await expect(d.field('สาเหตุที่รับฝากไม่ครบ')).toHaveText(reason);
      await expect(d.field('รายละเอียดเพิ่มเติม')).toHaveText(detail);

      const portal = await openPortal(browser);
      await portal.ordersPage.goto();
      await portal.ordersPage.openDetail(number);
      await expect(portal.orderDetailPage.field('สถานะการฝากส่ง')).toHaveText('รับฝากสำเร็จ');
      await expect(portal.orderDetailPage.field('รับฝากแล้ว')).toHaveText(`${received.length} ชิ้น`);
      await expect(portal.orderDetailPage.field('สาเหตุที่รับฝากไม่ครบ')).toHaveText(reason);
      await portal.orderDetailPage.itemsButton.click();
      const rows = await portal.orderItemsPage.rowValues();
      expect(rows.map((row) => [row.trackingNumber, row.status, row.ref1]).sort()).toEqual([
        ...received.map((item) => [item.trackingNumber, 'รับฝาก', batchRef]),
        [left.trackingNumber, 'ยกเลิกรับฝาก', batchRef],
      ].sort());
      await portal.close();
    });
  });
});
