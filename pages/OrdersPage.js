const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/** การฝากส่งของฉัน — /th/orders, newest order first */
class OrdersPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.grid = page.getByRole('grid');
    this.rows = this.grid.locator('[role=rowgroup] [role=row]');
    this.scroller = page.locator('.MuiDataGrid-virtualScroller');
    this.searchInput = page.getByRole('textbox', { name: 'ค้นหาหมายเลขใบนำส่ง' });
  }

  async goto() {
    await super.goto('orders');
    await this.waitForRows();
  }

  /** The orders API takes ~7s on dev (Nov 2026), longer than the default expect timeout */
  async waitForRows() {
    await expect(this.rows.first()).toBeVisible({ timeout: 30000 });
  }

  async search(orderNumber) {
    await this.searchInput.fill(orderNumber);
    await expect(this.rows).toHaveCount(1, { timeout: 30000 });
    await expect(this.row(orderNumber)).toBeVisible();
  }

  /**
   * Every cell of an order's row by field: trackingNumber, formattedRefNo, createdAt (TSD: documentType, orderName,
   * documentTypeReserved, releaseDate), totalOrderItems, totalDroppedOffOrderItems, status. Read while scrolling right,
   * since the grid only renders the columns in view
   */
  async rowValues(orderNumber) {
    const row = this.row(orderNumber);
    const values = {};
    const width = await this.scroller.evaluate((el) => el.scrollWidth);
    for (let x = 0; x <= width; x += 200) {
      await this.scroller.evaluate((el, left) => {
        el.scrollLeft = left;
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, x);
      Object.assign(values, Object.fromEntries(await row.locator('[data-field]')
        .evaluateAll((cells) => cells.map((c) => [c.dataset.field, c.innerText.trim()]))));
    }
    await this.scroller.evaluate((el) => { el.scrollLeft = 0; });
    delete values.id;
    return values;
  }

  row(orderNumber) {
    return this.rows.filter({ has: this.page.getByRole('gridcell', { name: orderNumber, exact: true }) });
  }

  /** Columns: หมายเลขใบนำส่ง, หมายเลขอ้างอิง, วันที่/เวลาที่สร้าง, เตรียมฝากส่ง (ชิ้น), รับฝากแล้ว (ชิ้น), สถานะ */
  cell(row, column) {
    const index = ['orderNumber', 'reference', 'createdAt', 'prepared', 'received', 'status'].indexOf(column);
    return row.getByRole('gridcell').nth(index);
  }

  /** รายละเอียด icons: [detail, report]. The column is off-screen at 1280px and only rendered once scrolled to */
  async openAction(orderNumber, index) {
    const id = await this.row(orderNumber).getAttribute('data-id');
    await this.scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await this.rows.and(this.page.locator(`[data-id="${id}"]`)).locator('[data-field=id] button').nth(index).click();
  }

  async openDetail(orderNumber) {
    await this.openAction(orderNumber, 0);
  }

  async openReport(orderNumber) {
    await this.openAction(orderNumber, 1);
  }
}

module.exports = { OrdersPage };
