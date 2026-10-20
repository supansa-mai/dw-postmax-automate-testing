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
| `npm run test:chromium` / `test:webkit` | Run on a single browser |
| `npm run test:headed` | Run with browser visible |
| `npm run test:ui` | Playwright UI mode |
| `npm run test:debug` | Step-through debugger |
| `npm run report` | Open the last HTML report |
| `npm run codegen -- <url>` | Record a test by clicking through the app |

## Environments

URLs and per-env settings live in `config/environments.js` (committed). Pick one with `ENV`
(default `uat`): `npm run test:dev` or `npx cross-env ENV=dev playwright test`.
Add a new env by adding a key to that file.

Secrets (credentials, tokens) go in `.env` (git-ignored; copy from `.env.example`).
Prefix keys with the env name when values differ per env, e.g. `DEV_USER_PASSWORD`.

Combine with other flags: `npm run test:dev -- --project=webkit --headed`

In CI, push/PR runs use `uat`; pick another via **Actions → Playwright Tests → Run workflow**.
Add any secrets the tests need as repo secrets and map them in the workflow's `env:` block.

## Structure

```
config/     Environment settings (environments.js)
pages/      Page Objects (extend BasePage)
fixtures/   Custom test fixtures that inject page objects
tests/      Test specs (*.spec.js)
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
