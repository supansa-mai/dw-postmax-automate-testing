// Logs in to the User Portal once and saves the session; UI projects reuse it via storageState
const fs = require('fs');
const path = require('path');
const { test, expect } = require('../fixtures');
const { env } = require('../config/environments');
const { USER_STATE } = require('../config/auth');

test('log in to User Portal', async ({ loginPage, page }) => {
  if (!env.user.email || !env.user.password) {
    // Write an empty session so UI projects still start; tests that need login skip themselves
    fs.mkdirSync(path.dirname(USER_STATE), { recursive: true });
    fs.writeFileSync(USER_STATE, JSON.stringify({ cookies: [], origins: [] }));
    test.skip(true, 'USER_EMAIL / USER_PASSWORD not set in .env');
  }

  await loginPage.goto();
  await loginPage.login(env.user);
  await expect(page).not.toHaveURL(/log-in/);
  await page.context().storageState({ path: USER_STATE });
});
