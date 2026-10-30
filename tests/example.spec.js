const { test, expect } = require('../fixtures');

// Logged-out visitor, not the saved session from auth.setup.js
test.use({ storageState: { cookies: [], origins: [] } });

test('home page redirects to log-in', async ({ basePage, page }) => {
  await basePage.goto();
  await expect(page).toHaveURL(/\/th\/log-in/);
});
