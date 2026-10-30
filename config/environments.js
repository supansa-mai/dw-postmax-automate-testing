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
function dltCredentialsOf(envName) {
  const p = envName.toUpperCase();
  return { huid: process.env[`${p}_DLT_HUID`], secretKey: process.env[`${p}_DLT_SECRET_KEY`] };
}

// First other env that has a DLT key pair, used to check keys don't work across environments
const otherEnvName = Object.keys(environments).find((name) => {
  const creds = dltCredentialsOf(name);
  return name !== ENV_NAME && creds.huid && creds.secretKey;
});

const env = {
  ...environments[ENV_NAME],
  // User Portal account of a DLT company (is_dlt), used by UI tests via tests/auth.setup.js
  user: {
    email: process.env[`${prefix}_USER_EMAIL`],
    password: process.env[`${prefix}_USER_PASSWORD`],
  },
  // User Portal accounts without is_dlt, for the menu access checks (SCENARIO 1)
  normalUser: {
    email: process.env[`${prefix}_NORMAL_USER_EMAIL`],
    password: process.env[`${prefix}_NORMAL_USER_PASSWORD`],
  },
  tsdUser: {
    email: process.env[`${prefix}_TSD_USER_EMAIL`],
    password: process.env[`${prefix}_TSD_USER_PASSWORD`],
  },
  dlt: dltCredentialsOf(ENV_NAME),
  otherEnvDlt: otherEnvName && { envName: otherEnvName, ...dltCredentialsOf(otherEnvName) },
  // Public API credential of a non-DLT customer (e.g. preloads), used for negative tests
  nonDlt: {
    huid: process.env[`${prefix}_NON_DLT_HUID`],
    secretKey: process.env[`${prefix}_NON_DLT_SECRET_KEY`],
  },
};

module.exports = { env, ENV_NAME };
