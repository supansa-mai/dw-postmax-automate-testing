// Preload CSV files in the layout of the user's template on เตรียมการฝากส่ง, one item per
// service code of the "PostMax Service Code_vInt" sheet, with random data per the "Preload CSV Data Dictionary"
const { randomInt } = require('crypto');
const { expect } = require('@playwright/test');
const { NORMAL_STATE, TSD_STATE } = require('../config/auth');
const { openPortal } = require('./portal');
const { uniqueBatchRef } = require('./futureItemsApi');
const { readDownload, parseCsv } = require('./orderData');
const { randomThaiName, randomThaiPhone, randomEmail, randomThaiAddress, randomThaiPostalCode } = require('./testData');
// One country per registered-mail zone (1-22) that also has an EMS zone, from Back Office > จัดการโซน (dev, Nov 2026);
// international fees are per zone, so more countries of the same zone would test nothing new
const COUNTRIES = ['MYANMAR', 'NETHERLANDS', 'CAMBODIA', 'BRUNEI DARUSSALAM', 'HONG KONG', 'ALGERIA', 'JAPAN', 'ISRAEL',
  'BAHRAIN', 'INDONESIA', 'AUSTRALIA', 'NEPAL', 'GERMANY', 'EGYPT', 'BELGIUM', 'AUSTRIA', 'CANADA', 'AMERICAN SAMOA',
  'ARGENTINA'];

// Service code → Thai Post type, PostMax service and e-AR as the system stores them; the "-0" codes are the free (0 baht)
// level of their service. Lite has no delivery report or per-item status (features 5-6 of the sheet)
const SERVICE_CODES = {
  'MAIL-STD-0': { type: 'NORMAL', service: 'LITE_0', eAr: 'NON' },
  'MAIL-STD': { type: 'NORMAL', service: 'LITE_STANDARD', eAr: 'NON' },
  'MAIL-STD-PLS-0': { type: 'NORMAL', service: 'PLUS_0', eAr: 'NON' },
  'MAIL-STD-PLS': { type: 'NORMAL', service: 'PLUS_NORMAL', eAr: 'NON' },
  'MAIL-R-0': { type: 'REGISTERED', service: 'LITE_0', eAr: 'NON' },
  'MAIL-R': { type: 'REGISTERED', service: 'LITE_STANDARD', eAr: 'NON' },
  'MAIL-R-PLS-0': { type: 'REGISTERED', service: 'PLUS_0', eAr: 'NON' },
  'MAIL-R-PLS': { type: 'REGISTERED', service: 'PLUS_STANDARD', eAr: 'NON' },
  'MAIL-EAR-0': { type: 'REGISTERED', service: 'PLUS_0', eAr: 'STANDARD' },
  'MAIL-EAR': { type: 'REGISTERED', service: 'PLUS_STANDARD', eAr: 'STANDARD' },
  'EMS-STD-0': { type: 'EMS', service: 'LITE_0', eAr: 'NON' },
  'EMS-STD': { type: 'EMS', service: 'LITE_STANDARD', eAr: 'NON' },
  'EMS-STD-PLUS-0': { type: 'EMS', service: 'PLUS_0', eAr: 'NON' },
  'EMS-STD-PLUS': { type: 'EMS', service: 'PLUS_STANDARD', eAr: 'NON' },
  'EMS-DLT': { type: 'EMS', service: 'PLUS_DLT', eAr: 'NON' },
  'EMS-PRIME-0': { type: 'EMS', service: 'PREMIUM_0', eAr: 'NON' },
  'EMS-PRIME': { type: 'EMS', service: 'PREMIUM_STANDARD', eAr: 'NON' },
  'EMS-EAR-PRIME': { type: 'EMS', service: 'PREMIUM_0', eAr: 'EMS' },
};

// With rural areas given, these go to a rural area (one of each Thai Post type); EMS-STD-PLUS to one with an area name
// in its address, and EMS-PRIME to the same postal code without it, which is not rural
const RURAL_CODES = ['MAIL-STD-PLS', 'MAIL-R-PLS', 'EMS-STD-PLUS'];
const NAMED_AREA_CODE = 'EMS-STD-PLUS';
const UNNAMED_AREA_CODE = 'EMS-PRIME';

