class BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    // Top menu of the User Portal; the logo link has no text
    this.menuLinks = page.getByRole('banner').getByRole('link').filter({ hasText: /\S/ });

    // Shown in place of a page the user's company flag (DLT / TSD) does not allow, e.g. opened by URL
    this.accessDeniedTitle = page.getByText('ไม่สามารถเข้าถึงหน้านี้ได้', { exact: true });
    this.accessDeniedMessage = page.getByText('เนื้อหาที่คุณต้องการอาจถูกย้าย ลบออก หรือจำกัดสิทธิ์การเข้าถึง');
    this.backToHomeButton = page.getByRole('button', { name: 'กลับสู่หน้าหลัก' })
      .or(page.getByRole('link', { name: 'กลับสู่หน้าหลัก' }));
  }

  async goto(path = '') {
    await this.page.goto(path);
  }

  menuLink(name) {
    return this.menuLinks.filter({ hasText: name });
  }

  /** The menu item of the current page is shown in bold */
  menuLabel(name) {
    return this.menuLink(name).locator('p');
  }
}

module.exports = { BasePage };
