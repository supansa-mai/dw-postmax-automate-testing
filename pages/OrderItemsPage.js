const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/** รายละเอียดการจัดส่งรายพัสดุ — /th/orders/:id/items, after the order is received at drop off */
class OrderItemsPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.title = page.getByRole('heading', { level: 4 });
    this.grid = page.getByRole('grid');
    this.rows = this.grid.locator('[role=rowgroup] [role=row]');
    this.scroller = page.locator('.MuiDataGrid-virtualScroller');
  }

  /**
   * Every cell of each row by field (refId, status, trackingNumber, type, service, eArService, product, hasInsurance,
   * ref1, ...). The grid only renders the columns in view, so it is read while scrolling right.
   */
  async rowValues() {
    await expect(this.rows.first()).toBeVisible({ timeout: 30000 });
    const rows = {};
    const width = await this.scroller.evaluate((el) => el.scrollWidth);
    for (let x = 0; x <= width; x += 200) {
      // The grid renders the newly visible columns on the frames after the scroll event
      await this.scroller.evaluate((el, left) => {
        el.scrollLeft = left;
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, x);
      const cells = await this.rows.evaluateAll((all) => all.map((r) => [r.dataset.id,
        [...r.querySelectorAll('[data-field]')].map((c) => [c.dataset.field, c.innerText.trim()])]));
      for (const [id, fields] of cells) Object.assign(rows[id] ??= {}, Object.fromEntries(fields));
    }
    return Object.values(rows);
  }
}

module.exports = { OrderItemsPage };