// Columns of the preload template on เตรียมการฝากส่ง; TSD's has two more
const TEMPLATE_COLUMNS = ['ID', 'รหัสบริการ', 'สินค้า', 'ชื่อผู้รับ', 'ที่อยู่', 'รหัสไปรษณีย์', 'ประเทศ', 'เบอร์ติดต่อ', 'อีเมล',
  'น้ำหนักต่อชิ้น (กรัม)', 'ประกันภัย', 'มูลค่าประกัน', 'หมายเลขติดตามพัสดุ', 'หมายเลขอ้างอิง 1', 'หมายเลขอ้างอิง 2'];
const TSD_TEMPLATE_COLUMNS = [...TEMPLATE_COLUMNS, 'ราคาต่อชิ้น', 'รูปแบบซอง'];

/** A template with only its header, for preloadRows() without downloading it from the portal */
const blankTemplate = (columns) => [Object.fromEntries(columns.map((name) => [name, '']))];

const PRODUCTS = ['เสื้อผ้า', 'เอกสาร', 'ใบแจ้งยอดค้างชำระ', 'หนังสือเชิญประชุม', 'เครื่องสำอาง', ''];
// TSD's รูปแบบซอง: the values of its template, or none (shown on the dashboard)
const ENVELOPES = ['', 'seal', 'ซอง', '1', '2'];
const pick = (values) => values[randomInt(0, values.length)];

// Registered mail and EMS can go abroad (the zones exist only for those two); ordinary mail stays in Thailand
const canGoAbroad = (serviceCode) => /^(MAIL-R|MAIL-EAR|EMS)/.test(serviceCode);

/**
 * One row per service code; about a third of those that can go abroad get a random country (postal code 99999), and
 * with `ruralAreas` (Back Office rural areas) the RURAL_CODES ones go to a rural area. TSD's รูปแบบซอง is random
 * (ENVELOPES) and one random row has a ราคาต่อชิ้น, which the price must ignore; other columns come from the template's
 * rows in turn; ID is the running number like the template's
 */
function preloadRows(template, ref1, { ruralAreas } = {}) {
  const wholeCodes = ruralAreas?.filter((a) => !a.area);
  const named = ruralAreas && pick(ruralAreas.filter((a) => a.area && !wholeCodes.some((w) => w.postalCode === a.postalCode)));
  const pricedRow = randomInt(0, Object.keys(SERVICE_CODES).length);
  return Object.keys(SERVICE_CODES).map((serviceCode, i) => {
    let address = randomThaiAddress();
    let postalCode = randomThaiPostalCode();
    const ruralCase = ruralAreas && [...RURAL_CODES, UNNAMED_AREA_CODE].includes(serviceCode);
    if (ruralAreas && serviceCode === NAMED_AREA_CODE) {
      address = `${address} ${named.area}`;
      postalCode = named.postalCode;
    } else if (ruralAreas && serviceCode === UNNAMED_AREA_CODE) {
      postalCode = named.postalCode;
    } else if (ruralAreas && RURAL_CODES.includes(serviceCode)) {
      postalCode = pick(wholeCodes).postalCode;
    }
    const abroad = !ruralCase && canGoAbroad(serviceCode) && randomInt(0, 3) === 0;
    const insured = randomInt(0, 2) === 0;
    const row = template[i % template.length];
    return {
      ...row,
      ...('รูปแบบซอง' in row && { 'รูปแบบซอง': pick(ENVELOPES) }),
      ...('ราคาต่อชิ้น' in row && { 'ราคาต่อชิ้น': i === pricedRow ? String(randomInt(1, 100)) : '' }),
      ID: String(i + 1),
      'รหัสบริการ': serviceCode,
      'สินค้า': pick(PRODUCTS),
      'ชื่อผู้รับ': randomThaiName(),
      'ที่อยู่': address,
      'รหัสไปรษณีย์': abroad ? '99999' : postalCode,
      'ประเทศ': abroad ? pick(COUNTRIES) : '',
      'เบอร์ติดต่อ': randomThaiPhone(),
      'อีเมล': randomEmail(),
      // Letter weights like the template's (0.4 - 6.54 g)
      'น้ำหนักต่อชิ้น (กรัม)': (randomInt(4, 70) / 10).toString(),
      'ประกันภัย': insured ? 'Y' : 'N',
      'มูลค่าประกัน': insured ? String(randomInt(1, 80) * 100) : '0',
      'หมายเลขติดตามพัสดุ': '',
      'หมายเลขอ้างอิง 1': ref1,
      'หมายเลขอ้างอิง 2': '',
    };
  });
}

