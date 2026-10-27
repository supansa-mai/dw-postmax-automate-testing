const base = require('@playwright/test');
const { BasePage } = require('../pages/BasePage');
const { FutureItemsApi } = require('../helpers/futureItemsApi');
const { env } = require('../config/environments');

// Register page objects here so tests get them as fixtures
const test = base.test.extend({
  basePage: async ({ page }, use) => {
    await use(new BasePage(page));
  },
  futureItemsApi: async ({ request }, use) => {
    await use(new FutureItemsApi(request, env));
  },
});

module.exports = { test, expect: base.expect };
