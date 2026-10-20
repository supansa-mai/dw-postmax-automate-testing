const { test, expect } = require('../fixtures');

test('home page redirects to log-in', async ({ basePage, page }) => {
  await basePage.goto();
  await expect(page).toHaveURL(/\/th\/log-in/);
});
