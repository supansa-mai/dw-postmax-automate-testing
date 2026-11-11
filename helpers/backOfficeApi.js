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
    for (let attempt = 0; ; attempt++) {
      const response = await this.context.request.get(`${env.apiURL}/v1/backend/${path}`, { headers: { authorization: this.authorization } });
      if (response.status() === 401 && attempt === 0) {
        await this.refreshToken();
        continue;
      }
      expect(response.status(), `GET ${path}`).toBe(200);
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

  async close() {
    await this.context.close();
  }
}

/** Fee settings start at midnight Bangkok time */
function startOfBangkokDay(date) {
  const bangkok = new Date(new Date(date).getTime() + 7 * 60 * 60 * 1000);
  bangkok.setUTCHours(0, 0, 0, 0);
  return new Date(bangkok.getTime() - 7 * 60 * 60 * 1000).toISOString();
}

module.exports = { BackOfficeApi };
