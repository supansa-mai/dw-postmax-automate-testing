# dw-postmax-automate-testing

E2E automation tests for PostMax using [Playwright](https://playwright.dev) (JavaScript).

## Setup

```bash
npm install
npx playwright install chromium webkit
cp .env.example .env   # fill in secrets (credentials)
```

## Run

| Command | Description |
| --- | --- |
| `npm test` | Run all tests on Chromium + API (headless) |
| `npm run test:dev` / `test:uat` / `test:local` | Run against a specific environment |
| `npm run test:api` | Run API tests only (no browser) |
| `npm run test:chromium` / `test:webkit` | Run on a single browser |
| `npm run test:all-browsers` | Run on Chromium and WebKit |
| `npm run test:headed` | Run with browser visible |
| `npm run test:ui` | Playwright UI mode |
| `npm run test:debug` | Step-through debugger |
| `npm run report` | Open the last HTML report |
| `npm run codegen -- <url>` | Record a test by clicking through the app |

## Environments

URLs and per-env settings live in `config/environments.js` (committed). Pick one with `ENV`
(default `dev`): `npm run test:uat` or `npx cross-env ENV=uat playwright test`.
Add a new env by adding a key to that file.

Secrets (credentials, tokens) go in `.env` (git-ignored; copy from `.env.example`).
Prefix keys with the env name when values differ per env, e.g. `DEV_USER_PASSWORD`.

Combine with other flags: `npm run test:dev -- --project=chromium --headed`

In CI, push/PR runs use `dev` on Chromium only; pick another env (or tick **Also run on WebKit**) via
**Actions → Playwright Tests → Run workflow**. A nightly scheduled run covers Chromium and WebKit.
Add any secrets the tests need as repo secrets and map them in the workflow's `env:` block.

## UI tests

UI projects (`chromium`, and `webkit` when `WEBKIT=1`) depend on the `setup` project (`tests/auth.setup.js`), which logs in to the
User Portal once with `USER_EMAIL` / `USER_PASSWORD` of the env (a DLT company account without 2FA) and saves the
session to `playwright/.auth/user.json`. Without those credentials the setup fails, so the UI tests do not run. Specs start already logged in; use
`test.use({ storageState: { cookies: [], origins: [] } })` for logged-out tests.

## API tests

API specs live in `tests/api/` and run in the `api` project (once, no browser). The Public API uses HMAC auth;
put the DLT key pair of each env in `.env` (`DEV_DLT_HUID`, `DEV_DLT_SECRET_KEY`, ...). Without it those tests fail; cases that need optional extra keys (`*_NON_DLT_*`, another env's DLT key) are skipped instead.
Automation refCodes start with `9` so they never clash with manual QA data.

## Structure

```
config/     Environment settings (environments.js)
helpers/    API clients, HMAC signing, test data builders
pages/      Page Objects (extend BasePage)
fixtures/   Custom test fixtures that inject page objects
tests/      UI specs (*.spec.js), auth.setup.js
tests/api/  API specs
```

## Naming convention

| ประเภท | รูปแบบ | ตัวอย่าง |
|---|---|---|
| Page Object | PascalCase + Page | `LoginPage.js` |
| Test file (File name > tescases, modules) | kebab-case + .spec | `001-login.spec.js` |
| Variable > Scalar, Object, arrow function | `camelCase` | `const foo = 'bar';`, `const isTrue = true`, `const isOdd = (n) => { return n%2 === 1;}` |
| Variable > Array | make it plural | `const users = ['a','b','c']` |
| class, namespace, interface, type | `PasCalCase` | `class UserManager`, `namespace UserService` |
| Tes suite | `#method` and `path of endpoint` | `#POST /api/v1/member` |
| Commit message | verb + สิ่งที่ทำ | `add login flow e2e test` |
| Branch Name | feature/feature-name | `feature/register-supporter` |
| Branch Name with fixed | fix/feature/feature-name | `fix/feature/member-create-member` |
