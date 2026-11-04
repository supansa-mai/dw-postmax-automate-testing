const base = require('@playwright/test');
const { BasePage } = require('../pages/BasePage');
const { LoginPage } = require('../pages/LoginPage');
const { FutureItemsPage } = require('../pages/FutureItemsPage');
const { CreateFutureItemPage } = require('../pages/CreateFutureItemPage');
const { OrdersPage } = require('../pages/OrdersPage');
const { FutureItemsApi } = require('../helpers/futureItemsApi');
const { env } = require('../config/environments');

// Register page objects here so tests get them as fixtures
const test = base.test.extend({
  basePage: async ({ page }, use) => {
    await use(new BasePage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  futureItemsPage: async ({ page }, use) => {
    await use(new FutureItemsPage(page));
  },
  createFutureItemPage: async ({ page }, use) => {
    await use(new CreateFutureItemPage(page));
  },
  ordersPage: async ({ page }, use) => {
    await use(new OrdersPage(page));
  },
  futureItemsApi: async ({ request }, use) => {
    await use(new FutureItemsApi(request, env));
  },
});

module.exports = { test, expect: base.expect };
