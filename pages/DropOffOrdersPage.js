const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/** Drop Off รายการใบนำส่ง — /th/dropoff/orders, orders of the companies tied to the staff's branch */
class DropOffOrdersPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.title = page.getByRole('heading', { name: 'รายการใบนำส่ง', level: 4 });
    this.searchInput = page.getByRole('textbox', { name: 'ค้นหาหมายเลขใบนำส่ง หรือหมายเลขอ้างอิง' });
    this.grid = page.getByRole('grid');
    this.rows = this.grid.locator('[role=rowgroup] [role=row]');
    this.scroller = page.locator('.MuiDataGrid-virtualScroller');
  }

  async goto() {
    await super.goto('dropoff/orders');
    await expect(this.rows.first()).toBeVisible({ timeout: 30000 });
  }

  async search(orderNumber) {
    await this.searchInput.fill(orderNumber);
    await expect(this.rows).toHaveCount(1);
    await expect(this.row(orderNumber)).toBeVisible();
  }

  row(orderNumber) {
    return this.rows.filter({ has: this.page.getByRole('gridcell', { name: orderNumber, exact: true }) });
  }

  /**
   * trackingNumber (หมายเลขใบนำส่ง), companyName, formattedRefNo, createdAt, totalOrderItems,
   * totalDroppedOffOrderItems, status; the last two are only rendered once the grid is scrolled right
   */
  cell(orderNumber, field) {
    return this.row(orderNumber).locator(`[data-field="${field}"]`);
  }

  async scrollGrid(to) {
    await this.scroller.evaluate((el, end) => { el.scrollLeft = end ? el.scrollWidth : 0; }, to === 'end');
  }

  async openDetail(orderNumber) {
    await this.scrollGrid('start');
    await this.cell(orderNumber, 'trackingNumber').getByText(orderNumber, { exact: true }).click();
  }
}

module.exports = { DropOffOrdersPage };
