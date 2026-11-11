const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/** เตรียมการฝากส่ง — /th/preload: upload a CSV, check it, confirm; lands on the new order's detail page */
class PreloadPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.title = page.getByRole('heading', { name: 'เตรียมการฝากส่ง', level: 4 });
    this.subtitle = page.getByRole('heading', { name: 'กรุณาดำเนินการตามขั้นตอนที่กำหนด เพื่อเตรียมการฝากส่ง', level: 6 });
    // Step 1: เลือกวิธีการนำเข้าข้อมูล
    this.importHeading = page.getByRole('heading', { name: 'นำเข้าจากไฟล์ CSV', level: 5 });
    this.sizeHint = page.getByText('(ขนาดไม่เกิน 10MB)');
    this.sizeError = page.getByText('นำเข้าไฟล์ไม่สำเร็จ ขนาดไฟล์เกิน 10 MB กรุณาอัปโหลดใหม่อีกครั้ง', { exact: true });
    this.fileInput = page.locator('input[type=file]');
    this.loading = page.getByText(/กำลังตรวจสอบ/);
    // Step 2: ตรวจสอบข้อมูลการฝากส่ง
    this.checkHeading = page.getByRole('heading', { name: 'ตรวจสอบข้อมูลการฝากส่ง', level: 5 });
    this.checkResult = this.field('ผลการตรวจสอบข้อมูล:');
    this.itemCount = this.field('เตรียมฝากส่ง');
    this.serviceGrid = page.getByRole('grid');
    this.backButton = page.getByRole('button', { name: 'button-group-back' });
    this.cancelButton = page.getByRole('button', { name: 'button-group-secondary' });
    this.toast = page.getByRole('alert').and(page.locator('.MuiAlert-root'));
    // "คุณสามารถดาวน์โหลดตัวอย่างไฟล์ CSV ได้โดย คลิกที่นี่": the template of the user's type
    this.templateLink = page.getByRole('heading', { name: 'คลิกที่นี่', level: 6 });
    this.validResult = page.getByText('ข้อมูลถูกต้องทั้งหมด', { exact: true });
    // ถัดไป on the check step, ยืนยัน on the summary step
    this.primaryButton = page.getByRole('button', { name: 'button-group-primary' });
    this.referenceInput = page.getByRole('textbox', { name: 'หมายเลขอ้างอิง' });
    // TSD only, all required
    this.exportDateButton = page.getByRole('button', { name: 'Choose date' });
    this.exportDatePicker = page.getByRole('dialog', { name: 'วันที่/เวลาส่งออก' });
    this.documentTypeInput = page.getByRole('textbox', { name: 'ประเภทเอกสาร' });
    this.orderNameInput = page.getByRole('textbox', { name: 'ชื่อรายการ' });
    this.confirmDialog = page.getByRole('dialog', { name: /คุณต้องการยืนยันการฝากส่งหรือไม่/ });
    this.orderTitle = page.getByRole('heading', { name: /^หมายเลขใบนำส่ง : PM[0-9A-Z]+$/, level: 4 });
  }

  /** Waits for the user's profile: until it loads, the template link gives every user the non-TSD template */
  async goto() {
    await Promise.all([this.page.waitForResponse(/\/users\/profile/), super.goto('preload')]);
    await expect(this.title).toBeVisible();
  }

  async downloadTemplate() {
    const [download] = await Promise.all([this.page.waitForEvent('download'), this.templateLink.click()]);
    return download;
  }

  /** Selects the file and waits for the check result (step 2) */
  async check(buffer, { name = 'preload.csv', mimeType = 'text/csv' } = {}) {
    await this.fileInput.setInputFiles({ name, mimeType, buffer });
    await expect(this.checkResult).toBeVisible({ timeout: 30000 });
  }

  async upload(buffer, name = 'preload.csv') {
    await this.fileInput.setInputFiles({ name, mimeType: 'text/csv', buffer });
    await expect(this.validResult).toBeVisible({ timeout: 30000 });
  }

  /** The message under a required field of the summary step, e.g. "ประเภทเอกสาร" */
  requiredError(message) {
    return this.page.getByText(message, { exact: true });
  }

  /**
   * วันที่/เวลาส่งออก: today at the current time (minutes go by 5, so rounded down), which the default filters of
   * การฝากส่งของฉัน show. Returns it as the portal shows it: dd/mm/yyyy (Buddhist year) - HH:MM
   */
  async pickExportDate() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
    const minute = String(Math.floor(Number(parts.minute) / 5) * 5).padStart(2, '0');
    const day = this.exportDatePicker.getByRole('gridcell', { name: String(Number(parts.day)), exact: true });
    // A click while the picker is still opening is lost: reopen and pick again
    await expect(async () => {
      if (await this.exportDatePicker.isVisible()) await this.page.keyboard.press('Escape');
      await this.exportDateButton.click();
      await day.click();
      await expect(day).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
    }).toPass({ timeout: 20000 });
    await this.exportDatePicker.getByRole('option', { name: `${Number(parts.hour)} hours`, exact: true }).click();
    await this.exportDatePicker.getByRole('option', { name: `${Number(minute)} minutes`, exact: true }).click();
    await expect(this.exportDatePicker).toBeHidden();
    const time = `${parts.hour}:${minute}`;
    await expect(this.page.getByRole('textbox', { name: 'วันที่/เวลาส่งออก' })).toHaveValue(`${parts.day}/${parts.month}/${parts.year} - ${time}`);
    return `${parts.day}/${parts.month}/${Number(parts.year) + 543} - ${time}`;
  }

  /** From the checked file to the created order; returns { number, exportDate } (TSD: as pickExportDate returns it) */
  async createOrder({ reference, tsd = false, documentType, orderName }) {
    await this.primaryButton.click();
    await expect(this.referenceInput).toBeVisible();
    await this.referenceInput.fill(reference);
    let exportDate;
    if (tsd) {
      exportDate = await this.pickExportDate();
      await this.documentTypeInput.fill(documentType);
      await this.orderNameInput.fill(orderName);
    }
    await this.primaryButton.click();
    await this.confirmDialog.getByRole('button', { name: 'ยืนยัน' }).click();
    await expect(this.orderTitle).toBeVisible({ timeout: 30000 });
    return { number: (await this.orderTitle.innerText()).replace('หมายเลขใบนำส่ง : ', ''), exportDate };
  }
}

module.exports = { PreloadPage };
