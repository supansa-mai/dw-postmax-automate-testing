// @ts-check
/**
 * Run tests with a specific environment:
 *   npm run test:dev   (or ENV=dev npx playwright test)
 */
const { defineConfig, devices } = require('@playwright/test');

const { env } = require('./config/environments');
const { USER_STATE } = require('./config/auth');

// Specs that need future items already paid; they run after tests/eod.setup.js has uploaded the EOD file
const EOD_SPECS = [/payment-reconcile\.spec\.js/, /create-order-future-items\.spec\.js/, /orders-future-items\.spec\.js/,
  /dlt-orders\.spec\.js/];
// Specs that upload EOD files of their own, one job round (5 minutes) each; opt-in with EOD_FILES=1 (npm run test:eod-files)
const EOD_FILE_SPECS = [/payment-reconcile-files\.spec\.js/];

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Every env shares one backend and DB connection pool, so keep concurrency low; override with WORKERS=n
  workers: process.env.CI ? 1 : Number(process.env.WORKERS) || 2,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    // Trailing slash keeps the /th prefix; use relative paths without a leading slash, e.g. goto('log-in')
    baseURL: `${env.baseURL}/`,
    navigationTimeout: env.timeout,
    // The portal works in Bangkok time ("today" in date pickers), also when CI runs in UTC
    timezoneId: 'Asia/Bangkok',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // VIDEO=1 records every test, slowed down so it can be followed (SLOWMO=ms to change, 0 to turn off)
    video: process.env.VIDEO ? 'on' : 'retain-on-failure',
    launchOptions: { slowMo: Number(process.env.SLOWMO ?? (process.env.VIDEO ? 500 : 0)) },
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
      testIgnore: [/tests[\\/]api[\\/]/, ...EOD_SPECS, ...EOD_FILE_SPECS],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: USER_STATE },
    },
    // Opt-in (WEBKIT=1): covers Safari rendering on scheduled runs, not on every push/PR
    ...(process.env.WEBKIT
      ? [{
          name: 'webkit',
          testIgnore: [/tests[\\/]api[\\/]/, ...EOD_SPECS, ...EOD_FILE_SPECS],
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
    // Not with eod-setup in the same run: the job only reads the latest file, so their uploads would replace each other
    ...(process.env.EOD_FILES
      ? [{
          name: 'eod-files',
          testMatch: EOD_FILE_SPECS,
          dependencies: ['setup'],
          use: { ...devices['Desktop Chrome'], storageState: USER_STATE },
        }]
      : []),
  ],
});
