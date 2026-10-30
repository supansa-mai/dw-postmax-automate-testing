const { BasePage } = require('./BasePage');

class LoginPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.emailInput = page.getByLabel('อีเมล');
    this.passwordInput = page.getByLabel('รหัสผ่าน');
    this.submitButton = page.getByRole('button', { name: 'เข้าสู่ระบบ' });
  }

  async goto() {
    await super.goto('log-in');
  }

  async login({ email, password }) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}

module.exports = { LoginPage };
