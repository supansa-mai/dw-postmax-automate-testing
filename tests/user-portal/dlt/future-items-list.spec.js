/**
 * รายการพัสดุล่วงหน้า (DLT) — User Portal /th/future-items
 * Test cases: sheet "User Portal_DLT" > SCENARIO 1 (TS01-*) menu access by DLT flag (UI only),
 *   SCENARIO 4 (TS04-*) list, SCENARIO 5 (TS05-*) cancel
 * Jira: CPM-1756, CPM-1792 (sorting)
 * Figma: "Future Items (DLT)" > Search&Filter / Future List, ลบรายการ
 *
 * Each test creates its own batch through the Create Future Items API and filters the list by
 * today + that batch, so card counts and rows only come from data the test created.
 * Not covered here: TS01-TC03 step 4 (DLT APIs with a non-DLT token) belongs to the API specs;
 * TS01-TC04 (items of another DLT company) needs a second DLT company account; TS05-TC01 step 6 (scan a cancelled item) and TS05-TC04 (cancelled while
 * scanned by another user, CPM-1805) belong to the scan / create shipment specs.
 */
const { test, expect } = require('../../../fixtures');
const { env } = require('../../../config/environments');
const { FutureItemsApi, buildPayload, uniqueRefCodes } = require('../../../helpers/futureItemsApi');
const { thaiDate, thaiDateTime, daysFromNow } = require('../../../helpers/thaiDate');

const TODAY = thaiDate();
const STATUS = { PENDING: 'รอสร้างใบนำส่ง', CONVERTED: 'สร้างใบนำส่งแล้ว', CANCELLED: 'ยกเลิก' };
const PAYMENT = { PAID: 'ชำระเงินแล้ว', UNPAID: 'ยังไม่ชำระเงิน' };
// Top menu of a DLT user; the sheet says "หน้าแรก", the portal shows "หน้าหลัก"
const DLT_MENU = 'รายการพัสดุล่วงหน้า (DLT)';
const MENU = ['หน้าหลัก', 'เตรียมการฝากส่ง', DLT_MENU, 'การฝากส่งของฉัน', 'รายงานข้อมูล'];
const NON_DLT_MENU = MENU.filter((name) => name !== DLT_MENU);
const COLUMNS = [
  'Batch No.', 'หมายเลขอ้างอิง (DLT)', 'หมายเลขติดตาม', 'ชื่อผู้รับ', 'เบอร์โทรศัพท์', 'อีเมล',
  'วันที่ได้รับข้อมูล', 'สถานะ', 'สถานะการชำระเงิน', 'จัดการ',
];

/** Creates `count` future items in one batch; returns them with id / trackingNumber / paymentStatus */
async function createBatch(api, count, batchRef) {
  const payload = buildPayload({ refCodes: uniqueRefCodes(count), ...(batchRef && { batchRef }) });
  const response = await api.create(payload);
  expect(response.status(), await response.text()).toBe(201);
  const { data } = await response.json();
  const items = payload.items.map((item) => ({ ...item, ...data.items.find((i) => i.refCode === item.refCode) }));
  return { batchRef: payload.batchRef, items };
}

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function unpaidCount(items) {
  return items.filter((i) => i.paymentStatus === 'UNPAID').length;
}

/** Logs in with another account; use with an empty storageState so the saved DLT session is not reused */
async function loginAs(loginPage, account, label) {
  expect(account.email && account.password, `${label} not set in .env`).toBeTruthy();
  await loginPage.goto();
  await loginPage.login(account);
  await expect(loginPage.page).not.toHaveURL(/log-in/);
}

// Polls because the old rows stay on screen until the request for the new filter returns
async function expectRows(futureItemsPage, items) {
  const byId = (a, b) => a - b;
  await expect.poll(async () => (await futureItemsPage.visibleRowIds()).sort(byId)).toEqual(items.map((i) => i.id).sort(byId));
}

// One test at a time: dev API's DB pool is only 3 connections and returns 500 under concurrent load
test.describe.configure({ mode: 'default' });

