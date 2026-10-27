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
| `npm test` | Run all tests (headless) |
| `npm run test:dev` / `test:uat` / `test:local` | Run against a specific environment |
| `npm run test:api` | Run API tests only (no browser) |
| `npm run test:chromium` / `test:webkit` | Run on a single browser |
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

Combine with other flags: `npm run test:dev -- --project=webkit --headed`

In CI, push/PR runs use `dev`; pick another via **Actions → Playwright Tests → Run workflow**.
Add any secrets the tests need as repo secrets and map them in the workflow's `env:` block.

## API tests

API specs live in `tests/api/` and run in the `api` project (once, no browser). The Public API uses HMAC auth;
put the DLT key pair of each env in `.env` (`DEV_DLT_HUID`, `DEV_DLT_SECRET_KEY`, ...). Without it those tests are skipped.
Automation refCodes start with `9` so they never clash with manual QA data.

## Structure

```
config/     Environment settings (environments.js)
helpers/    API clients, HMAC signing, test data builders
pages/      Page Objects (extend BasePage)
fixtures/   Custom test fixtures that inject page objects
tests/      UI specs (*.spec.js)
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
