// Back Office API as the admin, for the settings the tests check against (fees, zones, rural areas) and order data.
// The token is only sent by the Back Office app itself, so it is taken from the app's own requests.
const { expect } = require('@playwright/test');
const { env } = require('../config/environments');
const { ADMIN_STATE } = require('../config/auth');

class BackOfficeApi {
  static async open(browser) {
    const context = await browser.newContext({ storageState: ADMIN_STATE, baseURL: `${env.baseURL}/` });
    const api = new BackOfficeApi(context, await context.newPage());
    await api.refreshToken();
    return api;
  }

  constructor(context, page) {
    this.context = context;
    this.page = page;
    page.on('request', (request) => {
      const authorization = request.headers().authorization;
      if (authorization && request.url().includes('/v1/backend/')) this.authorization = authorization;
    });
  }

  async refreshToken() {
    this.authorization = undefined;
    await this.page.goto('backoffice/orders');
    await expect.poll(() => this.authorization, { message: 'Back Office token', timeout: 30000 }).toBeTruthy();
  }

  /** GET `/v1/backend/<path>`, returns `data`; a 401 (expired token) loads a Back Office page once to get a new one */
  async get(path) {
    return this.send('GET', path);
  }

  async patch(path, data) {
    return this.send('PATCH', path, data);
  }

  async send(method, path, data) {
    for (let attempt = 0; ; attempt++) {
      const response = await this.context.request.fetch(`${env.apiURL}/v1/backend/${path}`, {
        method, data, headers: { authorization: this.authorization },
      });
      if (response.status() === 401 && attempt === 0) {
        await this.refreshToken();
        continue;
      }
      expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(200);
      return (await response.json()).data;
    }
  }

  /** The fee settings in force on `date` (Back Office > ค่าบริการ..., จัดการโซน, จัดการพื้นที่พิเศษ) */
  async fees(date = new Date()) {
    const at = encodeURIComponent(startOfBangkokDay(date));
    const [domestic, zones, eAr, service, rural] = await Promise.all([
      Promise.all(['NORMAL', 'REGISTERED', 'EMS'].map((type) => this.get(`order-type-prices/date?dropOffAt=${at}&type=${type}`)
        .then((data) => [type, data.orderTypePrices]))),
      Promise.all(['REGISTERED', 'EMS'].map((type) => this.get(`country-zones/date?dropOffAt=${at}&type=${type}&page=1&perPage=1000&orderBy=country&orderDirection=asc`)
        .then((data) => [type, data.countryZones]))),
      this.get(`e-ar-prices/date?dropOffAt=${at}`),
      this.get(`service-prices/date?dropOffAt=${at}`),
      this.get(`rural-areas/date?dropOffAt=${at}&page=1&perPage=1000&orderBy=postalCode&orderDirection=asc`),
    ]);
    const international = {};
    return {
      domestic: Object.fromEntries(domestic),
      zones: Object.fromEntries(zones),
      eAr: Object.fromEntries(eAr.eArPrices.map((p) => [p.eArService, Number(p.basePrice)])),
      service: Object.fromEntries(service.servicePrices.map((p) => [p.service, Number(p.basePrice)])),
      rural: { price: Number(rural.basePrice), areas: rural.ruralAreas.map(({ postalCode, area }) => ({ postalCode, area })) },
      /** Weight bands of a registered / EMS zone abroad */
      international: (type, zone) => (international[`${type}${zone}`] ??= this.get(`international-order-type-prices/date?dropOffAt=${at}&type=${type}&zone=${zone}`)
        .then((data) => data.internationalOrderTypePrices)),
    };
  }

  async order(id) {
    return this.get(`orders/${id}`);
  }

  /** The items with a Thai Post status: every item but Lite ones */
  async orderItems(orderId) {
    return this.get(`order-items?orderId=${orderId}&page=1&perPage=1000`);
  }

