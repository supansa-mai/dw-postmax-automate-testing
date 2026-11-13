const { test, expect } = require('../../fixtures');
const { env } = require('../../config/environments');
const { USER_STATE, NORMAL_STATE, TSD_STATE } = require('../../config/auth');
const { openPortal } = require('../../helpers/portal');
const { BackOfficeApi } = require('../../helpers/backOfficeApi');
const {
  TYPES, LOCATIONS, bangkokDay, lastDays, lastSevenDays, daysBetween, rangeLabel, fieldDate, receivedOrders, expectedDashboard, countWhere,
  settledFees,
} = require('../../helpers/dashboardData');

// As the items table and the filters name them
const TYPE_LABELS = { NORMAL: 'ธรรมดา', REGISTERED: 'ลงทะเบียน', EMS: 'EMS' };
const LOCATION_LABELS = { BANGKOK: 'กรุงเทพและปริมณฑล', NON_BANGKOK: 'ต่างจังหวัด', ABROAD: 'ต่างประเทศ' };
const DATE_OPTIONS = ['7 วันที่ผ่านมา', '28 วันที่ผ่านมา', '90 วันที่ผ่านมา', '365 วันที่ผ่านมา', 'ตลอดอายุ', 'กำหนดเอง'];

const percent = (part, whole) => (whole ? (part * 100) / whole : 0);
const number = (text) => Number(text.replace(/,/g, ''));

/**
 * Waits until จำนวนชิ้นงานทั้งหมด is `expected` (a number, or a range from countWhere()); a filter the page has used
 * before comes from its cache without a request, so the number on the page is what is waited on
 */
async function expectItemTotal(dashboardPage, expected, what) {
  const { min, max } = typeof expected === 'number' ? { min: expected, max: expected } : expected;
  await expect.poll(async () => {
    const total = await dashboardPage.itemTotal();
    return total >= min && total <= max ? 'ok' : total;
  }, { message: `${what}: จำนวนชิ้นงานทั้งหมด should be ${min === max ? min : `${min}-${max}`}` }).toBe('ok');
}

/** A count from the dashboard against what it should be: exact, or within the range left by partly received Lite items */
function expectWithin(actual, { min, max }, what) {
  expect(actual, `${what} should be ${min === max ? min : `${min}-${max}`}`).toBeGreaterThanOrEqual(min);
  expect(actual, `${what} should be ${min === max ? min : `${min}-${max}`}`).toBeLessThanOrEqual(max);
}

/**
 * The dashboard's own numbers for the last 7 days (as `state`'s user sees them) and what they should be, worked out
 * from the orders the company had received at drop off
 */
async function loadDashboard(browser, state) {
  const { days, startDate, endDate } = lastSevenDays();
  const query = `period=DAY&startDate=${startDate}&endDate=${endDate}&mode=frontend`;
  const portal = await openPortal(browser, state);
  const token = await portal.dashboardPage.goto();
  const get = async (path) => {
    const response = await portal.context.request.get(`${env.apiURL}/v1/frontend/${path}`, { headers: { authorization: token } });
    expect(response.status(), path).toBe(200);
    return (await response.json()).data;
  };
  const { company } = await get('users/profile');
  const data = {
    overview: await get(`analytics/overview?${query}`),
    deliveries: await get(`analytics/order-item-deliveries?${query}`),
    summary: await get(`analytics/delivery-summary?${query}`),
  };
  await portal.close();

  const backOffice = await BackOfficeApi.open(browser);
  const orders = await receivedOrders(backOffice, company.id, days);
  await backOffice.close();
  return { state, days, data, expected: expectedDashboard(orders, days) };
}

function skipWithoutData(dashboard, user) {
  const { days, expected } = dashboard;
  test.skip(!expected.received, `${user} had nothing received at drop off on ${days[0]} - ${days[days.length - 1]}`);
}

/** จำนวนชิ้นรับฝาก per day and type (ภาพรวม) */
function checkDailyCounts({ days, data, expected }) {
  for (const day of days) {
    const rows = data.overview.trendChart.filter((r) => bangkokDay(r.timestamp) === day);
    for (const type of TYPES) {
      const count = rows.find((r) => r.groupType === type)?.totalCount ?? 0;
      expectWithin(count, expected.perDay[day].byType[type], `${day} ${type}`);
    }
    expect(rows.reduce((sum, r) => sum + r.totalCount, 0), `${day} รวม`).toBe(expected.perDay[day].received);
  }
}

