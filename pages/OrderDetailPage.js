const { BasePage } = require('./BasePage');

/** รายละเอียดใบนำส่ง — /th/orders/:id */
class OrderDetailPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.title = page.getByRole('heading', { level: 4 });
    this.breadcrumbs = page.getByRole('navigation').getByRole('listitem');

    this.csvButton = page.getByRole('button', { name: 'ข้อมูลการฝากส่งพร้อมหมายเลขติดตาม (CSV)' });
    this.deliveryNoteButton = page.getByRole('button', { name: 'ใบนำส่ง (PDF)' });
    this.labelButton = page.getByRole('button', { name: 'เอกสารจ่าหน้าซองสำหรับแปะพัสดุ (PDF)' });

    // บริการที่เลือกใช้: one row per weight, then the รวมทั้งหมด row
    this.serviceTable = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'ประเภทบริการ' }) });

    // รายละเอียดการนำส่งและจัดส่ง, shown once the order is received at drop off
    this.deliverySection = page.getByText('รายละเอียดการนำส่งและจัดส่ง', { exact: true });
    this.deliveryCsvButton = page.getByRole('button', { name: 'รายละเอียดการจัดส่งทั้งหมด (CSV)' });
    this.itemsButton = page.getByRole('button', { name: 'ดูรายละเอียด' });
    // Items per delivery status: รับฝากสำเร็จ, กำลังจัดส่ง, ส่งสำเร็จ, ส่งไม่สำเร็จ
    this.deliveryTable = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'รับฝากแล้ว (ชิ้น)' }) });
  }

  /** The label button opens a list of envelope sizes: "C6" or "DL" */
  envelope(size) {
    return this.page.getByRole('button', { name: new RegExp(`^ซอง ${size} `) });
  }

  async download(button) {
    const [download] = await Promise.all([this.page.waitForEvent('download'), button.click()]);
    return download;
  }
}

module.exports = { OrderDetailPage };
