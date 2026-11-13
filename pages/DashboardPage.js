const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/** รายงานข้อมูล — /th/dashboard: tabs ภาพรวม, จำนวนชิ้นงาน, อัตราการนำจ่าย (not TSD) and ค่าบริการ (TSD only) */
class DashboardPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.title = page.getByRole('heading', { name: 'รายงานข้อมูล', level: 4 });
    this.dateFilter = page.getByRole('combobox', { name: 'วันที่' });
  }

  /** Opens the page and returns the token of the portal's own API calls, for reading the dashboard's data */
  async goto() {
    const request = this.page.waitForRequest((r) => r.url().includes('/v1/frontend/analytics/') && r.headers().authorization);
    await super.goto('dashboard');
    await expect(this.title).toBeVisible();
    return (await request).headers().authorization;
  }

  async openTab(name) {
    await this.page.getByText(name, { exact: true }).first().click();
    await this.page.waitForLoadState('networkidle');
  }

  /** "28 วันที่ผ่านมา : 14 ต.ค. - 11 พ.ย. 2569", as the date filter shows it */
  async dateLabel() {
    return (await this.dateFilter.locator('xpath=..').innerText()).replace(/\s+/g, ' ').trim();
  }

  async dateOptions() {
    await this.dateFilter.click();
    const options = await this.page.getByRole('option').allInnerTexts();
    await this.page.keyboard.press('Escape');
    return options;
  }

  async pickDateOption(name) {
    await this.dateFilter.click();
    await this.page.getByRole('option', { name, exact: true }).click();
    await this.page.waitForLoadState('networkidle');
  }

  /** The กำหนดช่วงเวลา modal of กำหนดเอง */
  customRangeModal() {
    return this.page.locator('.MuiModal-root').filter({ hasText: 'กำหนดช่วงเวลา' });
  }

  /** กำหนดเอง from `from` to `to` (DD/MM/YYYY in Buddhist years, see fieldDate()), typed into the modal's fields */
  async pickCustomRange(from, to) {
    await this.pickDateOption('กำหนดเอง');
    const modal = this.customRangeModal();
    for (const [field, value] of [[modal.getByRole('textbox').first(), from], [modal.getByRole('textbox').last(), to]]) {
      await field.click();
      await this.page.keyboard.press('ControlOrMeta+a');
      await this.page.keyboard.type(value.replace(/\//g, ''));
    }
    await modal.getByRole('button', { name: 'ยืนยัน' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  /** Picks options of a multi-select filter, e.g. ประเภทบริการ */
  async select(filter, options) {
    await this.page.getByRole('combobox', { name: filter }).click();
    for (const name of options) await this.page.getByRole('option', { name, exact: true }).click();
    await this.page.keyboard.press('Escape');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * The orders หมายเลขใบนำส่ง offers, `text` typed in it first. ค่าบริการ (TSD) loads 50 more each time the list is
   * scrolled to the end (CPM-1839), so it is scrolled until no more come; the other tabs offer the latest 50 (CPM-1840)
   */
  async orderOptions(text) {
    const box = this.page.getByRole('combobox', { name: 'หมายเลขใบนำส่ง' });
    const options = this.page.getByRole('option');
    await box.click();
    if (text) {
      const search = this.page.waitForResponse((r) => /v1\/frontend\/orders\?/.test(r.url()) && new URL(r.url()).searchParams.get('search') === text);
      await this.page.keyboard.type(text);
      await search;
    }
    await expect(options.first()).toBeVisible();
    for (let count = 0; count !== await options.count();) {
      count = await options.count();
      const more = this.page.waitForResponse((r) => /v1\/frontend\/orders\?/.test(r.url()), { timeout: 3000 }).catch(() => null);
      await this.page.getByRole('listbox').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      if (await more) await this.page.waitForLoadState('networkidle');
    }
    const offered = await options.allInnerTexts();
    await this.page.keyboard.press('Escape');
    return offered;
  }

  /** Adds an order to หมายเลขใบนำส่ง; it must be one of orderOptions() */
  async pickOrder(number) {
    await this.page.getByRole('combobox', { name: 'หมายเลขใบนำส่ง' }).click();
    await this.page.getByRole('option', { name: number, exact: true }).click();
    await this.page.keyboard.press('Escape');
    await this.page.waitForLoadState('networkidle');
  }

  /** The filter's X, which only shows on hover */
  async clear(filter) {
    const box = this.page.getByRole('combobox', { name: filter });
    await box.hover();
    await box.locator('xpath=..').getByRole('button', { name: 'Clear' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  /** TSD's search on จำนวนชิ้นงาน: ประเภทการค้นหา (e.g. "อีเมล") picks the field, its box is then "ค้นหาอีเมล" */
  async searchBy(field, text) {
    await this.page.getByRole('combobox', { name: 'ประเภทการค้นหา' }).click();
    await this.page.getByRole('option', { name: field, exact: true }).click();
    await this.page.getByRole('textbox', { name: `ค้นหา${field}` }).fill(text);
    await this.page.keyboard.press('Enter');
    await this.page.waitForLoadState('networkidle');
  }

  async search(text) {
    await this.page.getByRole('textbox', { name: 'หมายเลขอ้างอิง' }).fill(text);
    await this.page.keyboard.press('Enter');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Runs `action` (a filter, a search, a date range) and returns the item count the page then got from the API
   * (order-item-deliveries on จำนวนชิ้นงาน, delivery-summary on อัตราการนำจ่าย); the numbers on the page follow it
   */
  async countAfter(action, { search } = {}) {
    // `search`: wait for the request with this search, when the action makes others before it (TSD's field change)
    const response = this.page.waitForResponse((r) => /analytics\/(order-item-deliveries|delivery-summary)/.test(r.url())
      && (search === undefined || new URL(r.url()).searchParams.get('search') === search));
    await action();
    const body = await (await response).json();
    return (body.meta ?? body.data.deliveries.meta).overAllCount;
  }

  /**
   * Runs `action` on ค่าบริการ (TSD) and returns what the page then got: { total, months, startDate, endDate }, total
   * being ค่าบริการทั้งหมด and months the fee per month (or day) of the chart
   */
  async feeAfter(action, { search } = {}) {
    const response = this.page.waitForResponse((r) => /analytics\/orders\?/.test(r.url())
      && (search === undefined || new URL(r.url()).searchParams.get('search') === search));
    await action();
    const url = new URL((await response).url());
    const { data, meta } = await (await response).json();
    return {
      total: meta.overAllPrice,
      months: Object.fromEntries(data.map((d) => [d.timestamp.slice(0, 7), d.totalPrice])),
      startDate: url.searchParams.get('startDate'),
      endDate: url.searchParams.get('endDate'),
    };
  }

  /** ค่าบริการทั้งหมด of the ค่าบริการ tab (TSD) */
  async feeTotal() {
    const text = await this.boxText('ค่าบริการทั้งหมด');
    return Number(text.match(/ค่าบริการทั้งหมด ([\d,.]+) บาท/)[1].replace(/,/g, ''));
  }

  /** จำนวนชิ้นงานทั้งหมด of the จำนวนชิ้นงาน tab */
  async itemTotal() {
    const text = await this.boxText('จำนวนชิ้นงานทั้งหมด');
    return Number(text.match(/จำนวนชิ้นงานทั้งหมด ([\d,]+) ชิ้น/)[1].replace(/,/g, ''));
  }

  /**
   * The items table's rows on the first page, by column: { orderNumber, reference, trackingNumber, type, area } and
   * address (normal users) or sender (TSD, whose columns differ)
   */
  async itemRows() {
    const keys = {
      'หมายเลขใบนำส่ง': 'orderNumber', 'หมายเลขอ้างอิง': 'reference', 'หมายเลขติดตาม': 'trackingNumber', 'ประเภทบริการ': 'type',
      'พื้นที่': 'area', 'ที่อยู่': 'address', 'ชื่อ-นามสกุลหรือชื่อนิติบุคคล': 'sender',
    };
    const grid = this.page.getByRole('grid');
    const columns = (await grid.getByRole('columnheader').allInnerTexts()).map((h) => keys[h.trim()] ?? h.trim());
    return grid.locator('[role=rowgroup] [role=row]').evaluateAll((rows, names) => rows.map((row) => Object.fromEntries(
      [...row.querySelectorAll('[role=gridcell]')].map((cell, i) => [names[i], cell.innerText.trim()]),
    )), columns);
  }

  /**
   * The text of a box by its title, e.g. "อัตราการนำจ่ายสำเร็จตามบริการ", as one line:
   * "อัตราการนำจ่ายสำเร็จตามบริการ 7 วันที่ผ่านมา : 4 - 11 พ.ย. 2569 ลงทะเบียน 0.00 % EMS 0.00 %"
   */
  async boxText(title) {
    // Other tabs' boxes stay in the page, hidden
    const heading = this.page.getByText(title, { exact: true }).locator('visible=true').first();
    await expect(heading).toBeVisible();
    // The numbers come in after the box shows up with zeros
    await this.page.waitForLoadState('networkidle');
    // The title and the date (h6) sit in a header of their own; the box is the first ancestor with more than that
    return heading.evaluate((el) => {
      const text = (node) => node.innerText.replace(/\s+/g, ' ').trim();
      let header = el;
      while (header.parentElement && !header.querySelector('h6')) header = header.parentElement;
      let box = header;
      while (box.parentElement && text(box) === text(header)) box = box.parentElement;
      return text(box);
    });
  }
}

module.exports = { DashboardPage };