/** จำนวนชิ้นรับฝากตามพื้นที่ (ภาพรวม) */
function checkLocations({ data, expected }) {
  for (const location of LOCATIONS) {
    const count = data.overview.locationPieChart.find((r) => r.locationType === location)?.totalCount ?? 0;
    expectWithin(count, expected.byLocation[location], location);
  }
  expect(data.overview.locationPieChart.reduce((sum, r) => sum + r.totalCount, 0)).toBe(expected.received);
}

/** อัตราการนำจ่ายสำเร็จตามบริการ (ภาพรวม): delivered / failed per day and the rates the page shows */
async function checkServiceRates(browser, { state, days, data, expected }) {
  for (const day of days) {
    const rows = data.overview.trendChart.filter((r) => bangkokDay(r.timestamp) === day);
    expectWithin(rows.reduce((sum, r) => sum + r.successCount, 0), expected.perDay[day].success, `${day} ส่งสำเร็จ`);
    expectWithin(rows.reduce((sum, r) => sum + r.failCount, 0), expected.perDay[day].fail, `${day} ส่งไม่สำเร็จ`);
  }
  const portal = await openPortal(browser, state);
  await portal.dashboardPage.goto();
  const text = await portal.dashboardPage.boxText('อัตราการนำจ่ายสำเร็จตามบริการ');
  for (const [type, label] of [['REGISTERED', 'ลงทะเบียน'], ['EMS', 'EMS']]) {
    const rows = data.overview.trendChart.filter((r) => r.groupType === type);
    const rate = percent(rows.reduce((s, r) => s + r.successCount, 0), rows.reduce((s, r) => s + r.totalCount, 0));
    expect(text).toContain(`${label} ${rate.toFixed(2)} %`);
  }
  await portal.close();
}

/** จำนวนชิ้นงานทั้งหมด and per day (จำนวนชิ้นงาน) */
async function checkItemTotals(browser, { state, days, data, expected }) {
  for (const day of days) {
    const count = data.deliveries.find((r) => bangkokDay(r.timestamp) === day)?.totalCount ?? 0;
    expect(count, day).toBe(expected.perDay[day].received);
  }
  const portal = await openPortal(browser, state);
  await portal.dashboardPage.goto();
  await portal.dashboardPage.openTab('จำนวนชิ้นงาน');
  const text = await portal.dashboardPage.boxText('จำนวนชิ้นงานทั้งหมด');
  expect(number(text.match(/จำนวนชิ้นงานทั้งหมด ([\d,]+) ชิ้น/)[1])).toBe(expected.received);
  await portal.close();
}

/** อัตราการนำจ่ายสำเร็จ (อัตราการนำจ่าย, not TSD) */
async function checkDeliveryRate(browser, { state, data, expected }) {
  const { meta } = data.summary.deliveries;
  expect(meta.overAllCount).toBe(expected.received);
  expectWithin(meta.overAllSuccessCount, expected.success, 'ส่งสำเร็จ');
  expectWithin(meta.overAllFailCount, expected.fail, 'ส่งไม่สำเร็จ');
  const portal = await openPortal(browser, state);
  await portal.dashboardPage.goto();
  await portal.dashboardPage.openTab('อัตราการนำจ่าย');
  const text = await portal.dashboardPage.boxText('อัตราการนำจ่ายสำเร็จ');
  expect(Number(text.match(/อัตราการนำจ่ายสำเร็จ ([\d.]+) %/)[1])).toBeCloseTo(percent(meta.overAllSuccessCount, meta.overAllCount), 1);
  await portal.close();
}

