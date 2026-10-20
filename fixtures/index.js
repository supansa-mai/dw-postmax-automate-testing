const base = require('@playwright/test');
const { BasePage } = require('../pages/BasePage');

// Register page objects here so tests get them as fixtures
const test = base.test.extend({
  basePage: async ({ page }, use) => {
    await use(new BasePage(page));
  },
});

module.exports = { test, expect: base.expect };
