const { expect } = require('@playwright/test');

/**
 * A start - end date range of a list, log or create page, by its fields' labels (without the " *" of a required one),
 * e.g. "วันที่ออกใบสรุปยอดเริ่มต้น" / "วันที่ออกใบสรุปยอดสิ้นสุด", or by the fields themselves. Dates are DD/MM/YYYY in B.E.
 */
class DateRangeField {
  /** @param {import('@playwright/test').Page} page */
  constructor(page, start, end) {
    const field = (label) => (typeof label === 'string' ? page.getByRole('textbox', { name: new RegExp(`^${label}( \\*)?$`) }) : label);
    this.page = page;
    this.start = field(start);
    this.end = field(end);
  }

  /** Types a date the way a person does; a field only takes its date on blur */
  async type(field, date) {
    await field.click();
    await this.page.keyboard.press('ControlOrMeta+a');
    await this.page.keyboard.type(date.replace(/\//g, ''));
    await this.page.keyboard.press('Tab');
  }

  async set(start, end) {
    await this.type(this.start, start);
    await this.type(this.end, end);
    await expect(this.start).toHaveValue(start);
    await expect(this.end).toHaveValue(end);
  }

  /** Picks a day of the month the start field's calendar opens on */
  async pickStartDay(day) {
    await this.start.locator('xpath=ancestor::div[contains(@class,"MuiInputBase-root")][1]').getByRole('button').click();
    await this.page.getByRole('dialog').getByRole('gridcell', { name: String(day), exact: true }).click();
    // Typing while the calendar is still closing can land in the start field
    await expect(this.page.getByRole('dialog')).toBeHidden();
  }
}

module.exports = { DateRangeField };