  /** The order's preloaded file (CSV with every item, Lite ones too), as the portal's CSV download gives it */
  async preloadedFile(orderId) {
    const response = await this.context.request.get(`${env.apiURL}/v1/backend/orders/${orderId}/documents/preloaded`, {
      headers: { authorization: this.authorization },
    });
    expect(response.status(), `preloaded file of order ${orderId}`).toBe(200);
    return response.body();
  }

  /**
   * Mocks a Thai Post tracking update of a dropped-off item (dev): 'inTransit', 'delivered' or 'failed' with a
   * `reason`, which the delivery-rate dashboard ranks; `at` is when it happened
   */
  async updateItemStatus(trackingNumber, kind, { reason = 'บ้านปิด', at = new Date() } = {}) {
    return this.patch(`order-items/${trackingNumber}/status`, trackingUpdate(trackingNumber, kind, { reason, at }));
  }

  /** The order list row of an order number created in the last week: { id, status, totalOrderItems, ... } */
  async findOrder(number) {
    const day = 24 * 60 * 60 * 1000;
    const startDate = new Date(Date.now() - 7 * day).toISOString();
    const endDate = new Date(Date.now() + day).toISOString();
    const orders = await this.get(`orders?startDate=${startDate}&endDate=${endDate}&search=${number}&page=1&perPage=10`);
    return orders.find((order) => order.trackingNumber === number);
  }

  async close() {
    await this.context.close();
  }
}

/** 29/10/2569 23:41:12+07:00, as Thai Post sends it */
function thaiPostDateTime(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${p.day}/${p.month}/${Number(p.year) + 543} ${p.hour}:${p.minute}:${p.second}+07:00`;
}

/** The body of a Thai Post tracking update, from the samples dev gave (CPM delivery mock) */
function trackingUpdate(barcode, kind, { reason, at }) {
  const common = { barcode, call_center_tel: '1545' };
  const nobody = { receiver_name: null, signature: null };
  if (kind === 'inTransit') {
    return {
      ...common, ...nobody, status: '201', status_description: 'ออกจากที่ทำการ/ศูนย์ไปรษณีย์', location: 'ชุมพร', postcode: '86010',
      delivery_status: null, delivery_description: null, delivery_datetime: null,
      status_detail: 'สิ่งของส่งออกจาก [ ศูนย์คัดแยก ชุมพร ] ไปยัง [ ที่ทำการนำจ่าย เฉวง DB2 ]',
      delivery_officer_name: null, delivery_officer_tel: null, office_name: null, office_tel: null,
    };
  }
  const delivery = { delivery_datetime: thaiPostDateTime(at), delivery_officer_name: 'Automation', delivery_officer_tel: '0000000000' };
  if (kind === 'delivered') {
    return {
      ...common, ...delivery, status: '501', status_description: 'นำจ่ายสำเร็จ', location: 'พลับพลาไชย', postcode: '10100',
      delivery_status: 'S', delivery_description: 'ผู้รับได้รับสิ่งของเรียบร้อยแล้ว', receiver_name: 'Automation', signature: null,
      status_detail: 'นำจ่ายสำเร็จ [ ที่ทำการไปรษณีย์ พลับพลาไชย ]', office_name: 'พลับพลาไชย', office_tel: '0000000000',
    };
  }
  if (kind === 'failed') {
    return {
      ...common, ...nobody, ...delivery, status: '401', status_description: 'นำจ่ายไม่สำเร็จ', location: 'เฉวง DB2', postcode: '84320',
      delivery_status: '8', delivery_description: reason, status_detail: `นำจ่ายไม่สำเร็จ (${reason}) [ ที่ทำการนำจ่าย เฉวง DB2 ]`,
      office_name: 'เฉวง', office_tel: '0000000000',
    };
  }
  throw new Error(`Unknown tracking update "${kind}"`);
}

/** Fee settings start at midnight Bangkok time */
function startOfBangkokDay(date) {
  const bangkok = new Date(new Date(date).getTime() + 7 * 60 * 60 * 1000);
  bangkok.setUTCHours(0, 0, 0, 0);
  return new Date(bangkok.getTime() - 7 * 60 * 60 * 1000).toISOString();
}

module.exports = { BackOfficeApi };