/** 10 อันดับสาเหตุในการรับฝากไม่ครบ, counted in orders; on อัตราการนำจ่าย, or on ภาพรวม for TSD (`tab` null) */
async function checkMissingReasons(browser, { state, data, expected }, tab) {
  const { meta, data: ranking } = data.summary.rankings.missingItem;
  const top = Object.entries(expected.missingReasons).sort(([, a], [, b]) => b - a).slice(0, 10);
  expect(Object.fromEntries(ranking.map((r) => [r.groupDetail, r.groupCount]))).toEqual(Object.fromEntries(top));
  expect(meta.overAllGroupCount).toBe(Object.values(expected.missingReasons).reduce((a, b) => a + b, 0));
  test.skip(!ranking.length, 'no order was partly received in the range');

  const portal = await openPortal(browser, state);
  await portal.dashboardPage.goto();
  if (tab) await portal.dashboardPage.openTab(tab);
  const text = await portal.dashboardPage.boxText('10 อันดับสาเหตุในการรับฝากไม่ครบ');
  ranking.forEach((r, i) => {
    expect(text).toContain(`${i + 1}. ${r.groupDetail} ${percent(r.groupCount, meta.overAllGroupCount).toFixed(1)}%`);
  });
  await portal.close();
}

// One look at the data per user (in one worker): the expected values take a while to work out from Back Office
test.describe('รายงานข้อมูล user ปกติ', () => {
  test.describe.configure({ mode: 'default', timeout: 3 * 60 * 1000 });
  let dashboard;
  test.beforeAll(async ({ browser }) => { dashboard = await loadDashboard(browser, NORMAL_STATE); });
  test.beforeEach(() => skipWithoutData(dashboard, 'user ปกติ'));

  test.describe('TS12-TC06 user ปกติ ตรวจสอบการแสดงผลจำนวนชิ้นรับฝาก', () => {
    test('user ปกติ: จำนวนชิ้นรับฝากรายวัน แยกตามบริการ', () => checkDailyCounts(dashboard));
  });
  test.describe('TS12-TC07 user ปกติ ตรวจสอบการแสดงผลจำนวนชิ้นรับฝากตามพื้นที่', () => {
    test('user ปกติ: จำนวนชิ้นรับฝากตามพื้นที่', () => checkLocations(dashboard));
  });
  test.describe('TS12-TC04 user ปกติ ตรวจสอบการแสดงผลอัตราการนำจ่ายสำเร็จตามบริการ', () => {
    test('user ปกติ: ส่งสำเร็จ / ไม่สำเร็จรายวัน และอัตราที่หน้าแสดง', ({ browser }) => checkServiceRates(browser, dashboard));
  });
  test.describe('TS13-TC04 user ปกติ ตรวจสอบการแสดงผลจำนวนชิ้นงาน', () => {
    test('user ปกติ: จำนวนชิ้นงานทั้งหมด และรายวัน', ({ browser }) => checkItemTotals(browser, dashboard));
  });
  test.describe('TS14-TC03 user ปกติ ตรวจสอบการแสดงผลอัตราการนำจ่าย', () => {
    test('user ปกติ: อัตราการนำจ่ายสำเร็จ', ({ browser }) => checkDeliveryRate(browser, dashboard));
  });
  test.describe('TS14-TC05 user ปกติ ตรวจสอบการแสดงผล 10 อันดับสาเหตุในการรับฝากไม่ครบ', () => {
    test('user ปกติ: สาเหตุรับฝากไม่ครบ นับตามใบนำส่ง', ({ browser }) => checkMissingReasons(browser, dashboard, 'อัตราการนำจ่าย'));
  });
});

// TSD has ค่าบริการ instead of อัตราการนำจ่าย; its ภาพรวม shows the missing-item ranking
test.describe('รายงานข้อมูล user TSD', () => {
  test.describe.configure({ mode: 'default', timeout: 3 * 60 * 1000 });
  let dashboard;
  test.beforeAll(async ({ browser }) => { dashboard = await loadDashboard(browser, TSD_STATE); });
  test.beforeEach(() => skipWithoutData(dashboard, 'user TSD'));

  test.describe('TS10-TC06 user TSD ตรวจสอบการแสดงผลจำนวนชิ้นรับฝาก', () => {
    test('user TSD: จำนวนชิ้นรับฝากรายวัน แยกตามบริการ', () => checkDailyCounts(dashboard));
  });
  test.describe('TS10-TC07 user TSD ตรวจสอบการแสดงผลจำนวนชิ้นรับฝากตามพื้นที่', () => {
    test('user TSD: จำนวนชิ้นรับฝากตามพื้นที่', () => checkLocations(dashboard));
  });
  test.describe('TS10-TC04 user TSD ตรวจสอบการแสดงผลอัตราการนำจ่ายสำเร็จตามบริการ', () => {
    test('user TSD: ส่งสำเร็จ / ไม่สำเร็จรายวัน และอัตราที่หน้าแสดง', ({ browser }) => checkServiceRates(browser, dashboard));
  });
  test.describe('TS11-TC04 user TSD ตรวจสอบการแสดงผลจำนวนชิ้นงาน', () => {
    test('user TSD: จำนวนชิ้นงานทั้งหมด และรายวัน', ({ browser }) => checkItemTotals(browser, dashboard));
  });
  test.describe('TS10-TC09 user TSD ตรวจสอบการแสดงผล 10 อันดับสาเหตุในการรับฝากไม่ครบ', () => {
    test('user TSD: สาเหตุรับฝากไม่ครบ นับตามใบนำส่ง', ({ browser }) => checkMissingReasons(browser, dashboard, null));
  });
});