test.describe('Future Items list (DLT)', () => {
  test.describe('TS01-TC01 ผู้ใช้งาน DLT สามารถเห็นเมนู "รายการพัสดุล่วงหน้า (DLT)"', () => {
    test('เมนูแสดงถัดจาก เตรียมการฝากส่ง และกดแล้วเข้าหน้ารายการ พร้อม highlight เมนู', async ({ basePage, futureItemsPage, page }) => {
      await basePage.goto();
      await expect(basePage.menuLinks).toHaveText(MENU);

      await basePage.menuLink(DLT_MENU).click();
      await expect(page).toHaveURL(/\/th\/future-items/);
      await expect(futureItemsPage.title).toBeVisible();
      for (const name of MENU) {
        await expect(basePage.menuLabel(name)).toHaveCSS('font-weight', name === DLT_MENU ? '700' : '400');
      }
    });
  });

  test.describe('TS01-TC02 ผู้ใช้งานที่ไม่มี flag DLT ไม่เห็นเมนู "รายการพัสดุล่วงหน้า (DLT)"', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('ผู้ใช้งานทั่วไป ไม่เห็นเมนู DLT และเมนูอื่นแสดงตามเดิม', async ({ basePage, loginPage }) => {
      await loginAs(loginPage, env.normalUser, 'NORMAL_USER_EMAIL / NORMAL_USER_PASSWORD');
      await expect(basePage.menuLinks).toHaveText(NON_DLT_MENU);
    });

    test('ผู้ใช้งาน TSD ไม่เห็นเมนู DLT และเมนูของ TSD แสดงตามเดิม', async ({ basePage, loginPage }) => {
      await loginAs(loginPage, env.tsdUser, 'TSD_USER_EMAIL / TSD_USER_PASSWORD');
      await expect(basePage.menuLinks).toHaveText([...NON_DLT_MENU, 'รายงานประจำเดือน']);
    });
  });

  test.describe('TS01-TC03 ผู้ใช้งานที่ไม่มี flag DLT เข้าหน้า DLT ผ่าน URL โดยตรงไม่ได้', () => {
    // Today normal and TSD users can still open /future-items directly
    test.fixme('เปิด URL หน้ารายการ / หน้าสร้างใบนำส่ง (DLT) โดยตรงไม่ได้ (On Hold)', async () => {});
  });

  test.describe('TS04-TC01 ผู้ใช้งาน DLT เห็นหน้า "รายการพัสดุล่วงหน้า (DLT)" - Default', () => {
    test('เมนูพาไปหน้ารายการ และหน้าแสดงค่า default ก่อนเลือกวันที่', async ({ futureItemsPage, page }) => {
      await page.goto('');
      await page.getByRole('link', { name: 'รายการพัสดุล่วงหน้า (DLT)' }).click();
      await expect(page).toHaveURL(/\/th\/future-items/);

      await expect(futureItemsPage.title).toBeVisible();
      await expect(futureItemsPage.listTitle).toBeVisible();
      await expect(futureItemsPage.createShipmentButton).toBeVisible();
      await expect(futureItemsPage.startDate).toHaveValue('');
      await expect(futureItemsPage.endDate).toHaveValue('');
      for (const filter of [futureItemsPage.batchFilter, futureItemsPage.statusFilter, futureItemsPage.paymentFilter]) {
        await expect(filter).toHaveValue('ทั้งหมด');
        await expect(filter).toBeDisabled();
      }
      await expect(futureItemsPage.searchField).toHaveText('ชื่อผู้รับ');
      await expect(futureItemsPage.searchInput).toHaveAttribute('placeholder', 'ค้นหาชื่อผู้รับ');
      await expect(futureItemsPage.emptyState).toContainText('ตั้งค่าการค้นหา');
      await expect(futureItemsPage.emptyState).toContainText('เพื่อเรียกดูข้อมูลรายการพัสดุล่วงหน้า');
      await expect(futureItemsPage.summaryCount('all')).toBeHidden();
      await expect(futureItemsPage.grid).toBeHidden();
    });
  });

  test.describe('TS04-TC02 เลือกช่วงวันที่ได้รับข้อมูล', () => {
    test.beforeEach(async ({ futureItemsPage }) => {
      await futureItemsPage.goto();
    });

    test('เลือกวันที่เริ่มต้นอย่างเดียว ยังไม่แสดงข้อมูล', async ({ futureItemsPage }) => {
      await futureItemsPage.startDate.fill(TODAY);
      await futureItemsPage.startDate.blur();
      await expect(futureItemsPage.emptyState).toBeVisible();
      await expect(futureItemsPage.batchFilter).toBeDisabled();
      await expect(futureItemsPage.grid).toBeHidden();
    });

    test('เลือกวันเดียวกัน แสดงการ์ดสรุป ตาราง และ dropdown enable', async ({ futureItemsPage }) => {
      await futureItemsPage.selectDateRange(TODAY, TODAY);
      await expect(futureItemsPage.grid).toBeVisible();
      await expect(futureItemsPage.summaryCount('all')).toBeVisible();
      for (const filter of [futureItemsPage.batchFilter, futureItemsPage.statusFilter, futureItemsPage.paymentFilter]) {
        await expect(filter).toBeEnabled();
      }
    });

    test('ล้างค่าวันที่ กลับสู่ empty state และ disable dropdown', async ({ futureItemsPage }) => {
      await futureItemsPage.selectDateRange(TODAY, TODAY);
      await expect(futureItemsPage.grid).toBeVisible();

      await futureItemsPage.startDate.fill('');
      await futureItemsPage.startDate.blur();
      await expect(futureItemsPage.emptyState).toBeVisible();
      await expect(futureItemsPage.grid).toBeHidden();
      await expect(futureItemsPage.batchFilter).toBeDisabled();
    });

    test('เลือกวันที่ผ่านปฏิทิน แสดงข้อมูล', async ({ futureItemsPage }) => {
      const today = Number(TODAY.slice(0, 2));
      await futureItemsPage.openCalendar('start');
      await futureItemsPage.calendarDay(today).click();
      await futureItemsPage.openCalendar('end');
      await futureItemsPage.calendarDay(today).click();

      await expect(futureItemsPage.startDate).toHaveValue(TODAY);
      await expect(futureItemsPage.endDate).toHaveValue(TODAY);
      await expect(futureItemsPage.grid).toBeVisible();
    });

    test('ปฏิทินวันที่สิ้นสุด disable วันก่อนวันเริ่มต้น', async ({ futureItemsPage }) => {
      await futureItemsPage.startDate.fill('15/03/2569');
      await futureItemsPage.openCalendar('end');
      await futureItemsPage.showCalendarMonth('มีนาคม 2569');
      expect(await futureItemsPage.enabledCalendarDays()).toEqual(range(15, 31));
      await expect(futureItemsPage.calendarDay(14)).toBeDisabled();
      await expect(futureItemsPage.previousMonthButton).toBeDisabled();
    });

    test('ปฏิทินวันที่สิ้นสุด disable วันที่เกิน 1 เดือน', async ({ futureItemsPage }) => {
      await futureItemsPage.startDate.fill('15/03/2569');
      await futureItemsPage.openCalendar('end');
      await futureItemsPage.showCalendarMonth('เมษายน 2569');
      expect(await futureItemsPage.enabledCalendarDays()).toEqual(range(1, 14));
      await expect(futureItemsPage.calendarDay(15)).toBeDisabled();
      await expect(futureItemsPage.nextMonthButton).toBeDisabled();
    });

    // Last selectable end date = start + 1 calendar month - 1 day, so 01/04 cannot be picked
    test('ช่วงวันที่ขอบ 1 เดือน: เริ่ม 01/03/2569 เลือกวันสิ้นสุดได้ถึง 31/03/2569', async ({ futureItemsPage }) => {
      await futureItemsPage.startDate.fill('01/03/2569');
      await futureItemsPage.openCalendar('end');
      await futureItemsPage.showCalendarMonth('มีนาคม 2569');
      expect((await futureItemsPage.enabledCalendarDays()).at(-1)).toBe(31);
      await expect(futureItemsPage.nextMonthButton).toBeDisabled();

      await futureItemsPage.calendarDay(31).click();
      await expect(futureItemsPage.endDate).toHaveValue('31/03/2569');
    });

    test('พิมพ์ช่วงวันที่เกิน 1 เดือน แสดง error toast', async ({ futureItemsPage }) => {
      await futureItemsPage.selectDateRange(thaiDate(daysFromNow(-40)), TODAY);
      await expect(futureItemsPage.toast).toHaveText('เลือกช่วงวันที่ได้สูงสุด 1 เดือน');
      await expect(futureItemsPage.grid).toBeHidden();
    });

    test('พิมพ์วันที่เริ่มต้นมากกว่าวันที่สิ้นสุด แสดง error toast', async ({ futureItemsPage }) => {
      await futureItemsPage.selectDateRange(TODAY, thaiDate(daysFromNow(-1)));
      await expect(futureItemsPage.toast).toHaveText('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น');
      await expect(futureItemsPage.grid).toBeHidden();
    });
  });

  test.describe('TS04-TC03 การ์ดสรุปและตารางรายการ', () => {
    test('การ์ดสรุป ตาราง และ chip สถานะ ตรงกับข้อมูลที่ยิงเข้ามา', async ({ futureItemsApi, futureItemsPage }) => {
      const { batchRef, items } = await createBatch(futureItemsApi, 3);
      await futureItemsPage.openBatch(batchRef, TODAY);

      await expect(futureItemsPage.summaryCount('all')).toHaveText('3');
      await expect(futureItemsPage.summaryCount('pending')).toHaveText('3');
      await expect(futureItemsPage.summaryCount('converted')).toHaveText('0');
      await expect(futureItemsPage.summaryCount('unpaid')).toHaveText(String(unpaidCount(items)));
      await expectRows(futureItemsPage, items);

      const [item] = items;
      await expect(futureItemsPage.cell(item.id, 'batchNo')).toHaveText(batchRef);
      await expect(futureItemsPage.cell(item.id, 'refCode')).toHaveText(item.refCode);
      await expect(futureItemsPage.cell(item.id, 'trackingNumber')).toHaveText(item.trackingNumber);
      await expect(futureItemsPage.cell(item.id, 'receiverName')).toHaveText(item.receiverName);
      await expect(futureItemsPage.cell(item.id, 'receiverPhone')).toHaveText(item.receiverPhone);
      await expect(futureItemsPage.cell(item.id, 'receiverEmail')).toHaveText(item.receiverEmail);
      await expect(futureItemsPage.cell(item.id, 'createdAt')).toHaveText(thaiDateTime(item.createdAt));
      const headers = await futureItemsPage.visibleColumnHeaders();

      // Right-hand columns only render after scrolling the table horizontally
      await futureItemsPage.scrollGrid('end');
      await expect(futureItemsPage.cell(item.id, 'status')).toHaveText(STATUS.PENDING);
      await expect(futureItemsPage.cell(item.id, 'status').getByTestId('chip')).toHaveClass(/MuiChip-colorInfo/);
      await expect(futureItemsPage.cell(item.id, 'paymentStatus')).toHaveText(PAYMENT[item.paymentStatus]);
      if (item.paymentStatus === 'UNPAID') {
        await expect(futureItemsPage.cell(item.id, 'paymentStatus').getByTestId('chip')).toHaveClass(/MuiChip-colorError/);
      }
      await expect(futureItemsPage.cancelButton(item.id)).toBeEnabled();

      headers.push(...(await futureItemsPage.visibleColumnHeaders()));
      expect(COLUMNS.filter((c) => !headers.includes(c)), 'columns not shown').toEqual([]);
    });
  });

  test.describe('TS04-TC04 การกรองรายการพัสดุล่วงหน้า', () => {
    test('กรองตาม Batch No. / สถานะ / สถานะการชำระเงิน และกรองร่วมกัน', async ({ futureItemsApi, futureItemsPage, page }) => {
      const { batchRef, items } = await createBatch(futureItemsApi, 2);
      const [cancelled, pending] = items;
      await futureItemsPage.goto();
      await futureItemsPage.selectDateRange(TODAY, TODAY);

      await futureItemsPage.batchFilter.click();
      await expect(page.getByRole('option', { name: 'ทั้งหมด', exact: true })).toBeVisible();
      await futureItemsPage.batchFilter.fill(batchRef);
      await expect(page.getByRole('option')).toHaveText([batchRef]);
      await page.getByRole('option', { name: batchRef }).click();
      await expectRows(futureItemsPage, items);
      await expect(futureItemsPage.summaryCount('all')).toHaveText('2');

      await futureItemsPage.cancelItem(cancelled.id);
      await expect(futureItemsPage.toast).toHaveText('ยกเลิกรายการสำเร็จ');

      await futureItemsPage.selectOption(futureItemsPage.statusFilter, STATUS.CANCELLED);
      await expectRows(futureItemsPage, [cancelled]);
      await futureItemsPage.selectOption(futureItemsPage.statusFilter, STATUS.PENDING);
      await expectRows(futureItemsPage, [pending]);
      await futureItemsPage.selectOption(futureItemsPage.statusFilter, STATUS.CONVERTED);
      await expectRows(futureItemsPage, []);
      await futureItemsPage.selectOption(futureItemsPage.statusFilter, 'ทั้งหมด');
      await expectRows(futureItemsPage, items);

      for (const [paymentStatus, label] of Object.entries(PAYMENT)) {
        await futureItemsPage.selectOption(futureItemsPage.paymentFilter, label);
        await expectRows(futureItemsPage, items.filter((i) => i.paymentStatus === paymentStatus));
      }

      await futureItemsPage.selectOption(futureItemsPage.statusFilter, STATUS.PENDING);
      await futureItemsPage.selectOption(futureItemsPage.paymentFilter, PAYMENT[pending.paymentStatus]);
      await expectRows(futureItemsPage, [pending]);
      await expect(futureItemsPage.summaryCount('all')).toHaveText('1');
    });

    test('เปลี่ยนช่วงวันที่หลังเลือก batch แล้ว Batch No. reset เป็น "ทั้งหมด"', async ({ futureItemsApi, futureItemsPage }) => {
      const { batchRef } = await createBatch(futureItemsApi, 1);
      await futureItemsPage.openBatch(batchRef, TODAY);
      await expect(futureItemsPage.batchFilter).toHaveValue(batchRef);

      const yesterday = thaiDate(daysFromNow(-1));
      await futureItemsPage.selectDateRange(yesterday, yesterday);
      await expect(futureItemsPage.batchFilter).toHaveValue('ทั้งหมด');
    });
  });

  test.describe('TS04-TC05 การค้นหารายการพัสดุล่วงหน้า', () => {
    test('ประเภทการค้นหามีตัวเลือกครบ และ placeholder เปลี่ยนตามประเภท', async ({ futureItemsPage, page }) => {
      await futureItemsPage.goto();
      await futureItemsPage.searchField.click();
      await expect(page.getByRole('option')).toHaveText(['ชื่อผู้รับ', 'หมายเลขอ้างอิง (DLT)', 'หมายเลขติดตาม', 'เบอร์โทรศัพท์', 'อีเมล']);
      await page.keyboard.press('Escape');

      for (const field of ['หมายเลขอ้างอิง (DLT)', 'หมายเลขติดตาม', 'เบอร์โทรศัพท์', 'อีเมล', 'ชื่อผู้รับ']) {
        await futureItemsPage.selectOption(futureItemsPage.searchField, field);
        await expect(futureItemsPage.searchInput).toHaveAttribute('placeholder', `ค้นหา${field}`);
      }
    });

    test('ค้นหาแต่ละประเภทแบบ partial match และการ์ดสรุปไม่เปลี่ยนตามการค้นหา', async ({ futureItemsApi, futureItemsPage }) => {
      const { batchRef, items } = await createBatch(futureItemsApi, 2);
      const [item] = items;
      const matching = (field, text) => items.filter((i) => i[field].toLowerCase().includes(text.toLowerCase()));
      await futureItemsPage.openBatch(batchRef, TODAY);
      await expect(futureItemsPage.summaryCount('all')).toHaveText('2');

      const searches = [
        ['หมายเลขอ้างอิง (DLT)', 'refCode', item.refCode.slice(0, 7)],
        ['หมายเลขติดตาม', 'trackingNumber', item.trackingNumber.toLowerCase()],
        ['ชื่อผู้รับ', 'receiverName', item.receiverName.split(' ')[1]],
        ['เบอร์โทรศัพท์', 'receiverPhone', item.receiverPhone.slice(2)],
        ['อีเมล', 'receiverEmail', item.receiverEmail],
      ];
      for (const [label, field, text] of searches) {
        await test.step(`${label}: ${text}`, async () => {
          await futureItemsPage.search(label, text);
          await expectRows(futureItemsPage, matching(field, text));
          await expect(futureItemsPage.summaryCount('all')).toHaveText('2');
        });
      }
    });

    test('ค้นหาเบอร์ที่มี - คั่น ไม่พบรายการ', async ({ futureItemsApi, futureItemsPage }) => {
      const { batchRef, items: [item] } = await createBatch(futureItemsApi, 1);
      await futureItemsPage.openBatch(batchRef, TODAY);
      await futureItemsPage.search('เบอร์โทรศัพท์', `${item.receiverPhone.slice(0, 3)}-${item.receiverPhone.slice(3)}`);
      await expect(futureItemsPage.noResult).toBeVisible();
      await expect(futureItemsPage.rows).toHaveCount(0);
    });

    test('ค้นหาด้วยคำที่ไม่มีในระบบ แสดง "ไม่พบผลการค้นหา"', async ({ futureItemsPage }) => {
      await futureItemsPage.goto();
      await futureItemsPage.selectDateRange(TODAY, TODAY);
      await futureItemsPage.search('หมายเลขติดตาม', 'XX000000000TH');
      await expect(futureItemsPage.noResult).toBeVisible();
      await expect(futureItemsPage.rows).toHaveCount(0);
    });
  });

  // One batch of 11 items (more than one page) shared by sorting and pagination
  test.describe('TS04-TC06/TC07 Sorting และ Pagination', () => {
    let batch;

    test.beforeAll(async ({ playwright }) => {
      const request = await playwright.request.newContext();
      batch = await createBatch(new FutureItemsApi(request, env), 11);
      await request.dispose();
    });

    test('TS04-TC06 คลิกหัวคอลัมน์เรียงน้อยไปมาก / มากไปน้อย ทั้งชุดข้อมูล', async ({ futureItemsPage }) => {
      const refCodes = batch.items.map((i) => i.refCode).sort();
      const header = futureItemsPage.grid.getByRole('columnheader', { name: 'หมายเลขอ้างอิง (DLT)' });
      const firstRefCode = futureItemsPage.rows.first().locator('[data-field="refCode"]');
      await futureItemsPage.openBatch(batch.batchRef, TODAY);

      await header.click();
      await expect(header).toHaveAttribute('aria-sort', 'ascending');
      await expect(firstRefCode).toHaveText(refCodes[0]);

      await header.click();
      await expect(header).toHaveAttribute('aria-sort', 'descending');
      // The largest refCode would be on page 2 if only the current page were sorted
      await expect(firstRefCode).toHaveText(refCodes[refCodes.length - 1]);
    });

    test('TS04-TC07 Rows per page / เปลี่ยนหน้า / เปลี่ยนตัวกรองกลับหน้า 1', async ({ futureItemsPage, page }) => {
      await futureItemsPage.openBatch(batch.batchRef, TODAY);
      await expect(futureItemsPage.rowsPerPage).toHaveText('10');
      await expect(futureItemsPage.paginationLabel).toHaveText('1–10 of 11');
      await expect(futureItemsPage.rows).toHaveCount(10);
      await expect(futureItemsPage.previousPageButton).toBeDisabled();

      await futureItemsPage.nextPageButton.click();
      await expect(futureItemsPage.paginationLabel).toHaveText('11–11 of 11');
      await expect(futureItemsPage.rows).toHaveCount(1);
      await expect(futureItemsPage.nextPageButton).toBeDisabled();

      await futureItemsPage.previousPageButton.click();
      await expect(futureItemsPage.paginationLabel).toHaveText('1–10 of 11');

      await futureItemsPage.rowsPerPage.click();
      await expect(page.getByRole('option')).toHaveText(['10', '20', '50']);
      await page.getByRole('option', { name: '20' }).click();
      await expect(futureItemsPage.paginationLabel).toHaveText('1–11 of 11');
      await expect(futureItemsPage.rows).toHaveCount(11);

      await futureItemsPage.selectOption(futureItemsPage.rowsPerPage, '10');
      await futureItemsPage.nextPageButton.click();
      await expect(futureItemsPage.paginationLabel).toHaveText('11–11 of 11');
      await futureItemsPage.selectOption(futureItemsPage.statusFilter, STATUS.PENDING);
      await expect(futureItemsPage.paginationLabel).toHaveText('1–10 of 11');
    });
  });

  test.describe('TS04-TC08 ข้อมูลจำนวนมาก', () => {
    test.fixme('~10,000 รายการ/วัน ในช่วง 1 เดือน แสดงผลไม่ค้าง (On Hold, ข้อมูลยังไม่เยอะพอ)', async () => {});
  });

  test.describe('TS04-TC09 อัปเดตข้อมูลขณะเปิดหน้าค้างไว้', () => {
    test('refresh แล้วเห็นรายการใหม่ล่าสุดก่อน และตัวกรองยังคงอยู่', async ({ futureItemsApi, futureItemsPage }) => {
      const { batchRef, items: [first] } = await createBatch(futureItemsApi, 1);
      await futureItemsPage.openBatch(batchRef, TODAY);
      await expectRows(futureItemsPage, [first]);

      // batchRef may repeat, so this adds a newer item to the same batch
      const { items: [newer] } = await createBatch(futureItemsApi, 1, batchRef);
      await futureItemsPage.reload();

      await expect(futureItemsPage.startDate).toHaveValue(TODAY);
      await expect(futureItemsPage.endDate).toHaveValue(TODAY);
      await expect(futureItemsPage.batchFilter).toHaveValue(batchRef);
      await expect(futureItemsPage.rows).toHaveCount(2);
      // TS04-TC06 step 1: default order is newest first
      expect(await futureItemsPage.visibleRowIds()).toEqual([newer.id, first.id]);
    });
  });

  test.describe('TS05-TC01 ยกเลิกรายการพัสดุล่วงหน้า', () => {
    test('modal ยืนยัน, กด "กลับ" ไม่เปลี่ยน, กด "ยืนยัน" แล้วสถานะเป็นยกเลิก', async ({ futureItemsApi, futureItemsPage }) => {
      const { batchRef, items } = await createBatch(futureItemsApi, 2);
      const [item] = items;
      await futureItemsPage.openBatch(batchRef, TODAY);
      await expect(futureItemsPage.summaryCount('pending')).toHaveText('2');
      await futureItemsPage.scrollGrid('end');

      await futureItemsPage.cancelButton(item.id).click();
      await expect(futureItemsPage.cancelDialog).toContainText('หากคุณยกเลิกรายการนี้แล้ว จะไม่สามารถย้อนกลับได้');
      await expect(futureItemsPage.cancelDialog).toContainText('หมายเลขอ้างอิง (DLT)');
      await expect(futureItemsPage.cancelDialog).toContainText(item.refCode);
      await expect(futureItemsPage.cancelDialog.getByRole('button', { name: 'กลับ' })).toBeVisible();
      await expect(futureItemsPage.cancelDialog.getByRole('button', { name: 'ยืนยัน' })).toBeVisible();

      await futureItemsPage.cancelDialog.getByRole('button', { name: 'กลับ' }).click();
      await expect(futureItemsPage.cancelDialog).toBeHidden();
      await expect(futureItemsPage.cell(item.id, 'status')).toHaveText(STATUS.PENDING);

      await futureItemsPage.cancelItem(item.id);
      await expect(futureItemsPage.toast).toHaveText('ยกเลิกรายการสำเร็จ');
      await expect(futureItemsPage.cell(item.id, 'status')).toHaveText(STATUS.CANCELLED);
      await expect(futureItemsPage.cell(item.id, 'status').getByTestId('chip')).toHaveClass(/MuiChip-colorDefault/);
      await expect(futureItemsPage.cell(item.id, 'paymentStatus')).toHaveText(PAYMENT[item.paymentStatus]);
      // TS05-TC02: a cancelled item cannot be cancelled again
      await expect(futureItemsPage.cancelButton(item.id)).toBeDisabled();

      await expect(futureItemsPage.summaryCount('pending')).toHaveText('1');
      await expect(futureItemsPage.summaryCount('all')).toHaveText('2');

      await futureItemsPage.selectOption(futureItemsPage.statusFilter, STATUS.CANCELLED);
      await expectRows(futureItemsPage, [item]);
    });
  });

  test.describe('TS05-TC02 ยกเลิกไม่ได้เมื่อสร้างใบนำส่งแล้ว', () => {
    test.fixme('ปุ่ม "× ยกเลิก" disable เมื่อสถานะ "สร้างใบนำส่งแล้ว" (needs the create shipment flow, TS08)', async () => {});
  });

  test.describe('TS05-TC03 ยกเลิกรายการที่ชำระเงินแล้ว', () => {
    test.fixme('ยกเลิกได้ และสถานะการชำระเงินยังเป็นชำระเงินแล้ว (needs a PAID item from the EOD job, TS03)', async () => {});
  });
});
