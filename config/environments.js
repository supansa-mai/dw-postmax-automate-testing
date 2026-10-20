/**
 * Environment configuration (non-secret values, committed to git)
 * Usage: ENV=dev npx playwright test
 * Secrets (passwords, tokens) go in .env — see .env.example
 */
require('dotenv').config({ quiet: true });

const environments = {
  dev: {
    baseURL: 'https://dev.thaipostmax.datawow.io/th',
    timeout: 30000,
  },
  uat: {
    baseURL: 'https://uat.thaipostmax.datawow.io/th',
    timeout: 30000,
  },
  local: {
    baseURL: 'http://localhost:3000',
    timeout: 15000,
  },
};

const ENV_NAME = process.env.ENV || 'dev';

if (!environments[ENV_NAME]) {
  throw new Error(`Unknown environment: "${ENV_NAME}". Valid options: ${Object.keys(environments).join(', ')}`);
}

const env = environments[ENV_NAME];

module.exports = { env, ENV_NAME };
