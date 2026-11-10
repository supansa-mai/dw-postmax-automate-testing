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

  async download(button) {
    const [download] = await Promise.all([this.page.waitForEvent('download'), button.click()]);
    return download;
  }
}

module.exports = { DropOffOrderDetailPage };
