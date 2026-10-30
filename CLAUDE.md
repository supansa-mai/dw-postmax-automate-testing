# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ตอบผู้ใช้เป็นภาษาไทย (technical terms, file names and code stay in English).

Playwright (JavaScript, CommonJS) automation tests for PostMax: UI E2E tests and Public API tests. There is no build or lint step.

## Commands

```bash
npm install && npx playwright install chromium webkit
cp .env.example .env                 # fill in secrets

npm test                             # api + chromium, ENV=dev (webkit only with WEBKIT=1: test:webkit / test:all-browsers)
npm run test:uat                     # target env: test:dev / test:uat / test:local
npm run test:api                     # API project only (no browser)
npx playwright test tests/api/create-future-items.spec.js -g "TS02-TC07"   # single file / test by title
npm run test:uat -- --project=api -g "rate limit"                          # combine env + flags
npm run report                       # open last HTML report
```

## Architecture

- **Environment selection**: `config/environments.js` is the only place URLs live (`baseURL` for UI, `apiURL` for API). `ENV` picks the env (default `dev`). Secrets come from `.env` with an env-name prefix (`DEV_DLT_HUID`, `UAT_DLT_SECRET_KEY`, ...), and are exposed on the exported `env` object (`env.dlt`, `env.nonDlt`). A new secret means: add it to `.env.example`, read it in `environments.js`, and map it in `.github/workflows/playwright.yml` `env:` for CI.
- **Playwright projects** (`playwright.config.js`): `api` runs only `tests/api/**` once with no browser; `chromium` runs everything else; `webkit` is opt-in via `WEBKIT=1` (nightly CI and `npm run test:webkit`). `baseURL` keeps the `/th` prefix via a trailing slash, so UI navigation uses relative paths without a leading slash (`goto('log-in')`).
- **Fixtures** (`fixtures/index.js`): specs import `{ test, expect }` from `../../fixtures`, not from `@playwright/test`. Page objects (extending `pages/BasePage.js`) and API clients (`helpers/*Api.js`) are registered there and injected as fixtures, e.g. `futureItemsApi`.
- **Public API auth** (`helpers/hmac.js`): `x-signature = hex(HMAC-SHA256(base64-decode(secretKey), METHOD + unixTimestamp))` with `x-huid` / `x-timestamp` headers. API clients sign by default; pass `{ headers }` to `create()` to fully override (negative auth tests).
- **Test data** (`helpers/testData.js`, `helpers/futureItemsApi.js`): random Thai names, phones, real postal codes, etc. Automation `refCode`s are 9 digits starting with `9` (manual QA data uses `61000xxxx`) and `batchRef`s start with `AUTO_`, so runs never collide with each other or with manual data. Always generate them with `uniqueRefCodes()` / `uniqueBatchRef()`.

## Writing API specs

Follow `tests/api/create-future-items.spec.js`:
- File header lists the endpoint, API doc version, test-case sheet/scenario, and Jira tickets.
- `test.describe` blocks are named after the test-case IDs in the QA sheet (`TS02-TC03 ...`).
- Credential-dependent suites `test.skip()` when the `.env` secrets are missing instead of failing.
- Cases that are On Hold use `test.fixme('... (On Hold, <ticket>)', async () => {})` so they stay visible in the report.
- For rejected requests, prove nothing was persisted by re-sending the same refCodes and asserting they are created fresh (`expectNotCreated` pattern).

## Project context: PostMax

PostMax is Thai Post's bulk-shipping platform: a company prepares shipments ("ใบนำส่ง", order number `PM...`, each with order items that have a 13-char Thai Post tracking number like `RD621692952TH`), hands parcels in at a drop-off branch, then pays via payment/settlement summaries. Backend is NestJS (zod validation, errors as `{ success: false, key, error: { fields } }`).

Three applications, all under `https://{dev|uat}.thaipostmax.datawow.io/th` (Jira epics in parentheses):
- **User Portal** (CPM-1), login `log-in`: home, เตรียมการฝากส่ง (Preload — upload CSV of order items), การฝากส่งของฉัน (Order Management + order item detail), รายงานการฝากส่ง (Order Report), ใบสรุปยอด (Payment Summary; TSD users see Settlement Summary instead), รายงานข้อมูล (Dashboard: overview / items / delivery rate / TSD-only service fee), User Profile, 2FA.
- **Drop Off System** (CPM-2), login `dropoff-log-in`: branch staff receive shipments — order list, scan whole order or item by item, create payment summary and settlement summary, profile, 2FA.
- **Back Office** (CPM-3), login `backoffice-log-in`: admins manage orders/items (TSD and non-TSD), payment and settlement summaries, drop-off branches, companies, users of all three apps (incl. inactive/active/unblock, 2FA device reset), and master data: e-AR fee, Thai Post domestic fee, PostMax fee, country zones, international fee, rural areas; plus dashboards (cumulative, overview, items, delivery rate, service fee).

Customer types are company-level DB flags that change menus and behaviour:
- **Normal (non-TSD)** user.
- **TSD** (`is_tsd`): its own preload template, Settlement Summary instead of Payment Summary, extra report columns, and TSD-only defaults (many CR/TSD-xx tickets).
- **DLT** (`is_dlt`): the carrier customer with the Future Items feature (below).

