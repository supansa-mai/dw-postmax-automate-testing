const { BasePage } = require('./BasePage');

/** การฝากส่งของฉัน — /th/orders, newest order first */
class OrdersPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.grid = page.getByRole('grid');
    this.rows = this.grid.locator('[role=rowgroup] [role=row]');
  }

  async goto() {
    await super.goto('orders');
    await this.page.waitForLoadState('networkidle');
  }

  /** Columns: หมายเลขใบนำส่ง, หมายเลขอ้างอิง, วันที่/เวลาที่สร้าง, เตรียมฝากส่ง (ชิ้น), รับฝากแล้ว (ชิ้น), สถานะ */
  cell(row, column) {
    const index = ['orderNumber', 'reference', 'createdAt', 'prepared', 'received', 'status'].indexOf(column);
    return row.getByRole('gridcell').nth(index);
  }
}

module.exports = { OrdersPage };
