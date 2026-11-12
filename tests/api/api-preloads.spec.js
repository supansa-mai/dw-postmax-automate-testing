const { test, expect } = require('../../fixtures');
const { env, ENV_NAME } = require('../../config/environments');
const { nowUnix } = require('../../helpers/hmac');
const { PreloadsApi, csvFile } = require('../../helpers/preloadsApi');
const { ORDER_NAME, TEMPLATE_COLUMNS, TSD_TEMPLATE_COLUMNS, blankTemplate, preloadRows, preloadCsv, pricedItem } = require('../../helpers/preloadCsv');
const { BackOfficeApi } = require('../../helpers/backOfficeApi');
const { expectedSummary, bySummaryKey } = require('../../helpers/pricing');
const { uniqueBatchRef } = require('../../helpers/futureItemsApi');
const { expectSuccess, expectInvalidSignature, expectInvalidBody } = require('../../helpers/apiAssertions');

// The Preload Failure emails these tests cause go to the QA instead of the key owner; the +tag lets Gmail filter them
const NOTIFY_EMAIL = 'supansa.h+postmax-auto@datawow.io';
const REQUIRED_FIELDS = ['file', 'documentType', 'orderName', 'refNumber'];
const OPTIONAL_FIELDS = ['releaseDate', 'orderItemCount', 'notifyEmail'];

// One broken row each (TSD). A country with no zone for the row's service only cuts that row out (CPM-1714,
// TSD-06; a normal company's whole file would fail)...
const DROPPED_ROWS = {
  'ประเทศไม่มีในระบบ': (row) => Object.assign(row, { 'รหัสบริการ': 'MAIL-R', 'ประเทศ': 'NOWHERELAND', 'รหัสไปรษณีย์': '99999' }),
  'ไปรษณีย์ธรรมดาส่งต่างประเทศ': (row) => Object.assign(row, { 'รหัสบริการ': 'MAIL-STD', 'ประเทศ': 'JAPAN', 'รหัสไปรษณีย์': '99999' }),
};
// ...the rest fail the whole file (a wrong email is not checked)
const FAILING_ROWS = {
  'ไม่กรอกชื่อผู้รับ': (row) => { row['ชื่อผู้รับ'] = ''; },
  'ไม่กรอกที่อยู่': (row) => { row['ที่อยู่'] = ''; },
  'ไม่กรอกรหัสไปรษณีย์ (ในประเทศ)': (row) => Object.assign(row, { 'ประเทศ': '', 'รหัสไปรษณีย์': '' }),
  'ไม่กรอกรหัสไปรษณีย์ (ต่างประเทศ)': (row) => Object.assign(row, { 'รหัสบริการ': 'MAIL-R', 'ประเทศ': 'JAPAN', 'รหัสไปรษณีย์': '' }),
  'รหัสบริการไม่มีในระบบ': (row) => { row['รหัสบริการ'] = 'MAIL-XXX'; },
  'น้ำหนักไม่ใช่ตัวเลข': (row) => { row['น้ำหนักต่อชิ้น (กรัม)'] = 'abc'; },
  'มูลค่าประกันไม่ใช่ตัวเลข': (row) => Object.assign(row, { 'ประกันภัย': 'Y', 'มูลค่าประกัน': 'abc' }),
  'หมายเลขติดตามผิดรูปแบบ': (row) => { row['หมายเลขติดตามพัสดุ'] = 'ABC123'; },
};

const USERS = [
  { name: 'user ปกติ', key: () => env.normalUser, keyName: 'NORMAL_USER', columns: TEMPLATE_COLUMNS, tsd: false },
  { name: 'user TSD', key: () => env.tsdUser, keyName: 'TSD_USER', columns: TSD_TEMPLATE_COLUMNS, tsd: true },
];

/**
 * A valid preload: one row per service code, with the item count and the total. The total is checked against the
 * file's own ราคาต่อชิ้น (TSD's column; 0 without it), not the price the system works out (`summary`, of the rows
 * other than the broken one). `breakRow` changes one row without a ราคาต่อชิ้น, `editRows` any rows; `editCsv` changes
 * the file's text
 */
