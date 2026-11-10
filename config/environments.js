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
    // company_dlt_mappings (CPM-1820): the company code written in the EOD file header and how many digits of
    // reference 1 (from the 1st) are the refCode; dlt = the company of DLT_USER_EMAIL / DLT_HUID, dltB = DLT_B_*
    eodCompanies: {
      dlt: { companyCode: '27744', refDigits: 10 },
      dltB: { companyCode: '27743', refDigits: 9 },
    },
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
    email: process.env[`${prefix}_DLT_USER_EMAIL`],
    password: process.env[`${prefix}_DLT_USER_PASSWORD`],
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
  // Drop Off staff of the branch the DLT company hands its orders in at (SCENARIO 10)
  dropOffUser: {
    email: process.env[`${prefix}_DROPOFF_USER_EMAIL`],
    password: process.env[`${prefix}_DROPOFF_USER_PASSWORD`],
  },
  dlt: dltCredentialsOf(ENV_NAME),
  // Optional second DLT company (company B): checks that each company sees only its own items (TS01-TC04)
  dltB: {
    user: {
      email: process.env[`${prefix}_DLT_B_USER_EMAIL`],
      password: process.env[`${prefix}_DLT_B_USER_PASSWORD`],
    },
    huid: process.env[`${prefix}_DLT_B_HUID`],
    secretKey: process.env[`${prefix}_DLT_B_SECRET_KEY`],
  },
  // S3 folder of the bank EOD files read by the payment reconcile job (tests/user-portal/dlt/payment-reconcile.spec.js)
  eod: {
    region: process.env[`${prefix}_EOD_S3_REGION`],
    bucket: process.env[`${prefix}_EOD_S3_BUCKET`],
    prefix: process.env[`${prefix}_EOD_S3_PREFIX`],
    accessKeyId: process.env[`${prefix}_EOD_S3_ACCESS_KEY_ID`],
    secretAccessKey: process.env[`${prefix}_EOD_S3_SECRET_ACCESS_KEY`],
    // Company (biller) account written in every record of the file
    companyAccount: process.env[`${prefix}_EOD_COMPANY_ACCOUNT`],
  },
  otherEnvDlt: otherEnvName && { envName: otherEnvName, ...dltCredentialsOf(otherEnvName) },
  // Public API credential of a non-DLT customer (e.g. preloads), used for negative tests
  nonDlt: {
    huid: process.env[`${prefix}_NON_DLT_HUID`],
    secretKey: process.env[`${prefix}_NON_DLT_SECRET_KEY`],
  },
};

module.exports = { env, ENV_NAME };
