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
    this.rowsPerPage = page.getByRole('combobox', { name: /^Rows per page/ });
    // "1–12 of 12" once every item is on one page
    this.allOnOnePage = page.getByText(/^1–(\d+) of \1$/);
  }

  async search(text) {
    await this.page.getByRole('textbox', { name: 'ค้นหาหมายเลขติดตามพัสดุหรือชื่อผู้รับ' }).fill(text);
    await expect(this.rows).toHaveCount(1, { timeout: 30000 });
  }

  /** เลือกสถานะ lists Thai Post's status descriptions, e.g. "นำจ่ายสำเร็จ" */
  async filterStatus(status) {
    await this.page.getByRole('combobox', { name: 'เลือกสถานะ' }).click();
    await this.page.getByRole('option', { name: status, exact: true }).click();
    await this.page.keyboard.press('Escape');
  }

  /** เอกสารยืนยันการจัดส่ง (e-AR) of an item's row; only enabled once the signed e-AR file is in */
  documentButton(trackingNumber) {
    return this.rows.filter({ hasText: trackingNumber }).locator('[data-field=documentConfirmation] button');
  }

  /** The grid shows 10 items a page; 50 (the most) fits every order the tests create */
  async showAllRows() {
    await this.rowsPerPage.click();
    await this.page.getByRole('option', { name: '50', exact: true }).click();
    await expect(this.allOnOnePage).toBeVisible();
  }

  /**
   * Every cell of each row by field (refId, status, trackingNumber, type, service, eArService, product, hasInsurance,
   * ref1, ...) of every item. The grid only renders the columns in view, so it is read while scrolling right.
   */
  async rowValues() {
    await expect(this.rows.first()).toBeVisible({ timeout: 30000 });
    await this.showAllRows();
    const rows = {};
    const { width, height, view } = await this.scroller.evaluate((el) => ({ width: el.scrollWidth, height: el.scrollHeight, view: el.clientHeight }));
    // The grid only renders the rows and columns in view, so it is read in screens, down then right
    for (let y = 0; y < height; y += Math.max(view - 50, 100)) {
      for (let x = 0; x <= width; x += 200) {
        // The grid renders the newly visible cells on the frames after the scroll event
        await this.scroller.evaluate((el, [left, top]) => {
          el.scrollLeft = left;
          el.scrollTop = top;
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, [x, y]);
        const cells = await this.rows.evaluateAll((all) => all.map((r) => [r.dataset.id,
          [...r.querySelectorAll('[data-field]')].map((c) => [c.dataset.field, c.innerText.trim()])]));
        for (const [id, fields] of cells) Object.assign(rows[id] ??= {}, Object.fromEntries(fields));
      }
    }
    await this.scroller.evaluate((el) => { el.scrollLeft = 0; el.scrollTop = 0; });
    return Object.values(rows);
  }
}

module.exports = { OrderItemsPage };