Public API (HMAC, see `helpers/hmac.js`): `POST /v1/public/preloads` (multipart CSV preload; failures become a preload with status "สร้างไม่สำเร็จ" and a "Preload Failure" email listing each error), `POST /v1/public/test-preloads`, `GET /v1/public/settlements/{orderNumber}` (`orderNotFound` / `settlementNotFound`), and DLT's `POST /v1/frontend/future-items`. Jira for the public API: CPM-818.

Sources (spreadsheet "[PostMax] Test Case", id `19QQ2ytMNCAmVOADmUhC2ugXfmpEVyi4xGlLxdENVDXI`):
- `Index` tab: every module and scenario with pass/fail counts — TS_01 User Portal, TS_02 DropOff System, TS_03 Back Office, TS_04 User Portal [TSD], TS_05 User Portal [DLT].
- Test case tabs: `User Portal_main`, `User Portal_TSD`, `User Portal_DLT`, `DropOff System_main`, `BackOffice_main`, `public-api`. The `(old)` tabs and `Drop Off System` are earlier versions; `Template V.3` is the blank template; `UAT Issue log` tracks UAT bugs.
- `User Access` tab: test accounts per role and env (User, TSD, DLT, DLT Automate, Drop-Off, Admin), plus links to the Public API docs, service codes, and the Preload CSV data dictionary. Read accounts from there or `.env`; never copy passwords into the repo.
- Jira project `CPM` on dwj.atlassian.net (board 153). Tickets are prefixed by area, e.g. `[CR-xx]`, `[TSD-xx]`, `[2FA]`, `[Performance]`, `[DLT]`, `[Future Item]`; sub-tasks by role `[Design]` / `[Dev-FE]` / `[Dev-BE]` / `[QA]`.
- Figma file "PostMax - User portal" (`4rVEiyqKySfrUgpVWK6CAh`), one page per area: Preload System, Order Management, Payment Summary, User Profile, Future Items (DLT).

### DLT Future Items (current work)

"รายการพัสดุล่วงหน้า (DLT)" is only visible to users whose company has `is_dlt`.

End-to-end flow:
1. **DLT (carrier) pushes future items** via the Public API `POST /v1/frontend/future-items` (HMAC). Each item gets a tracking number (`XX123456789TH`), status `PENDING`, and `paymentStatus`. Duplicates are checked by `refCode` only (`batchRef` may repeat).
2. **Payment reconcile**: a batch job reads the bank EOD file, matches `refCode`, and flips the item to paid.
3. **List page** `/th/future-items` ("รายการพัสดุล่วงหน้า (DLT)"): date range is required before data loads (~5,000–10,000 items/day). It has summary cards, filter/search/sort/pagination, and cancel.
4. **Create shipment** ("สร้างใบนำส่ง"): the user scans or types tracking numbers. Each scan is validated (Figma: "Tracking No. matched w/ Database?" → "Valid Tracking Number?" → "No Deleted Items?"). Per the sheet, a scan is rejected when the tracking number is not found, unpaid, already in a shipment, or cancelled. Scanned items are kept in localStorage (TTL 1 day). Items can be removed, then the user confirms "สร้างใบนำส่ง?". On success they land on "การฝากส่งของฉัน" with a success toast, and the reference number shows the static wording "จากรายการล่วงหน้า". If some items were cancelled or already shipped by another user in the same company in the meantime, a modal "สร้างใบนำส่งไม่สำเร็จ" lists them (tracking no. + DLT ref) and they are removed automatically (CPM-1805).
5. The shipment then flows into the Drop Off system and the DLT user's reports (รายงานข้อมูล).

DLT sources:
- **Test cases**: tab `User Portal_DLT` (gid `1837559180`). Like the other test case tabs it is organised as `SCENARIO n` → `TSnn-TCnn` with columns Test Case ID / Description / Pre-condition / Test Data / Steps / Expected / Actual / Status / Priority / Note / Jira / Automate. Scenarios: TS01 access by DLT flag, TS02 Create Future Items API (automated in `tests/api/create-future-items.spec.js`), TS03 EOD payment reconcile, TS04 list, TS05 cancel, TS06 scan/import, TS07 remove scanned items, TS08 create shipment, TS09 my shipments, TS10 drop off, TS11 reports, TS12 receipt/e-Tax. "On Hold" cases reference open questions as `RR-xx`.
- **Jira** DLT stories: CPM-1756 list page, CPM-1757 scan / create shipment, CPM-1758 DB + Create Future Item API (HMAC credential CPM-1765, rate limit CPM-1768, QA CPM-1769, EOD payment job CPM-1781), CPM-1796/1797 "Plus DLT" service and service code `EMS-DLT`, CPM-1805 the "items cancelled by another user" modal.
- **Figma** page "Future Items (DLT)": sections Search&Filter / Future List, ลบรายการ, สร้างใบนำส่ง.

## Conventions (from README)

- Page Object: `PascalCasePage.js`; spec files: kebab-case `*.spec.js`; arrays use plural names.
- Commit message: verb + what was done (`add login flow e2e test`).
- Branches: `feature/<name>`, fixes `fix/feature/<name>`.
