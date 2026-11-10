const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/** Drop Off รายละเอียดใบนำส่ง — /th/dropoff/orders/:id, also where the order is received (นำส่งเข้าสู่ระบบ) */
class DropOffOrderDetailPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.title = page.getByRole('heading', { level: 4 }).filter({ hasText: 'รายละเอียดใบนำส่ง' });
    this.breadcrumbs = page.getByRole('navigation').getByRole('listitem');
    this.csvButton = page.getByRole('button', { name: 'รายละเอียดการจัดส่งทั้งหมด (CSV)' });

    // ข้อมูลตามใบนำส่ง: one row per weight, then the รวมทั้งหมด row
    this.serviceTable = page.getByRole('table');
    // ตารางสรุปจำนวนชิ้นที่รับฝากแยกตามประเภทบริการ
    this.receivedGrid = page.getByRole('grid');

    this.methodSelect = page.getByRole('combobox', { name: 'วิธีการนำส่งเข้าสู่ระบบ' });
    // ยืนยัน here, รับฝาก on the summary page that follows
    this.primaryButton = page.getByRole('button', { name: 'button-group-primary' });

    // สรุปรายการใบนำส่งทั้งหมด — /th/dropoff/orders/:id/scan/all
    this.summaryTitle = page.getByRole('heading', { level: 4 }).filter({ hasText: 'สรุปรายการใบนำส่งทั้งหมด' });
    this.summaryRows = page.getByRole('grid').locator('[role=rowgroup] [role=row]');
    this.receiveDialog = page.getByRole('dialog', { name: 'คุณต้องการยืนยันการนำรายการใบนำส่งเข้าสู่ระบบหรือไม่?' });
    this.toast = page.getByRole('alert').and(page.locator('.MuiAlert-root'));

    // สแกนทีละชิ้น — /th/dropoff/orders/:id/scan/individual; 13 characters import without Enter
    this.scanInput = page.getByRole('textbox', { name: 'สแกนทีละชิ้น' });
    this.mismatchWarning = page.getByText('จำนวนรับฝากไม่ตรงกับจำนวนเตรียมฝากส่ง กรุณาตรวจสอบก่อนยืนยัน');

    // Shown while the order is กำลังรับฝาก
    this.finishButton = page.getByRole('button', { name: 'สิ้นสุดการรับฝาก' });
    this.finishDialog = page.getByRole('dialog', { name: /คุณต้องการยืนยันการสิ้นสุดรับฝากเข้าสู่ระบบหรือไม่/ });
    this.reasonSelect = this.finishDialog.getByRole('combobox', { name: 'สาเหตุที่รับฝากไม่ครบ' });
    this.reasonDetail = this.finishDialog.getByRole('textbox', { name: 'รายละเอียดเพิ่มเติม' });
  }

  /** The tables are filled after the page shows up; wait for the รวมทั้งหมด row */
  async waitForOrder() {
    await expect(this.serviceTable.getByRole('row').last()).toContainText('รวมทั้งหมด', { timeout: 30000 });
  }

  /** วิธีการนำส่งเข้าสู่ระบบ "ทั้งหมด" → ยืนยัน, lands on the summary page of all items */
  async chooseReceiveAll() {
    await this.methodSelect.click();
    await this.page.getByRole('option', { name: 'ทั้งหมด', exact: true }).click();
    await this.primaryButton.click();
    await expect(this.summaryTitle).toBeVisible();
  }

  /** วิธีการนำส่งเข้าสู่ระบบ "สแกนทีละชิ้น" → ยืนยัน */
  async chooseScanEach() {
    await this.methodSelect.click();
    await this.page.getByRole('option', { name: 'สแกนทีละชิ้น', exact: true }).click();
    await this.primaryButton.click();
    await expect(this.scanInput).toBeVisible();
  }

  async scan(trackingNumbers) {
    for (const [i, trackingNumber] of trackingNumbers.entries()) {
      await this.scanInput.fill(trackingNumber);
      await expect(this.page.getByRole('heading', { name: `${i + 1} ชิ้น`, exact: true })).toBeVisible();
    }
  }

  /** สิ้นสุดการรับฝาก of a partly received order; the reason is required */
  async finishReceiving(reason, detail) {
    await this.finishButton.click();
    await this.reasonSelect.click();
    await this.page.getByRole('option', { name: reason, exact: true }).click();
    await this.reasonDetail.fill(detail);
    await this.finishDialog.getByRole('button', { name: 'ยืนยัน' }).click();
  }

  async download(button) {
    const [download] = await Promise.all([this.page.waitForEvent('download'), button.click()]);
    return download;
  }
}

module.exports = { DropOffOrderDetailPage };
