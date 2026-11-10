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

  /** User Portal 'log-in', Drop Off 'dropoff-log-in' (same form) */
  async goto(path = 'log-in') {
    await super.goto(path);
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
  async loginAs(account, label, path = 'log-in') {
    expect(account.email && account.password, `${label} not set in .env`).toBeTruthy();
    // e.g. right after logout(); opening it again there sometimes timed out on dev
    if (!/log-in/.test(this.page.url())) await this.goto(path);
    await this.login(account);
    await expect(this.page).not.toHaveURL(/log-in/);
  }
}

module.exports = { LoginPage };