test.describe('รายงานข้อมูล user DLT', () => {
  test.describe.configure({ mode: 'default', timeout: 3 * 60 * 1000 });
  let dashboard;
  test.beforeAll(async ({ browser }) => { dashboard = await loadDashboard(browser, USER_STATE); });
  test.beforeEach(() => skipWithoutData(dashboard, 'user DLT'));

  test.describe('TS11-TC01 user DLT ตรวจสอบการแสดงผล แท็บรายงานภาพรวม', () => {
    test('user DLT: จำนวนชิ้นรับฝากรายวัน แยกตามบริการ', () => checkDailyCounts(dashboard));
    test('user DLT: จำนวนชิ้นรับฝากตามพื้นที่', () => checkLocations(dashboard));
    test('user DLT: ส่งสำเร็จ / ไม่สำเร็จรายวัน และอัตราที่หน้าแสดง', ({ browser }) => checkServiceRates(browser, dashboard));
  });
  test.describe('TS11-TC02 user DLT ตรวจสอบการแสดง แท็บผลจำนวนชิ้นงาน', () => {
    test('user DLT: จำนวนชิ้นงานทั้งหมด และรายวัน', ({ browser }) => checkItemTotals(browser, dashboard));
  });
  test.describe('TS11-TC03 user DLT ตรวจสอบการแสดง อัตรานำจ่าย', () => {
    test('user DLT: อัตราการนำจ่ายสำเร็จ', ({ browser }) => checkDeliveryRate(browser, dashboard));
    test('user DLT: สาเหตุรับฝากไม่ครบ นับตามใบนำส่ง', ({ browser }) => checkMissingReasons(browser, dashboard, 'อัตราการนำจ่าย'));
  });
});

