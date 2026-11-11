// Logs in to the User Portal once and saves the session; UI projects reuse it via storageState
const { test } = require('../fixtures');
const { env } = require('../config/environments');
const { USER_STATE, DROPOFF_STATE, NORMAL_STATE, TSD_STATE, ADMIN_STATE } = require('../config/auth');

test('log in to User Portal', async ({ loginPage, page }) => {
  // Fails instead of skipping, so a run without credentials is not mistaken for a passing one
  await loginPage.loginAs(env.user, 'DLT_USER_EMAIL / DLT_USER_PASSWORD');
  await page.context().storageState({ path: USER_STATE });
});

test('log in to Drop Off', async ({ loginPage, page }) => {
  await loginPage.loginAs(env.dropOffUser, 'DROPOFF_USER_EMAIL / DROPOFF_USER_PASSWORD', 'dropoff-log-in');
  await page.context().storageState({ path: DROPOFF_STATE });
});

test('log in to User Portal as the normal user', async ({ loginPage, page }) => {
  await loginPage.loginAs(env.normalUser, 'NORMAL_USER_EMAIL / NORMAL_USER_PASSWORD');
  await page.context().storageState({ path: NORMAL_STATE });
});

test('log in to User Portal as the TSD user', async ({ loginPage, page }) => {
  await loginPage.loginAs(env.tsdUser, 'TSD_USER_EMAIL / TSD_USER_PASSWORD');
  await page.context().storageState({ path: TSD_STATE });
});

test('log in to Back Office', async ({ loginPage, page }) => {
  await loginPage.loginAs(env.admin, 'ADMIN_EMAIL / ADMIN_PASSWORD', 'backoffice-log-in');
  await page.context().storageState({ path: ADMIN_STATE });
});
