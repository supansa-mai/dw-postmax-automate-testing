// Logs in to the User Portal once and saves the session; UI projects reuse it via storageState
const { test, expect } = require('../fixtures');
const { env } = require('../config/environments');
const { USER_STATE } = require('../config/auth');

test('log in to User Portal', async ({ loginPage, page }) => {
  // Fail instead of skipping, so a run without credentials is not mistaken for a passing one
  expect(env.user.email && env.user.password, 'USER_EMAIL / USER_PASSWORD not set in .env').toBeTruthy();

  await loginPage.goto();
  await loginPage.login(env.user);
  await expect(page).not.toHaveURL(/log-in/);
  await page.context().storageState({ path: USER_STATE });
});