// The filters work the same for every user, so they are checked as the normal user only
test.describe('รายงานข้อมูล ตัวกรองและการค้นหา (user ปกติ)', () => {
  // In one worker, so the expected values are worked out once
  test.describe.configure({ mode: 'default', timeout: 3 * 60 * 1000 });

  const { days } = lastSevenDays();
  let orders;

  test.beforeAll(async ({ browser }) => {
    const portal = await openPortal(browser, NORMAL_STATE);
    const token = await portal.dashboardPage.goto();
    const response = await portal.context.request.get(`${env.apiURL}/v1/frontend/users/profile`, { headers: { authorization: token } });
    const { company } = (await response.json()).data;
    await portal.close();
    const backOffice = await BackOfficeApi.open(browser);
    orders = await receivedOrders(backOffice, company.id, days);
    await backOffice.close();
  });

  test.beforeEach(() => {
    test.skip(!orders.length, `nothing received at drop off on ${days[0]} - ${days[days.length - 1]}`);
  });

  test.describe('TS12-TC01 user ปกติ ผู้ใช้งานสามารถเห็นหน้า "รายงานข้อมูล"', () => {
    test('user ปกติ: ตัวเลือกช่วงวันที่ และช่วงของ 28 วันที่ผ่านมา', async ({ browser }) => {
      const { dashboardPage: d, page, close } = await openPortal(browser, NORMAL_STATE);
      await d.goto();
      expect(await d.dateLabel()).toContain(`7 วันที่ผ่านมา : ${rangeLabel(days)}`);
      expect(await d.dateOptions()).toEqual(DATE_OPTIONS);

      const range = lastDays(28);
      const request = page.waitForRequest(/analytics\/overview/);
      await d.pickDateOption('28 วันที่ผ่านมา');
      expect(await d.dateLabel()).toContain(`28 วันที่ผ่านมา : ${rangeLabel(range.days)}`);
      const url = new URL((await request).url());
      expect([url.searchParams.get('startDate'), url.searchParams.get('endDate')]).toEqual([range.startDate, range.endDate]);
      await close();
    });
  });

  test.describe('TS12-TC02 user ปกติ ตรวจสอบการแสดงผลข้อมูล', () => {
    test('user ปกติ: กำหนดเอง ตัวเลขเปลี่ยนตามช่วงที่เลือก', async ({ browser }) => {
      const { dashboardPage: d, close } = await openPortal(browser, NORMAL_STATE);
      await d.goto();
      await d.openTab('จำนวนชิ้นงาน');
      await d.pickDateOption('กำหนดเอง');
      await expect(d.customRangeModal()).toContainText(`เลือกไว้แล้ว ${days.length} วัน`);
      await d.customRangeModal().getByRole('button', { name: 'ยกเลิก' }).click();

      // The last two days of the default range, whose counts are known
      const custom = daysBetween(days[days.length - 2], days[days.length - 1]);
      await d.pickCustomRange(fieldDate(custom.days[0]), fieldDate(custom.days[1]));
      expect(await d.dateLabel()).toContain(`กำหนดเอง : ${rangeLabel(custom.days)}`);
      await expectItemTotal(d, orders.filter((o) => custom.days.includes(o.day)).reduce((sum, o) => sum + o.received, 0), 'กำหนดเอง');
      await close();
    });
  });

  test.describe('TS13-TC02 user ปกติ ตรวจสอบการกรอง', () => {
    test('user ปกติ: กรองประเภทบริการ ทีละค่า หลายค่า และล้างตัวกรอง', async ({ browser }) => {
      const { dashboardPage: d, close } = await openPortal(browser, NORMAL_STATE);
      await d.goto();
      await d.openTab('จำนวนชิ้นงาน');
      for (const type of TYPES) {
        await d.select('ประเภทบริการ', [TYPE_LABELS[type]]);
        await expectItemTotal(d, countWhere(orders, (i) => i.type === type), type);
        for (const row of await d.itemRows()) expect(row.type).toBe(TYPE_LABELS[type]);
        await d.clear('ประเภทบริการ');
      }
      await d.select('ประเภทบริการ', [TYPE_LABELS.REGISTERED, TYPE_LABELS.EMS]);
      await expectItemTotal(d, countWhere(orders, (i) => i.type !== 'NORMAL'), 'ลงทะเบียน + EMS');
      await d.clear('ประเภทบริการ');
      await expectItemTotal(d, orders.reduce((sum, o) => sum + o.received, 0), 'ล้างตัวกรอง');
      await close();
    });

    test('user ปกติ: กรองพื้นที่บริการ และกรองร่วมกับประเภทบริการ', async ({ browser }) => {
      const { dashboardPage: d, close } = await openPortal(browser, NORMAL_STATE);
      await d.goto();
      await d.openTab('จำนวนชิ้นงาน');
      for (const location of LOCATIONS) {
        await d.select('พื้นที่บริการ', [LOCATION_LABELS[location]]);
        await expectItemTotal(d, countWhere(orders, (i) => i.location === location), location);
        for (const row of await d.itemRows()) expect(row.area).toBe(LOCATION_LABELS[location]);
        await d.clear('พื้นที่บริการ');
      }
      await d.select('ประเภทบริการ', [TYPE_LABELS.REGISTERED]);
      await d.select('พื้นที่บริการ', [LOCATION_LABELS.ABROAD]);
      await expectItemTotal(d, countWhere(orders, (i) => i.type === 'REGISTERED' && i.location === 'ABROAD'), 'ลงทะเบียน ต่างประเทศ');
      await close();
    });
  });

  test.describe('TS13-TC03 user ปกติ ตรวจสอบการค้นหาด้วยข้อมูลต่างๆ', () => {
    test('user ปกติ: ค้นหาหมายเลขอ้างอิงบางส่วน และค้นหาไม่พบ', async ({ browser }) => {
      const { dashboardPage: d, page, close } = await openPortal(browser, NORMAL_STATE);
      await d.goto();
      await d.openTab('จำนวนชิ้นงาน');
      // Part of one order's reference, without its first and last characters
      const keyword = orders[0].reference.slice(1, -1);
      await d.search(keyword);
      await expectItemTotal(d, orders.filter((o) => o.reference.includes(keyword)).reduce((sum, o) => sum + o.received, 0), keyword);
      for (const row of await d.itemRows()) expect(row.reference).toContain(keyword);

      await d.search('NO_SUCH_REFERENCE');
      await expect(page.getByText('ไม่พบผลการค้นหา')).toBeVisible();
      await expectItemTotal(d, 0, 'ค้นหาไม่พบ');
      await close();
    });
  });

  test.describe('TS14-TC02 user ปกติ ตรวจสอบการกรอง', () => {
    /** อัตราการนำจ่ายสำเร็จ as the page shows it, waited on until it is `rate` */
    async function expectRate(dashboardPage, rate) {
      await expect.poll(async () => {
        const text = await dashboardPage.boxText('อัตราการนำจ่ายสำเร็จ');
        return Number(text.match(/อัตราการนำจ่ายสำเร็จ ([\d.]+) %/)[1]);
      }).toBeCloseTo(rate, 1);
    }

    test('user ปกติ: อัตราการนำจ่าย กรองประเภทบริการ และพื้นที่บริการ', async ({ browser }) => {
      const { dashboardPage: d, close } = await openPortal(browser, NORMAL_STATE);
      await d.goto();
      const all = await d.countAfter(() => d.openTab('อัตราการนำจ่าย'));
      expect(all).toBe(orders.reduce((sum, o) => sum + o.received, 0));
      const { success } = expectedDashboard(orders, days);

      expectWithin(await d.countAfter(() => d.select('ประเภทบริการ', [TYPE_LABELS.EMS])), countWhere(orders, (i) => i.type === 'EMS'), 'EMS');
      expectWithin(await d.countAfter(() => d.select('ประเภทบริการ', [TYPE_LABELS.REGISTERED])),
        countWhere(orders, (i) => i.type !== 'NORMAL'), 'EMS + ลงทะเบียน');
      // Back to every type: the page shows its cached numbers without asking again
      await d.clear('ประเภทบริการ');
      await expectRate(d, percent(success.min, all));

      for (const location of LOCATIONS) {
        const count = await d.countAfter(() => d.select('พื้นที่บริการ', [LOCATION_LABELS[location]]));
        expectWithin(count, countWhere(orders, (i) => i.location === location), location);
        await d.clear('พื้นที่บริการ');
      }
      await close();
    });

    test('user ปกติ: อัตราการนำจ่าย กรองหมายเลขใบนำส่ง และค้นหาหมายเลขอ้างอิง', async ({ browser }) => {
      const { dashboardPage: d, page, close } = await openPortal(browser, NORMAL_STATE);
      await d.goto();
      await d.openTab('อัตราการนำจ่าย');

      // The order filter only offers the company's latest 50 orders
      const offered = await d.orderOptions();
      const [first, second] = orders.filter((o) => offered.includes(o.number));
      test.skip(!second, 'fewer than two of the orders received in the range are among the 50 หมายเลขใบนำส่ง offers');
      for (const [order, expected] of [[first, first.received], [second, first.received + second.received]]) {
        expect(await d.countAfter(() => d.pickOrder(order.number)), `ใบนำส่ง ${order.number}`).toBe(expected);
      }
      await d.clear('หมายเลขใบนำส่ง');

      // Part of one order's reference, without its first and last characters
      const keyword = first.reference.slice(1, -1);
      expect(await d.countAfter(() => d.search(keyword), { search: keyword })).toBe(orders.filter((o) => o.reference.includes(keyword)).reduce((sum, o) => sum + o.received, 0));
      expect(await d.countAfter(() => d.search('NO_SUCH_REFERENCE'), { search: 'NO_SUCH_REFERENCE' })).toBe(0);
      await expectRate(d, 0);
      await close();
    });
  });
});

