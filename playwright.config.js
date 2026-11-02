// @ts-check
/**
 * Run tests with a specific environment:
 *   npm run test:dev   (or ENV=dev npx playwright test)
 */
const { defineConfig, devices } = require('@playwright/test');

const { env } = require('./config/environments');
const { USER_STATE } = require('./config/auth');

// Specs that need future items already paid; they run after tests/eod.setup.js has uploaded the EOD file
const EOD_SPECS = [/payment-reconcile\.spec\.js/];

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    // Trailing slash keeps the /th prefix; use relative paths without a leading slash, e.g. goto('log-in')
    baseURL: `${env.baseURL}/`,
    navigationTimeout: env.timeout,
    // The portal works in Bangkok time ("today" in date pickers), also when CI runs in UTC
    timezoneId: 'Asia/Bangkok',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // API tests need no browser, so they run once in their own project.
    // Not parallel: dev API's DB pool is only 3 connections and returns 500 under concurrent load.
    { name: 'api', testMatch: /tests[\\/]api[\\/].*\.spec\.js/, fullyParallel: false },
    // Logs in once; UI projects start already logged in as the DLT user
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    // Uploads one EOD file for every spec in EOD_SPECS and waits for the 5-minute reconcile job
    {
      name: 'eod-setup',
      testMatch: /eod\.setup\.js/,
      dependencies: ['setup'],
      timeout: 10 * 60 * 1000,
      use: { ...devices['Desktop Chrome'], storageState: USER_STATE },
    },
    {
      name: 'chromium',
      testIgnore: [/tests[\\/]api[\\/]/, ...EOD_SPECS],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: USER_STATE },
    },
    // Opt-in (WEBKIT=1): covers Safari rendering on scheduled runs, not on every push/PR
    ...(process.env.WEBKIT
      ? [{
          name: 'webkit',
          testIgnore: [/tests[\\/]api[\\/]/, ...EOD_SPECS],
          dependencies: ['setup'],
          use: { ...devices['Desktop Safari'], storageState: USER_STATE },
        }]
      : []),
    {
      name: 'eod',
      testMatch: EOD_SPECS,
      dependencies: ['eod-setup'],
      use: { ...devices['Desktop Chrome'], storageState: USER_STATE },
    },
  ],
});
