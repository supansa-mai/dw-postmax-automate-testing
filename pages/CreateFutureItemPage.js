const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/** สร้างใบนำส่ง from future items (DLT) — /th/future-items/create */
class CreateFutureItemPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.title = page.getByRole('heading', { name: 'สร้างใบนำส่ง', level: 4 });
    this.breadcrumbList = page.getByTestId('breadcrumb-1');
    this.breadcrumbCurrent = page.getByTestId('breadcrumb-2');
    this.scanTitle = page.getByRole('heading', { name: 'สแกนหมายเลขติดตามพัสดุ', level: 5 });
    this.scanInput = page.getByRole('textbox', { name: 'สแกน หรือ กรอกหมายเลขติดตามพัสดุ' });

    this.listTitle = page.getByRole('heading', { name: 'รายการพัสดุ', level: 5 });
    this.total = page.getByText(/^ทั้งหมด \d+ รายการ$/);
    this.deleteButton = page.getByTestId('future-item-delete-button');
    this.searchInput = page.getByRole('textbox', { name: 'ค้นหาหมายเลขติดตาม หรือ หมายเลขอ้างอิง (DLT)' });
    this.emptyState = page.getByText('สแกนหมายเลขพัสดุ หรือ กรอกหมายเลขติดตาม', { exact: true });
    this.grid = page.getByRole('grid');
    this.rows = this.grid.locator('[role=rowgroup] [role=row]');
    // Checkbox names flip to "Unselect ..." once checked, so they are found by position, not by name
    this.selectAll = this.grid.getByRole('columnheader').getByRole('checkbox');
    this.paginationLabel = page.getByText(/^\d+–\d+ of \d+$/);
    this.nextPageButton = page.getByRole('button', { name: 'Go to next page' });

    this.cancelButton = page.getByTestId('future-item-create-secondary');
    this.createButton = page.getByTestId('future-item-create-primary');
    // Not Next.js's route announcer, which is also role=alert
    this.toast = page.getByRole('alert').and(page.locator('.MuiAlert-root'));
  }

  /** Waits until React has hydrated the scan input: Enter pressed before that is lost */
  async goto() {
    await super.goto('future-items/create');
    await expect.poll(() => this.scanInput.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps'))))
      .toBe(true);
  }

  /** Modal by its title, e.g. "ไม่พบหมายเลขติดตามพัสดุนี้" or "สร้างใบนำส่ง?" */
  dialog(title) {
    return this.page.getByRole('dialog').filter({ has: this.page.getByRole('heading', { name: title, level: 6 }) });
  }

  /** Types the tracking number and presses Enter, as a barcode scanner does */
  async scan(trackingNumber) {
    await this.scanInput.fill(trackingNumber);
    await this.scanInput.press('Enter');
  }

  async count() {
    return Number((await this.total.innerText()).match(/\d+/)[0]);
  }

  /** Scans items that must be accepted, waiting for each to be added before the next one */
  async scanItems(items) {
    let count = await this.count();
    for (const { trackingNumber } of items) {
      await this.scan(trackingNumber);
      await expect(this.total).toHaveText(`ทั้งหมด ${++count} รายการ`);
    }
  }

  row(trackingNumber) {
    return this.rows.filter({ has: this.page.getByRole('gridcell', { name: trackingNumber, exact: true }) });
  }

  /**
   * Toggles a row's checkbox. click(), not check(): the grid re-renders the checkbox on click, so check() finds a
   * new element and reports that the state did not change; assert the selection through deleteButton's count
   */
  async toggle(trackingNumber) {
    await this.row(trackingNumber).getByRole('checkbox').click();
  }

  /** Same as toggle(), for the header checkbox that selects every row on every page */
  async toggleAll() {
    await this.selectAll.click();
  }

  async visibleColumnHeaders() {
    return (await this.grid.getByRole('columnheader').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  }

  /** Tracking numbers of the rows on the current page */
  async visibleTrackingNumbers() {
    return this.rows.evaluateAll((rows) => rows.map((r) => r.querySelectorAll('[role=gridcell]')[1].innerText.trim()));
  }

  async deleteSelected() {
    await this.deleteButton.click();
    await this.dialog('ลบรายการพัสดุ?').getByRole('button', { name: 'ยืนยัน' }).click();
  }

  async createOrder() {
    await this.createButton.click();
    await this.dialog('สร้างใบนำส่ง?').getByRole('button', { name: 'ยืนยัน' }).click();
  }
}

module.exports = { CreateFutureItemPage };
