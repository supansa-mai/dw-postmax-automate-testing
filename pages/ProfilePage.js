const { BasePage } = require('./BasePage');

/** ตั้งค่าโปรไฟล์ — /th/profile */
class ProfilePage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.title = page.getByRole('heading', { name: 'ตั้งค่าโปรไฟล์', level: 4 });
  }

  async goto() {
    await super.goto('profile');
  }

  /** Here the label and its value are sibling paragraphs */
  field(label) {
    return this.page.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]');
  }

  /** ข้อมูลผู้ใช้งาน as shown under รายละเอียดผู้ฝากส่ง of an order */
  async sender() {
    return {
      name: await this.field('ชื่อ-นามสกุล/ชื่อนิติบุคคล').innerText(),
      contactName: await this.field('ชื่อ-นามสกุล ผู้ติดต่อ').innerText(),
      email: await this.field('อีเมล').innerText(),
      phone: await this.field('หมายเลขโทรศัพท์').innerText(),
    };
  }
}

module.exports = { ProfilePage };
