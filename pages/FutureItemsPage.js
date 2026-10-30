const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/** รายการพัสดุล่วงหน้า (DLT) — /th/future-items */
class FutureItemsPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.title = page.getByRole('heading', { name: 'รายการพัสดุล่วงหน้า (DLT)', level: 4 });
    this.listTitle = page.getByRole('heading', { name: 'รายการพัสดุล่วงหน้า', level: 5 });
    this.createShipmentButton = page.getByTestId('create-shipping-note-button');

    this.startDate = page.getByRole('textbox', { name: 'เลือกวันที่ได้รับข้อมูลเริ่มต้น' });
    this.endDate = page.getByRole('textbox', { name: 'เลือกวันที่ได้รับข้อมูลสิ้นสุด' });
    this.batchFilter = page.getByRole('combobox', { name: 'เลือก Batch No.' });
    this.statusFilter = page.getByRole('combobox', { name: 'เลือกสถานะ' });
    this.paymentFilter = page.getByRole('combobox', { name: 'เลือกการชำระเงิน' });
    this.searchField = page.getByRole('combobox', { name: 'ประเภทการค้นหา' });
    this.searchInput = page.getByRole('textbox', { name: /^ค้นหา/ });

    this.emptyState = page.getByTestId('future-item-empty-state');
    this.noResult = page.getByText('ไม่พบผลการค้นหา');
    // The items table, not the day grid of a date picker popup
    this.grid = page.getByRole('grid').and(page.locator('.MuiDataGrid-main'));
    this.rows = this.grid.locator('[role=rowgroup] [role=row]');
    this.scroller = page.locator('.MuiDataGrid-virtualScroller');
    this.toast = page.getByRole('alert').filter({ hasText: /\S/ });

    this.rowsPerPage = page.getByRole('combobox', { name: /Rows per page/ });
    this.paginationLabel = page.getByText(/^\d+–\d+ of \d+$/);
    this.nextPageButton = page.getByRole('button', { name: 'Go to next page' });
    this.previousPageButton = page.getByRole('button', { name: 'Go to previous page' });

    this.cancelDialog = page.getByRole('dialog', { name: 'ยกเลิกรายการพัสดุล่วงหน้า?' });
    this.useCalendar('start');
  }

  async goto() {
    await super.goto('future-items');
    // Dates typed before hydration finishes are wiped (seen on WebKit)
    await this.page.waitForLoadState('networkidle');
  }

  /** Filters live in the URL query, so a reload keeps them */
  async reload() {
    await this.page.reload();
    await this.page.waitForLoadState('networkidle');
  }

  /** Dates as DD/MM/YYYY in B.E. (see helpers/thaiDate.js); the list loads once the end date is set */
  async selectDateRange(start, end) {
    await this.startDate.fill(start);
    await this.endDate.fill(end);
    await this.endDate.blur();
  }

  /**
   * Points the calendar locators at the date picker popup of one field. The popup is a dialog named after
   * the field, which keeps it apart from the other field's popup while that one is still closing.
   * @param {'start' | 'end'} field
   */
  useCalendar(field) {
    const input = field === 'start' ? this.startDate : this.endDate;
    const name = field === 'start' ? 'เลือกวันที่ได้รับข้อมูลเริ่มต้น' : 'เลือกวันที่ได้รับข้อมูลสิ้นสุด';
    this.calendarButton = input.locator('xpath=ancestor::div[contains(@class,"MuiInputBase-root")][1]').getByRole('button');
    this.calendar = this.page.getByRole('dialog', { name });
    // e.g. "มีนาคม 2569"
    this.calendarMonth = this.calendar.locator('.MuiPickersCalendarHeader-label');
    this.previousMonthButton = this.calendar.getByRole('button', { name: 'Previous month' });
    this.nextMonthButton = this.calendar.getByRole('button', { name: 'Next month' });
  }

  /** @param {'start' | 'end'} field */
  async openCalendar(field) {
    this.useCalendar(field);
    await this.calendarButton.click();
    await this.calendarMonth.waitFor();
  }

  /** The picker may open on any month of the allowed range, so walk back then forward to `label` */
  async showCalendarMonth(label) {
    for (const button of [this.previousMonthButton, this.nextMonthButton]) {
      while ((await this.calendarMonth.innerText()) !== label && (await button.isEnabled())) {
        const current = await this.calendarMonth.innerText();
        await button.click();
        // Both months stay in the DOM until the slide animation ends
        await expect(this.calendarMonth).not.toHaveText(current);
        await expect(this.calendar.locator('.MuiDayCalendar-monthContainer')).toHaveCount(1);
      }
    }
  }

  calendarDay(day) {
    return this.calendar.getByRole('gridcell', { name: String(day), exact: true });
  }

  /** Day numbers that can be picked in the month currently shown */
  async enabledCalendarDays() {
    return this.calendar
      .locator('button[role=gridcell]')
      .evaluateAll((days) => days.filter((d) => !d.disabled).map((d) => Number(d.innerText)));
  }

  async selectOption(combobox, name) {
    await combobox.click();
    await this.page.getByRole('option', { name, exact: true }).click();
  }

  async selectBatch(batchNo) {
    await this.batchFilter.click();
    await this.batchFilter.fill(batchNo);
    await this.page.getByRole('option', { name: batchNo, exact: true }).click();
  }

  /** Today's items of one batch, so each test only sees the data it created */
  async openBatch(batchNo, date) {
    await this.goto();
    await this.selectDateRange(date, date);
    await this.selectBatch(batchNo);
  }

  async search(field, text) {
    await this.selectOption(this.searchField, field);
    await this.searchInput.fill(text);
  }

  /** @param {'all' | 'pending' | 'converted' | 'unpaid'} card */
  summaryCount(card) {
    return this.page.getByTestId(`future-item-summary-${card}`).locator('p').last();
  }

  row(id) {
    return this.grid.locator(`[role=row][data-id="${id}"]`);
  }

  /** e.g. refCode, trackingNumber, receiverName, createdAt, status, paymentStatus, actions */
  cell(id, field) {
    return this.row(id).locator(`[data-field="${field}"]`);
  }

  cancelButton(id) {
    return this.row(id).getByRole('button', { name: 'ยกเลิก' });
  }

  /** The grid only renders columns in view; scroll right for สถานะ / สถานะการชำระเงิน / จัดการ */
  async scrollGrid(to) {
    await this.scroller.evaluate((el, end) => { el.scrollLeft = end ? el.scrollWidth : 0; }, to === 'end');
  }

  async visibleColumnHeaders() {
    return this.grid.getByRole('columnheader').allInnerTexts();
  }

  /** data-id of the rows currently shown, in display order */
  async visibleRowIds() {
    return this.rows.evaluateAll((rows) => rows.map((r) => Number(r.dataset.id)));
  }

  async cancelItem(id) {
    await this.scrollGrid('end');
    await this.cancelButton(id).click();
    await this.cancelDialog.getByRole('button', { name: 'ยืนยัน' }).click();
  }
}

module.exports = { FutureItemsPage };