function preloadCsv(rows) {
  const header = Object.keys(rows[0]);
  const lines = [header, ...rows.map((row) => header.map((name) => row[name]))].map((cells) => cells.join(','));
  return Buffer.from(`﻿${lines.join('\n')}\n`, 'utf8');
}

/** What the pricing needs of a CSV row: { type, service, eAr, weight, country, postalCode, address } */
function pricedItem(row) {
  return {
    ...SERVICE_CODES[row['รหัสบริการ']], weight: row['น้ำหนักต่อชิ้น (กรัม)'], country: row['ประเทศ'],
    postalCode: row['รหัสไปรษณีย์'], address: row['ที่อยู่'],
  };
}

// ชื่อรายการ of every order the tests create, from the portal or the Public API
const ORDER_NAME = 'Automate_Testing';

// The users that create orders from a CSV upload; TSD's order is ส่งออกแล้ว once created
const CSV_USERS = [
  { name: 'user ปกติ', state: NORMAL_STATE, tsd: false, createdStatus: 'สร้างแล้ว' },
  { name: 'user TSD', state: TSD_STATE, tsd: true, createdStatus: 'ส่งออกแล้ว' },
];

/**
 * Creates an order as `user` with one item per service code (preloadRows), and waits until it is created;
 * returns { id, number, reference, exportDate (TSD), items }, each item the CSV row's pricing fields (pricedItem) plus its
 * tracking number, the uploaded row and the row of the order's CSV export (with the type and service labels)
 */
async function createCsvOrder(browser, user, { ruralAreas } = {}) {
  const reference = uniqueBatchRef();
  const portal = await openPortal(browser, user.state);
  await portal.preloadPage.goto();
  const template = parseCsv(await readDownload(await portal.preloadPage.downloadTemplate()));
  const rows = preloadRows(template, reference, { ruralAreas });
  await portal.preloadPage.upload(preloadCsv(rows));
  const { number, exportDate } = await portal.preloadPage.createOrder({
    reference, tsd: user.tsd, documentType: 'AUTO เอกสาร', orderName: ORDER_NAME,
  });
  // The order is กำลังสร้าง for a few seconds after the upload
  await expect(async () => {
    await portal.page.reload();
    await expect(portal.orderDetailPage.field('สถานะการฝากส่ง')).toHaveText(user.createdStatus, { timeout: 2000 });
  }).toPass({ timeout: 60000 });
  const id = portal.page.url().match(/orders\/(\d+)/)[1];
  const d = portal.orderDetailPage;
  const created = parseCsv(await readDownload(await d.download(d.csvButton)));
  const items = rows.map((row) => {
    const exported = created.find((c) => c.ID === row.ID);
    return { ...pricedItem(row), id: row.ID, trackingNumber: exported['หมายเลขติดตามพัสดุ'], row, exported };
  });
  await portal.close();
  return { id, number, reference, exportDate, items };
}

// Thai Post types as the portal shows them
const TYPE_LABELS = { NORMAL: 'ธรรมดา', REGISTERED: 'ลงทะเบียน', EMS: 'EMS' };

/** "EMS", "EMS พื้นที่พิเศษ" (zone -1) or "EMS ต่างประเทศ Zone 4": how the pages group a preloadedSummary row */
function serviceLabel({ type, zone }) {
  if (zone === -1) return `${TYPE_LABELS[type]} พื้นที่พิเศษ`;
  return zone > 0 ? `${TYPE_LABELS[type]} ต่างประเทศ Zone ${zone}` : TYPE_LABELS[type];
}

module.exports = { ORDER_NAME, SERVICE_CODES, TEMPLATE_COLUMNS, TSD_TEMPLATE_COLUMNS, blankTemplate, TYPE_LABELS, serviceLabel, CSV_USERS, preloadRows, preloadCsv, pricedItem, createCsvOrder };
