/**
 * Environment configuration (non-secret values, committed to git)
 * Usage: ENV=dev npx playwright test
 * Secrets (passwords, tokens) go in .env — see .env.example
 */
require('dotenv').config({ quiet: true });

const environments = {
  dev: {
    baseURL: 'https://dev.thaipostmax.datawow.io/th',
    apiURL: 'https://api-dev.thaipostmax.datawow.io',
    timeout: 30000,
  },
  uat: {
    baseURL: 'https://uat.thaipostmax.datawow.io/th',
    apiURL: 'https://api-uat.thaipostmax.datawow.io',
    timeout: 30000,
  },
  local: {
    baseURL: 'http://localhost:3000',
    apiURL: 'http://localhost:8080',
    timeout: 15000,
  },
};

const ENV_NAME = process.env.ENV || 'dev';

if (!environments[ENV_NAME]) {
  throw new Error(`Unknown environment: "${ENV_NAME}". Valid options: ${Object.keys(environments).join(', ')}`);
}

const prefix = ENV_NAME.toUpperCase();

// Secrets per env from .env, e.g. DEV_DLT_HUID / DEV_DLT_SECRET_KEY
const env = {
  ...environments[ENV_NAME],
  dlt: {
    huid: process.env[`${prefix}_DLT_HUID`],
    secretKey: process.env[`${prefix}_DLT_SECRET_KEY`],
  },
  // Public API credential of a non-DLT customer (e.g. preloads), used for negative tests
  nonDlt: {
    huid: process.env[`${prefix}_NON_DLT_HUID`],
    secretKey: process.env[`${prefix}_NON_DLT_SECRET_KEY`],
  },
};

module.exports = { env, ENV_NAME };