// TSD searches จำนวนชิ้นงาน by a field it picks (ประเภทการค้นหา) instead of by reference only
test.describe('รายงานข้อมูล การค้นหา (user TSD)', () => {
  test.describe.configure({ mode: 'default', timeout: 3 * 60 * 1000 });

  const { days } = lastSevenDays();
  let orders;

  test.beforeAll(async ({ browser }) => {
    const portal = await openPortal(browser, TSD_STATE);
    const token = await portal.dashboardPage.goto();
    const response = await portal.context.request.get(`${env.apiURL}/v1/frontend/users/profile`, { headers: { authorization: token } });
    const { company } = (await response.json()).data;
    await portal.close();
    const backOffice = await BackOfficeApi.open(browser);
    orders = await receivedOrders(backOffice, company.id, days);
    await backOffice.close();
  });

  test.describe('TS11-TC03 user TSD ตรวจสอบการค้นหาด้วยข้อมูลต่างๆ', () => {
    test('user TSD: ค้นหาด้วยทุกประเภทการค้นหา และค้นหาไม่พบ', async ({ browser }) => {
      test.skip(!orders.length, `nothing received at drop off on ${days[0]} - ${days[days.length - 1]}`);
      const order = orders[0];
      const item = order.items[0];
      const reference = order.reference.slice(1, -1);
      const sumOf = (match) => orders.filter(match).reduce((sum, o) => sum + o.received, 0);
      const searches = [
        { field: 'หมายเลขใบนำส่ง', text: order.number, expected: sumOf((o) => o.number.includes(order.number)), column: 'orderNumber' },
        { field: 'หมายเลขติดตาม', text: item.trackingNumber, expected: countWhere(orders, (i) => i.trackingNumber?.includes(item.trackingNumber)), column: 'trackingNumber' },
        { field: 'หมายเลขอ้างอิง', text: reference, expected: sumOf((o) => o.reference.includes(reference)), column: 'reference' },
        // The table shows the sender, not the receiver, so these are only checked by their count
        { field: 'ชื่อผู้รับ', text: item.name, expected: countWhere(orders, (i) => i.name?.includes(item.name)) },
        { field: 'อีเมล', text: item.email, expected: countWhere(orders, (i) => i.email?.includes(item.email)) },
        { field: 'เบอร์โทรศัพท์', text: item.phone, expected: countWhere(orders, (i) => i.phone?.includes(item.phone)) },
      ];

      const { dashboardPage: d, page, close } = await openPortal(browser, TSD_STATE);
      await d.goto();
      await d.openTab('จำนวนชิ้นงาน');
      for (const { field, text, expected, column } of searches) {
        const count = await d.countAfter(() => d.searchBy(field, text), { search: text });
        if (typeof expected === 'number') expect(count, `${field} "${text}"`).toBe(expected);
        else expectWithin(count, expected, `${field} "${text}"`);
        await expect.poll(() => d.itemTotal()).toBe(count);
        if (column) for (const row of await d.itemRows()) expect(row[column]).toContain(text);
      }

      expect(await d.countAfter(() => d.searchBy('หมายเลขอ้างอิง', 'NO_SUCH_REFERENCE'), { search: 'NO_SUCH_REFERENCE' })).toBe(0);
      await expect(page.getByText('ไม่พบผลการค้นหา')).toBeVisible();
      await close();
    });
  });
});

