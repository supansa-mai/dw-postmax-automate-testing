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
    this.methodError = page.getByText('กรุณาเลือกวิธีการนำส่งเข้าสู่ระบบ', { exact: true });
    // ยืนยัน here, รับฝาก on the summary page that follows
    this.primaryButton = page.getByRole('button', { name: 'button-group-primary' });

    // สรุปรายการใบนำส่งทั้งหมด — /th/dropoff/orders/:id/scan/all
    this.summaryTitle = page.getByRole('heading', { level: 4 }).filter({ hasText: 'สรุปรายการใบนำส่งทั้งหมด' });
    this.summaryRows = page.getByRole('grid').locator('[role=rowgroup] [role=row]');
    // รายการใบนำส่งรวม N ชิ้น, on both the summary and the scan page
    this.itemCount = page.getByRole('heading', { level: 5 }).filter({ hasText: /^\d+ ชิ้น$/ });
    this.summaryScroller = page.locator('.MuiDataGrid-virtualScroller');
    this.summarySearch = page.getByRole('textbox', { name: 'ค้นหา Barcode หรือ รหัสไปรษณีย์' });
    this.typeFilter = page.getByRole('combobox', { name: 'ประเภทบริการ' });
    this.rowsPerPage = page.getByRole('combobox', { name: /^Rows per page/ });
    this.deleteSelectedButton = page.getByRole('button', { name: 'ลบรายการที่เลือก' });
    this.deleteDialog = page.getByRole('dialog', { name: /^คุณต้องการยืนยันการลบรายการใบนำส่งนี้หรือไม่/ });
    this.editDialog = page.getByRole('dialog', { name: /^แก้ไขข้อมูลรายการใบนำส่ง/ });
    this.weightInput = this.editDialog.getByRole('spinbutton', { name: 'น้ำหนักต่อชิ้น (กรัม)' });
    // ยกเลิก on the summary and scan pages: nothing scanned, removed or edited there is kept
    this.cancelButton = page.getByRole('button', { name: 'button-group-secondary' });
    this.cancelDialog = page.getByRole('dialog', { name: /^คุณต้องการยืนยันการยกเลิกหรือไม่/ });
    this.receiveDialog = page.getByRole('dialog', { name: 'คุณต้องการยืนยันการนำรายการใบนำส่งเข้าสู่ระบบหรือไม่?' });
    this.toast = page.getByRole('alert').and(page.locator('.MuiAlert-root'));

    // สแกนทีละชิ้น — /th/dropoff/orders/:id/scan/individual; 13 characters import without Enter
    this.scanInput = page.getByRole('textbox', { name: 'สแกนทีละชิ้น' });
    this.scanTitle = page.getByRole('heading', { level: 4 }).filter({ hasText: /^สแกนทีละชิ้น : / });
    // A rejected scan: ไม่พบข้อมูล, รายการนี้เคยถูกสแกนไปแล้ว or รายการนี้ถูกรับฝากแล้ว, closed with ตกลง
    this.scanErrorDialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'ตกลง' }) });
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

  /** Receives the whole order ("ทั้งหมด") */
  async receiveAll() {
    await this.chooseReceiveAll();
    await this.primaryButton.click();
    await this.receiveDialog.getByRole('button', { name: 'ยืนยัน' }).click();
    await expect(this.toast).toHaveText('ส่งรายการเข้าสู่ระบบสำเร็จ');
  }

  /** Receives only these items ("สแกนทีละชิ้น"); the order stays กำลังรับฝาก until finishReceiving() */
  async receiveScanned(trackingNumbers) {
    await this.chooseScanEach();
    await this.scan(trackingNumbers);
    await this.primaryButton.click();
    await expect(this.receiveDialog).toContainText(`${trackingNumbers.length} ชิ้น`);
    await this.receiveDialog.getByRole('button', { name: 'ยืนยัน' }).click();
    await expect(this.toast).toHaveText('ส่งรายการเข้าสู่ระบบสำเร็จ');
  }

  /** สิ้นสุดการรับฝาก of a partly received order; the reason is required */
  async finishReceiving(reason, detail) {
    await this.finishButton.click();
    await this.reasonSelect.click();
    await this.page.getByRole('option', { name: reason, exact: true }).click();
    await this.reasonDetail.fill(detail);
    await this.finishDialog.getByRole('button', { name: 'ยืนยัน' }).click();
  }

  /** A row of the summary / scan page by its barcode */
  summaryRow(barcode) {
    return this.summaryRows.filter({ has: this.page.getByRole('gridcell', { name: barcode, exact: true }) });
  }

  /** The grid only renders the rows in view: scrolls down until the row is there, then returns it */
  async revealRow(barcode) {
    const row = this.summaryRow(barcode);
    await expect(async () => {
      if (await row.count()) return;
      await this.summaryScroller.evaluate((el) => {
        el.scrollTop = el.scrollTop + el.clientHeight >= el.scrollHeight ? 0 : el.scrollTop + el.clientHeight / 2;
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      expect(await row.count()).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });
    return row;
  }

  /** The row's ✎ (edit weight) and 🗑 (remove) icons */
  editButton(row) {
    return row.locator('[data-field] button').first();
  }

  deleteButton(row) {
    return row.locator('[data-field] button').last();
  }

  /** Saves a weight in the open edit dialog; a ยืนยัน right after typing is sometimes ignored, so it is clicked again */
  async saveWeight(weight) {
    await this.weightInput.fill(weight);
    await expect(this.weightInput).toHaveValue(weight);
    await expect(async () => {
      await this.editDialog.getByRole('button', { name: 'ยืนยัน' }).click();
      await expect(this.editDialog).toBeHidden({ timeout: 2000 });
    }).toPass({ timeout: 10000 });
  }

  /** 50 rows a page, the most, which fits every order the tests create */
  async showAllRows() {
    await this.rowsPerPage.click();
    await this.page.getByRole('option', { name: '50', exact: true }).click();
  }

  /** [barcode, postal code, type, weight] of every listed item, read while scrolling down */
  async summaryValues() {
    const rows = new Map();
    const { height, view } = await this.summaryScroller.evaluate((el) => ({ height: el.scrollHeight, view: el.clientHeight }));
    for (let y = 0; y < height; y += Math.max(view - 50, 100)) {
      await this.summaryScroller.evaluate((el, top) => {
        el.scrollTop = top;
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, y);
      const cells = await this.summaryRows.evaluateAll((all) => all.map((r) => [r.dataset.id,
        [...r.querySelectorAll('[role=gridcell]')].slice(1, 5).map((c) => c.innerText.trim())]));
      for (const [id, values] of cells) rows.set(id, values);
    }
    await this.summaryScroller.evaluate((el) => { el.scrollTop = 0; });
    return [...rows.values()];
  }

  /** ยกเลิก → ยืนยัน; back on รายการใบนำส่ง */
  async cancelReceiving() {
    await this.cancelButton.click();
    await this.cancelDialog.getByRole('button', { name: 'ยืนยัน' }).click();
    await this.page.waitForURL(/dropoff\/orders$/);
  }

  async download(button) {
    const [download] = await Promise.all([this.page.waitForEvent('download'), button.click()]);
    return download;
  }
}

module.exports = { DropOffOrderDetailPage };