async function buildPreload(user, fees, { breakRow, editRows, editCsv = (csv) => csv } = {}) {
  const reference = uniqueBatchRef();
  const rows = preloadRows(blankTemplate(user.columns), reference);
  const total = rows.reduce((sum, row) => sum + Number(row['ราคาต่อชิ้น'] || 0), 0);
  const brokenRow = breakRow && rows.find((row) => !row['ราคาต่อชิ้น']);
  breakRow?.(brokenRow);
  const summary = await expectedSummary(fees, rows.filter((row) => row !== brokenRow).map(pricedItem));
  // After pricing: rows broken this way are only for cases that fail the whole file
  editRows?.(rows);
  return {
    rows,
    summary,
    total,
    fields: {
      file: csvFile(Buffer.from(editCsv(preloadCsv(rows).toString('utf8')), 'utf8')),
      releaseDate: new Date().toISOString(),
      documentType: 'Preload API',
      orderName: ORDER_NAME,
      refNumber: reference,
      orderItemCount: String(rows.length),
      totalPrices: total.toFixed(2),
      notifyEmail: NOTIFY_EMAIL,
    },
  };
}

/** Waits until the background job has created the order or given up on it; returns its Back Office list row */
async function waitForOrder(backOffice, number) {
  let order;
  await expect.poll(async () => {
    order = await backOffice.findOrder(number);
    return order?.status;
  }, { message: `order ${number} still being created`, timeout: 120000, intervals: [3000] }).toMatch(/^CREATED_(SUCCESS|FAILED)$/);
  return order;
}

/** The key pair decides the company, not the user who logs in: a normal user's key on a TSD company tests nothing */
function expectCompanyOf(user, detail) {
  const key = `${ENV_NAME.toUpperCase()}_${user.keyName}_HUID`;
  expect(detail.company.isTsd, `${key} belongs to "${detail.company.name}", which is ${detail.company.isTsd ? '' : 'not '}TSD`)
    .toBe(user.tsd);
}

/** Sends the preload, expects 201 CREATED_PENDING, and returns the order once it is processed */
async function preloadAndWait(api, backOffice, fields) {
  const data = await expectSuccess(await api.create(fields));
  expect(data.status).toBe('CREATED_PENDING');
  return waitForOrder(backOffice, data.orderNumber);
}