// ค่าบริการ (TSD only) adds up the final amounts of the confirmed settlement summaries by the month they were confirmed
test.describe('รายงานข้อมูล ค่าบริการ (user TSD)', () => {
  test.describe.configure({ mode: 'default', timeout: 3 * 60 * 1000 });

  let fees;
  const baht = (amount) => Math.round(amount * 100) / 100;
  const sumOf = (list) => baht(list.reduce((sum, f) => sum + f.amount, 0));
  const bangkokMonth = (iso) => bangkokDay(iso).slice(0, 7);

  test.beforeAll(async ({ browser }) => {
    const portal = await openPortal(browser, TSD_STATE);
    const token = await portal.dashboardPage.goto();
    const response = await portal.context.request.get(`${env.apiURL}/v1/frontend/users/profile`, { headers: { authorization: token } });
    const { company } = (await response.json()).data;
    await portal.close();
    const backOffice = await BackOfficeApi.open(browser);
    fees = await settledFees(backOffice, company.id);
    await backOffice.close();
  });

  /** The page on ค่าบริการ with ตลอดอายุ picked; returns it with the fees confirmed in that range */
  async function openAllTime(browser) {
    const portal = await openPortal(browser, TSD_STATE);
    await portal.dashboardPage.goto();
    await portal.dashboardPage.openTab('ค่าบริการ');
    const shown = await portal.dashboardPage.feeAfter(() => portal.dashboardPage.pickDateOption('ตลอดอายุ'));
    const inRange = fees.filter((f) => f.settledAt >= shown.startDate && f.settledAt <= shown.endDate);
    test.skip(!inRange.length, 'no settlement summary was confirmed in ตลอดอายุ');
    return { portal, shown, inRange };
  }

  test.describe('TS12-TC05 user TSD ตรวจสอบการแสดงผลค่าบริการ', () => {
    test('user TSD: ค่าบริการทั้งหมด และรายเดือน ตามวันที่ยืนยันใบสรุปยอด', async ({ browser }) => {
      const { portal, shown, inRange } = await openAllTime(browser);
      expect(shown.total).toBeCloseTo(sumOf(inRange), 2);
      const months = {};
      for (const f of inRange) months[bangkokMonth(f.settledAt)] = baht((months[bangkokMonth(f.settledAt)] ?? 0) + f.amount);
      expect(Object.keys(shown.months).sort()).toEqual(Object.keys(months).sort());
      for (const [month, amount] of Object.entries(months)) expect(shown.months[month], month).toBeCloseTo(amount, 2);
      await expect.poll(() => portal.dashboardPage.feeTotal()).toBeCloseTo(shown.total, 2);
      await portal.close();
    });
  });

  test.describe('TS12-TC04 user TSD ตรวจสอบการกรอง', () => {
    test('user TSD: กรองประเภทบริการ ผลรวมทุกประเภทเท่ากับค่าบริการทั้งหมด', async ({ browser }) => {
      const { portal, shown } = await openAllTime(browser);
      const d = portal.dashboardPage;
      const byType = {};
      for (const type of TYPES) {
        byType[type] = (await d.feeAfter(() => d.select('ประเภทบริการ', [TYPE_LABELS[type]]))).total;
        await d.clear('ประเภทบริการ');
      }
      // The fee of each type comes from the items of the summaries, which Back Office does not list
      expect(baht(Object.values(byType).reduce((a, b) => a + b, 0))).toBeCloseTo(shown.total, 2);
      await d.select('ประเภทบริการ', [TYPE_LABELS.REGISTERED, TYPE_LABELS.EMS]);
      await expect.poll(() => d.feeTotal()).toBeCloseTo(baht(byType.REGISTERED + byType.EMS), 2);
      await d.clear('ประเภทบริการ');
      await expect.poll(() => d.feeTotal()).toBeCloseTo(shown.total, 2);
      await portal.close();
    });

    test('user TSD: กรองหมายเลขใบนำส่ง และค้นหาหมายเลขอ้างอิง', async ({ browser }) => {
      const { portal, inRange } = await openAllTime(browser);
      const d = portal.dashboardPage;

      // The order filter only offers the latest 50 orders, which may hold no confirmed summary
      const offered = await d.orderOptions();
      const listed = inRange.find((f) => offered.includes(f.orderNumber));
      if (listed) {
        const byOrder = await d.feeAfter(() => d.pickOrder(listed.orderNumber));
        expect(byOrder.total).toBeCloseTo(sumOf(inRange.filter((f) => f.orderNumber === listed.orderNumber)), 2);
        await d.clear('หมายเลขใบนำส่ง');
      } else {
        test.info().annotations.push({ type: 'skipped step', description: 'no confirmed summary among the 50 orders หมายเลขใบนำส่ง offers' });
      }

      const fee = inRange[0];
      const keyword = fee.searchText.split(' ').pop();
      const bySearch = await d.feeAfter(() => d.search(keyword), { search: keyword });
      expect(bySearch.total).toBeCloseTo(sumOf(inRange.filter((f) => f.searchText.includes(keyword))), 2);
      expect((await d.feeAfter(() => d.search('NO_SUCH_REFERENCE'), { search: 'NO_SUCH_REFERENCE' })).total).toBe(0);
      await expect.poll(() => d.feeTotal()).toBe(0);
      await portal.close();
    });
  });
});
