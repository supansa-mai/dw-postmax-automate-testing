// @ts-check
/**
 * Run tests with a specific environment:
 *   npm run test:dev   (or ENV=dev npx playwright test)
 */
const { defineConfig, devices } = require('@playwright/test');

const { env } = require('./config/environments');

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
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // API tests need no browser, so they run once in their own project.
    // Not parallel: dev API's DB pool is only 3 connections and returns 500 under concurrent load.
    { name: 'api', testMatch: /tests[\\/]api[\\/].*\.spec\.js/, fullyParallel: false },
    { name: 'chromium', testIgnore: /tests[\\/]api[\\/]/, use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', testIgnore: /tests[\\/]api[\\/]/, use: { ...devices['Desktop Safari'] } },
  ],
});
