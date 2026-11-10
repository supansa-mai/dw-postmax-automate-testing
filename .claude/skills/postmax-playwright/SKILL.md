---
name: postmax-playwright
description: PostMax-specific notes for writing and running Playwright tests in this repo (dw-postmax-automate-testing) - which Playwright project a case belongs to, how to get paid future items through the EOD setup, and traps in the PostMax UI that cost debugging rounds before. Use this together with the automate-playwright-test skill whenever the user asks to automate or write a test for a PostMax case (TSxx-TCxx, DLT future items, scan / create order, User Portal, Drop Off, Back Office, public API), even if they only give a test-case ID.
---

# PostMax Playwright notes

Follow the general workflow in the `automate-playwright-test` skill (synced from claude.ai; if it isn't installed, the steps
are: read the cases -> plan -> write -> run on dev -> fix until green -> report). `CLAUDE.md` holds the architecture,
commands, test data rules, domain and the sheet / Jira / Figma sources; this file adds what is only learned by writing tests here.

## Which project a test goes in

- **`api`** (`tests/api/**`): no browser, runs serially because the dev DB pool is small. Follow
  `tests/api/create-future-items.spec.js`.
- **`chromium`**: UI tests that only need fresh, unpaid items - create them with `createBatch` inside the test.
- **`eod`**: UI tests that need **paid** items (scan, create order, reconcile). The only way to pay is the bank EOD
  file plus the 5-minute reconcile job, so:
  - add a group to `GROUPS` in `tests/eod.setup.js` (numeric refCodes, created there) and read it with
    `readEodItems()`; the spec file must match `EOD_SPECS` in `playwright.config.js`;
  - one spec per page / scenario (create order TS06-TS08, my orders TS09, later drop off TS10 and reports TS11);
    don't add a new page's cases to an existing spec just to reuse its data - a spec that depends on another spec's
    test gets skipped whenever that test fails;
  - data a spec only reads comes from the setup: e.g. `eod.setup.js` creates one order and saves it as `order`
    for `orders-future-items.spec.js` and later read-only specs. A test that changes the data (receives the order
    at drop off, cancels an item) creates its own instead, so the read-only specs see a stable state;
  - sharing inside one spec is fine for a small follow-up check (TS05-TC02 checks the item TS06-TC05 already put in
    an order). When the choice is "fewer real orders" vs "independent tests", say so in the plan and let the user
    pick. Orders per run today: 3 in create-order + 1 shared + 1 received at drop off (`receiveOrder`) + 1 received in part (`partialReceiveOrder`) = 6;
  - `create-order-future-items.spec.js` runs its tests in order (`mode: 'default'`), since they share the scanned
    list in localStorage and the per-huid rate limit.
- Drop Off specs (`tests/drop-off/`) run in `eod` with `test.use({ storageState: DROPOFF_STATE })` (written by
  `tests/auth.setup.js`); to see what the DLT customer sees, open the User Portal in a second context with `USER_STATE`.
  Receiving: detail page วิธีการนำส่งเข้าสู่ระบบ "ทั้งหมด" -> ยืนยัน -> `/scan/all` summary -> รับฝาก -> confirm dialog.
- Don't run `eod` specs on UAT unless the user says so: they create real orders there.

## PostMax UI traps

- Toast: `getByRole('alert').and(page.locator('.MuiAlert-root'))` (Next.js route announcer is also `role=alert`).
- Create-order page: wait for hydration before scanning (`CreateFutureItemPage.goto()`); typing 13 chars without
  Enter imports automatically, Enter on a shorter value shows the "ไม่พบ" modal.
- Scanned items persist in localStorage `dlt_scanned_items_<company>_<user>` (kept across logout). Each test gets a
  fresh browser context, so the list starts empty; a second context of the same user does not see the first one's
  list.
- Future-items list: date range is required before data loads; the Batch No. filter is not in the URL and is lost on
  reload (dates survive), so use `FutureItemsPage.openBatch()` again instead of `reload()`.
- DataGrid: checkboxes via `toggle()` / `toggleAll()` (click, not check), assert through "ลบรายการ (n)";
  `scrollGrid('end')` before asserting rows further down.
- "Another user in the same company" (CPM-1805, TS05-TC04, TS08-TC02): same DLT user in a second browser context
  (`openAnotherBrowser` in the create-order spec), not a second account.
- Logout tests live in their own top-level describe so the shared `beforeEach` doesn't navigate first.
- Dev returns 500 when the DB pool is exhausted and 429 when the per-huid rate limit hits; the API client retries
  429 already. Keep workers low (`WORKERS` default 2).
