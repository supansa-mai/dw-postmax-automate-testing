const { test, expect } = require('../../../fixtures');
const { readEodItems } = require('../../../helpers/eodItems');
const { readDownload, parseCsv, countBy, grams } = require('../../../helpers/orderData');
const { thaiDate } = require('../../../helpers/thaiDate');
const { BackOfficeApi } = require('../../../helpers/backOfficeApi');
const { expectedSummary, bySummaryKey, baht } = require('../../../helpers/pricing');

const TODAY = thaiDate();

// รายงานการฝากส่ง groups Bangkok and its vicinity (postal codes 10xxx-12xxx, นครปฐม 73xxx and สมุทรสาคร 74xxx) as กรุงเทพมหานคร, seen on dev
const AREAS = ['กรุงเทพมหานคร', 'ต่างจังหวัด'];
const areaOf = (postalCode) => (/^(1[0-2]|7[34])/.test(postalCode) ? 'กรุงเทพมหานคร' : 'ต่างจังหวัด');

test.describe('Orders created from future items (DLT)', () => {
  let order;

  test.beforeAll(() => {
    ({ order } = readEodItems());
  });

  test.describe('TS09-TC01 ตรวจสอบรายการฝากส่ง หลังสร้างใบนำส่งสำเร็จ', () => {
    test('ใบนำส่งใหม่แสดงในรายการ สถานะสร้างแล้ว', async ({ ordersPage }) => {
      await ordersPage.goto();
      const row = ordersPage.row(order.number);
      await expect(ordersPage.cell(row, 'reference')).toHaveText('จากรายการล่วงหน้า');
      await expect(ordersPage.cell(row, 'createdAt')).toHaveText(new RegExp(`^${TODAY} - \\d{2}:\\d{2}$`));
      await expect(ordersPage.cell(row, 'prepared')).toHaveText(String(order.items.length));
      await expect(ordersPage.cell(row, 'received')).toHaveText('0');
      await expect(ordersPage.cell(row, 'status')).toHaveText('สร้างแล้ว');
    });
  });

  test.describe('TS09-TC02 ตรวจสอบรายละเอียดใบนำส่ง จากรายการล่วงหน้า', () => {
    test('ข้อมูลผู้ฝากส่งตรงกับโปรไฟล์ และสรุปบริการแยกตามน้ำหนัก', async ({ profilePage, ordersPage, orderDetailPage: d }) => {
      const count = String(order.items.length);
      await profilePage.goto();
      await expect(profilePage.title).toBeVisible();
      const sender = await profilePage.sender();
      await ordersPage.goto();
      await ordersPage.openDetail(order.number);

      await expect(d.title).toHaveText(`หมายเลขใบนำส่ง : ${order.number}`);
      await expect(d.breadcrumbs).toHaveText(['รายการฝากส่ง', `หมายเลขใบนำส่ง : ${order.number}`]);
      await expect(d.field('สถานะการฝากส่ง')).toHaveText('สร้างแล้ว');
      await expect(d.field('วันที่/เวลาที่สร้าง')).toHaveText(new RegExp(`^${TODAY} - \\d{2}:\\d{2}$`));
      await expect(d.field('วันที่/เวลาที่ปณ.ได้รับ')).toHaveText('-');
      await expect(d.field('ผู้ฝากส่ง')).toHaveText(sender.name);
      await expect(d.field('ชื่อผู้ติดต่อ')).toHaveText(sender.contactName);
      await expect(d.field('อีเมลติดต่อ')).toHaveText(sender.email);
      await expect(d.field('เบอร์ติดต่อ')).toHaveText(sender.phone);
      await expect(d.csvButton).toBeVisible();
      await expect(d.deliveryNoteButton).toBeVisible();
      await expect(d.labelButton).toBeVisible();
      await expect(d.field('เตรียมฝากส่ง')).toHaveText(`${count} ชิ้น`);

      await expect(d.serviceTable.getByRole('row').last()).toContainText('รวมทั้งหมด');
      const rows = await d.tableRows(d.serviceTable);
      const total = rows.pop();
      for (const row of rows) expect(row.slice(0, 3)).toEqual(['EMS', 'Plus DLT', 'ไม่ใช้บริการ']);
      // One row per weight, with the number of items of that weight
      expect(rows.map((row) => [row[3], Number(row[5])]).sort())
        .toEqual(countBy(order.items.map((item) => grams(item.weight))).sort());
      const price = rows.reduce((sum, row) => sum + Number(row[6]), 0).toFixed(2);
      expect(total.slice(-3)).toEqual(['รวมทั้งหมด', count, price]);
      await expect(d.field('ราคารวมทั้งหมด')).toHaveText(`${price} บาท`);
    });
  });

  test.describe('TS09-TC05 ตรวจสอบราคาต่อชิ้นของใบนำส่งจากรายการล่วงหน้า ตามค่าบริการใน Back Office', () => {
    test('ราคาแต่ละรายการ = ค่าส่ง EMS + Plus DLT (+ พื้นที่พิเศษ)', async ({ page, browser, ordersPage, orderDetailPage: d }) => {
      await ordersPage.goto();
      await ordersPage.openDetail(order.number);
      await expect(d.serviceTable.getByRole('row').last()).toContainText('รวมทั้งหมด');
      const id = page.url().match(/orders\/(\d+)/)[1];

      const backOffice = await BackOfficeApi.open(browser);
      const fees = await backOffice.fees();
      const items = order.items.map((item) => ({
        type: 'EMS', service: 'PLUS_DLT', eAr: 'NON', weight: item.weight, postalCode: item.receiverPostalCode, address: item.receiverAddress,
      }));
      const expected = await expectedSummary(fees, items);
      const { preloadedSummary } = await backOffice.order(id);
      await backOffice.close();
      expect(bySummaryKey(preloadedSummary)).toEqual(bySummaryKey(expected));

      const total = expected.reduce((sum, row) => sum + Number(row.totalPrice), 0);
      await expect(d.field('ราคารวมทั้งหมด')).toHaveText(baht(total));
    });
  });

  test.describe('TS09-TC03 ตรวจสอบการดาวน์โหลดเอกสาร', () => {
    test('ดาวน์โหลดเอกสารครบ และ CSV ตรงกับข้อมูลจาก DLT', async ({ ordersPage, orderDetailPage: d }) => {
      // The PDFs are generated on click and can take over 20s on dev for an order that was just created
      test.slow();
      await ordersPage.goto();
      await ordersPage.openDetail(order.number);

      const csv = await d.download(d.csvButton);
      expect(csv.suggestedFilename()).toMatch(new RegExp(`-export-${order.number}\\.csv$`));
      const rows = parseCsv(await readDownload(csv));
      expect(rows).toHaveLength(order.items.length);
      for (const item of order.items) {
        expect(rows.find((row) => row['หมายเลขติดตามพัสดุ'] === item.trackingNumber)).toEqual({
          ID: item.refCode,
          'ประเภทการขนส่ง': 'EMS',
          'บริการ': 'Plus DLT',
          'บริการ e-AR': 'ไม่ใช้บริการ',
          'สินค้า': '',
          'ชื่อผู้รับ': item.receiverName,
          'ที่อยู่': item.receiverAddress,
          'ประเทศ': 'Thailand',
          'รหัสไปรษณีย์': item.receiverPostalCode,
          'เบอร์ติดต่อ': item.receiverPhone,
          'อีเมล': item.receiverEmail,
          'หมายเลขติดตามพัสดุ': item.trackingNumber,
          'น้ำหนักต่อชิ้น (กรัม)': grams(item.weight),
          'ประกันภัย': 'N',
          'มูลค่าประกัน': '0.00',
          'หมายเลขอ้างอิง 1': order.batchRef,
          'หมายเลขอ้างอิง 2': '',
        });
      }

      const deliveryNote = await d.download(d.deliveryNoteButton);
      expect(deliveryNote.suggestedFilename()).toMatch(/-delivery-note\.pdf$/);
      expect((await readDownload(deliveryNote)).subarray(0, 5).toString()).toBe('%PDF-');

      // The label button asks for the envelope size first; each size downloads a zip of PDFs
      for (const size of ['C6', 'DL']) {
        await d.labelButton.click();
        const label = await d.download(d.envelope(size));
        expect(label.suggestedFilename()).toMatch(new RegExp(`-envelop-sticker-${size.toLowerCase()}\\.zip$`));
        const zip = await readDownload(label);
        expect(zip.subarray(0, 2).toString()).toBe('PK');
        expect(zip.includes('.pdf')).toBe(true);
      }
    });
  });

  test.describe('TS09-TC04 ตรวจสอบรายละเอียด รายงานการฝากส่ง (report)', () => {
    test('รายงานของใบนำส่งที่ยังไม่รับฝาก', async ({ profilePage, ordersPage, orderDetailPage, orderReportPage: r }) => {
      const count = String(order.items.length);
      await profilePage.goto();
      await expect(profilePage.title).toBeVisible();
      const { name } = await profilePage.sender();
      await ordersPage.goto();
      await ordersPage.openDetail(order.number);
      // ราคารวมทั้งหมด shows 0.00 until the order is loaded
      await expect(orderDetailPage.serviceTable.getByRole('row').last()).toContainText('รวมทั้งหมด');
      const price = await orderDetailPage.field('ราคารวมทั้งหมด').innerText();
      await ordersPage.goto();
      await ordersPage.openReport(order.number);

      await expect(r.title).toHaveText(`${order.number} : รายงานการฝากส่ง`);
      await expect(r.field('ประเภทเอกสาร')).toHaveText('-');
      await expect(r.field('หมายเลขอ้างอิง')).toHaveText('จากรายการล่วงหน้า');
      await expect(r.field('ผู้ฝากส่ง')).toHaveText(name);
      // Not received at drop off yet, so not exported and nothing delivered
      await expect(r.field('วันที่ส่งออก')).toHaveText('-');
      await expect(r.field('ค่าบริการ')).toHaveText(price);
      await expect(r.field('ระยะเวลาที่ส่งสำเร็จ 90%')).toHaveText('-');

      await expect.poll(() => r.tableRows(r.serviceTable)).toEqual([['EMS', count], ['รวมทั้งหมด', count]]);
      const areas = countBy(order.items.map((item) => areaOf(item.receiverPostalCode)))
        .sort(([a], [b]) => AREAS.indexOf(a) - AREAS.indexOf(b))
        .map(([area, n]) => [area, String(n)]);
      expect(await r.tableRows(r.areaTable)).toEqual([...areas, ['รวมทั้งหมด', count]]);
      const [total, ...postalCodes] = await r.tableRows(r.deliveryTable);
      expect(total).toEqual(['รวมทั้งหมด', '0.00%', `0/${count}`]);
      expect(postalCodes.sort()).toEqual(
        countBy(order.items.map((item) => item.receiverPostalCode)).map(([code, n]) => [code, '0.00%', `0/${n}`]).sort(),
      );
    });
  });
});
