const { BasePage } = require('./BasePage');

/** รายงานการฝากส่ง — /th/orders/:id/report */
class OrderReportPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.title = page.getByRole('heading', { level: 4 });
    this.areaTable = this.table('พื้นที่');
    this.serviceTable = this.table('ประเภทบริการ');
    this.deliveryTable = this.table('เลขรหัสไปรษณีย์');
  }

  table(firstColumn) {
    return this.page.getByRole('table').filter({ has: this.page.getByRole('columnheader', { name: firstColumn, exact: true }) });
  }
}

module.exports = { OrderReportPage };
