const { expect } = require('@playwright/test');
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

  /**
   * Logs in and waits to leave the login page; fails with `label` (the .env keys) when the account is not set.
   * For another account than the saved session, use it with an empty storageState
   */
  async loginAs(account, label) {
    expect(account.email && account.password, `${label} not set in .env`).toBeTruthy();
    await this.goto();
    await this.login(account);
    await expect(this.page).not.toHaveURL(/log-in/);
  }
}

module.exports = { LoginPage };
