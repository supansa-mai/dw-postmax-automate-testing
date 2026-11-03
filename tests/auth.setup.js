// Logs in to the User Portal once and saves the session; UI projects reuse it via storageState
const { test } = require('../fixtures');
const { env } = require('../config/environments');
const { USER_STATE } = require('../config/auth');

test('log in to User Portal', async ({ loginPage, page }) => {
  // Fails instead of skipping, so a run without credentials is not mistaken for a passing one
  await loginPage.loginAs(env.user, 'USER_EMAIL / USER_PASSWORD');
  await page.context().storageState({ path: USER_STATE });
});
