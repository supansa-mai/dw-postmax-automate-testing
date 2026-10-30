class BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    // Top menu of the User Portal; the logo link has no text
    this.menuLinks = page.getByRole('banner').getByRole('link').filter({ hasText: /\S/ });
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