test.describe('Public API preload (/v1/public/preloads/tsd)', () => {
  // Longer than waitForOrder's 2 minutes, so a slow job fails with its own message
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  let backOffice;
  let fees;

  test.beforeAll(async ({ browser }) => {
    backOffice = await BackOfficeApi.open(browser);
    fees = await backOffice.fees();
  });

  test.afterAll(async () => {
    await backOffice?.close();
  });

  for (const user of USERS) {
    test.describe(user.name, () => {
      let api;

      // Required key pair: fail instead of skipping, so a run without it is not mistaken for a passing one
      test.beforeEach(({ request }) => {
        const { huid, secretKey } = user.key();
        const prefix = `${ENV_NAME.toUpperCase()}_${user.keyName}`;
        expect(huid && secretKey, `Set ${prefix}_HUID and ${prefix}_SECRET_KEY in .env`).toBeTruthy();
        api = new PreloadsApi(request, env.apiURL, { huid, secretKey });
      });

      test('สร้างใบนำส่งสำเร็จ ราคาตรงกับค่าบริการใน Back Office', async () => {
        const { rows, summary, total, fields } = await buildPreload(user, fees);
        const response = await api.create(fields);
        const data = await expectSuccess(response);
        expect(data).toMatchObject({
          orderNumber: expect.stringMatching(/^PM[0-9A-Z]+$/),
          releaseDate: fields.releaseDate,
          documentType: fields.documentType,
          orderName: fields.orderName,
          refNumber: fields.refNumber,
          status: 'CREATED_PENDING',
        });
        expect(Number(data.orderItemCount)).toBe(rows.length);
        expect(Number(data.totalPrices)).toBeCloseTo(total, 2);

        const order = await waitForOrder(backOffice, data.orderNumber);
        expect(order).toMatchObject({ status: 'CREATED_SUCCESS', totalOrderItems: rows.length, refNumber: fields.refNumber });
        const detail = await backOffice.order(order.id);
        expectCompanyOf(user, detail);
        expect(detail).toMatchObject({ documentType: fields.documentType, releaseDate: fields.releaseDate });
        expect(bySummaryKey(detail.preloadedSummary)).toEqual(bySummaryKey(summary));
      });

      // Normal companies rarely preload through the API: only the cases where they get a different result from TSD
      if (!user.tsd) {
        for (const label of Object.keys(DROPPED_ROWS)) {
          test(`${label} สร้างไม่สำเร็จทั้งไฟล์`, async () => {
            const { fields } = await buildPreload(user, fees, { breakRow: DROPPED_ROWS[label] });
            const order = await preloadAndWait(api, backOffice, fields);
            expect(order).toMatchObject({ status: 'CREATED_FAILED', totalOrderItems: 0 });
          });
        }
        return;
      }

      for (const [label, breakRow] of Object.entries(DROPPED_ROWS)) {
        test(`${label} ตัดแถวนั้นออก ที่เหลือสร้างสำเร็จ`, async () => {
          const { rows, summary, fields } = await buildPreload(user, fees, { breakRow });
          const order = await preloadAndWait(api, backOffice, fields);
          expect(order).toMatchObject({ status: 'CREATED_SUCCESS', totalOrderItems: rows.length - 1 });
          const { preloadedSummary } = await backOffice.order(order.id);
          expect(bySummaryKey(preloadedSummary)).toEqual(bySummaryKey(summary));
        });
      }

      test('จำนวนชิ้นไม่ตรงกับไฟล์ สร้างไม่สำเร็จ', async () => {
        const { rows, fields } = await buildPreload(user, fees);
        const order = await preloadAndWait(api, backOffice, { ...fields, orderItemCount: String(rows.length + 1) });
        expect(order.status).toBe('CREATED_FAILED');
      });

      test('ราคาสุทธิไม่ตรงกับไฟล์ สร้างไม่สำเร็จ', async () => {
        const { total, fields } = await buildPreload(user, fees);
        const order = await preloadAndWait(api, backOffice, { ...fields, totalPrices: (total + 1).toFixed(2) });
        expect(order.status).toBe('CREATED_FAILED');
      });

      test('ชื่อคอลัมน์ไม่ตรงกับ template สร้างไม่สำเร็จ', async () => {
        const { fields } = await buildPreload(user, fees, { editCsv: (csv) => csv.replace('ชื่อผู้รับ', 'ชื่อ') });
        const order = await preloadAndWait(api, backOffice, fields);
        expect(order.status).toBe('CREATED_FAILED');
      });

      for (const [label, breakRow] of Object.entries(FAILING_ROWS)) {
        test(`${label} สร้างไม่สำเร็จทั้งไฟล์`, async () => {
          const { fields } = await buildPreload(user, fees, { breakRow });
          const order = await preloadAndWait(api, backOffice, fields);
          expect(order).toMatchObject({ status: 'CREATED_FAILED', totalOrderItems: 0 });
        });
      }

      // Not the CPM-1828 portal bug: with nothing left after cutting, the API fails the file
      test('ประเทศไม่มีในระบบทุกแถว สร้างไม่สำเร็จทั้งไฟล์', async () => {
        const { fields } = await buildPreload(user, fees, { editRows: (rows) => rows.forEach(DROPPED_ROWS['ประเทศไม่มีในระบบ']) });
        const order = await preloadAndWait(api, backOffice, fields);
        expect(order).toMatchObject({ status: 'CREATED_FAILED', totalOrderItems: 0 });
      });

      // Only a wrong country is cut out; any other error still fails the file
      test('ประเทศไม่มีในระบบ ปนกับไม่กรอกชื่อผู้รับ สร้างไม่สำเร็จทั้งไฟล์', async () => {
        const { fields } = await buildPreload(user, fees, {
          breakRow: DROPPED_ROWS['ประเทศไม่มีในระบบ'],
          editRows: (rows) => { rows.filter((row) => !row['ราคาต่อชิ้น'] && !row['ประเทศ'])[1]['ชื่อผู้รับ'] = ''; },
        });
        const order = await preloadAndWait(api, backOffice, fields);
        expect(order).toMatchObject({ status: 'CREATED_FAILED', totalOrderItems: 0 });
      });
    });
  }

  test.describe('ตรวจสอบ request', () => {
    let api;

    test.beforeEach(({ request }) => {
      const { huid, secretKey } = env.tsdUser;
      expect(huid && secretKey, `Set ${ENV_NAME.toUpperCase()}_TSD_USER_HUID and _SECRET_KEY in .env`).toBeTruthy();
      api = new PreloadsApi(request, env.apiURL, { huid, secretKey });
    });

    test('signature ผิด → 401', async () => {
      const { fields } = await buildPreload(USERS[1], fees);
      const headers = { ...api.signedHeaders(), 'x-signature': '0'.repeat(64) };
      await expectInvalidSignature(await api.create(fields, { headers }));
    });

    // CPM-1812: a timestamp within 5 minutes passes the HMAC check, so the empty body is what fails
    for (const [label, seconds] of [['-4 นาที', -240], ['+4 นาที', 240]]) {
      test(`x-timestamp ${label} ผ่าน HMAC`, async () => {
        const headers = api.signedHeaders({ timestamp: nowUnix() + seconds });
        await expectInvalidBody(await api.create({ refNumber: '' }, { headers }));
      });
    }

    for (const [label, seconds] of [['-5 นาที 5 วินาที', -305], ['+5 นาที 5 วินาที', 305], ['+1 ชั่วโมง', 3600], ['+1 วัน', 86400]]) {
      test(`x-timestamp ${label} → 401`, async () => {
        const headers = api.signedHeaders({ timestamp: nowUnix() + seconds });
        await expectInvalidSignature(await api.create({ refNumber: '' }, { headers }));
      });
    }

    for (const field of REQUIRED_FIELDS) {
      test(`ไม่ส่ง ${field} → 400`, async () => {
        const { fields } = await buildPreload(USERS[1], fees);
        delete fields[field];
        await expectInvalidBody(await api.create(fields));
      });
    }

    for (const field of OPTIONAL_FIELDS) {
      test(`ไม่ส่ง ${field} สร้างสำเร็จ`, async () => {
        const { fields } = await buildPreload(USERS[1], fees);
        delete fields[field];
        expect((await preloadAndWait(api, backOffice, fields)).status).toBe('CREATED_SUCCESS');
      });
    }

    // Without totalPrices the file's ราคาต่อชิ้น must add up to 0, unlike orderItemCount, which is then not checked
    test('ไม่ส่ง totalPrices แต่ไฟล์มีราคาต่อชิ้น สร้างไม่สำเร็จ', async () => {
      const { total, fields } = await buildPreload(USERS[1], fees);
      expect(total).toBeGreaterThan(0);
      delete fields.totalPrices;
      expect((await preloadAndWait(api, backOffice, fields)).status).toBe('CREATED_FAILED');
    });

    // Required, but may be empty
    for (const field of ['documentType', 'orderName', 'refNumber']) {
      test(`${field} เป็นค่าว่าง สร้างสำเร็จ`, async () => {
        const { fields } = await buildPreload(USERS[1], fees);
        expect((await preloadAndWait(api, backOffice, { ...fields, [field]: '' })).status).toBe('CREATED_SUCCESS');
      });
    }
  });
});
