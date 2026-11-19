// A User Portal session next to the Drop Off page of a test, to see what the customer sees
const { test } = require('@playwright/test');
const { env } = require('../config/environments');
const { USER_STATE } = require('../config/auth');
const { DashboardPage } = require('../pages/DashboardPage');
const { OrdersPage } = require('../pages/OrdersPage');
const { OrderDetailPage } = require('../pages/OrderDetailPage');
const { OrderItemsPage } = require('../pages/OrderItemsPage');
const { OrderReportPage } = require('../pages/OrderReportPage');
const { PreloadPage } = require('../pages/PreloadPage');
const { ProfilePage } = require('../pages/ProfilePage');

/** `storageState` picks the user (DLT by default); VIDEO=1 records this window too and attaches it to the test */
async function openPortal(browser, storageState = USER_STATE) {
  const video = process.env.VIDEO ? { recordVideo: { dir: test.info().outputPath('portal') } } : {};
  const context = await browser.newContext({ storageState, baseURL: `${env.baseURL}/`, timezoneId: 'Asia/Bangkok', ...video });
  const page = await context.newPage();
  return {
    context,
    page,
    async close() {
      await context.close();
      if (page.video()) await test.info().attach('portal video', { path: await page.video().path(), contentType: 'video/webm' });
    },
    dashboardPage: new DashboardPage(page),
    ordersPage: new OrdersPage(page),
    orderDetailPage: new OrderDetailPage(page),
    orderItemsPage: new OrderItemsPage(page),
    orderReportPage: new OrderReportPage(page),
    preloadPage: new PreloadPage(page),
    profilePage: new ProfilePage(page),
  };
}

/**
 * Runs `body(user, portal)` as a step per user, each in a User Portal session of their own; later users still run
 * when an earlier one fails, and the first failure fails the test
 */
async function forUsers(browser, users, body) {
  const errors = [];
  for (const user of users) {
    try {
      await test.step(user.name, async () => {
        const portal = await openPortal(browser, user.state);
        try {
          await body(user, portal);
        } finally {
          await portal.close();
        }
      });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw errors[0];
}

module.exports = { openPortal, forUsers };
