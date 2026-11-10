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
  }

  async goto() {
    await super.goto('orders');
    await this.waitForRows();
  }

  /** The orders API takes ~7s on dev (Nov 2026), longer than the default expect timeout */
  async waitForRows() {
    await expect(this.rows.first()).toBeVisible({ timeout: 30000 });
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
