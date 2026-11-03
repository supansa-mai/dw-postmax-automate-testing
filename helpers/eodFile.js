const { randomInt } = require('crypto');
const { randomThaiName } = require('./testData');

/**
 * Bank EOD file (KTB bill payment, BOT format) read by the payment reconcile job.
 * Every record is 256 bytes in TIS-620 (1 byte per character, Thai included) and ends with CRLF:
 * one H (header), one D per payment, one T (trailer). Column numbers below are 1-based.
 */
const RECORD_LENGTH = 256;
const BANK_CODE = '006';

function toTis620(text) {
  return Buffer.from([...text].map((char) => {
    const code = char.codePointAt(0);
    if (code < 0x80) return code;
    // Thai block U+0E01–U+0E5B maps to 0xA1–0xFB
    if (code >= 0x0e01 && code <= 0x0e5b) return code - 0x0d60;
    throw new Error(`"${char}" cannot be written in TIS-620`);
  }));
}

function text(value, width) {
  const s = String(value);
  if (s.length > width) throw new Error(`"${s}" is longer than ${width} characters`);
  return s.padEnd(width, ' ');
}

function number(value, width) {
  return text(String(value).padStart(width, '0'), width);
}

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// The bank fills reference 1 to its 20 characters: the refCode, then random letters + digits (e.g. 922220387MPTXKL70AHM)
function reference(refCode, width) {
  const suffix = Array.from({ length: Math.max(width - refCode.length, 0) }, () => ALPHANUMERIC[randomInt(0, ALPHANUMERIC.length)]);
  return text(refCode + suffix.join(''), width);
}

function record(fields) {
  return fields.join('').padEnd(RECORD_LENGTH, ' ');
}

/** DDMMYYYY (A.D.) and HHmmss in Bangkok time, as written in the file */
function bangkokParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { date: `${parts.day}${parts.month}${parts.year}`, time: `${parts.hour}${parts.minute}${parts.second}` };
}

/**
 * @param {{ runningNo: number, companyAccount: string, payments: { refCode: string, amount?: number }[], date?: Date }} options
 *   runningNo is also part of the file name, see helpers/eodBucket.js
 * @returns {Buffer} file content in TIS-620
 */
function buildEodFile({ runningNo, companyAccount, payments, date = new Date() }) {
  const { date: postDate } = bangkokParts(date);
  const lines = [];
  const sequence = () => number(lines.length + 1, 6);

  // H: 2–7 sequence, 8–10 bank, 11–20 company account, 21–60 company name, 61–68 post date, 69–76 running no.
  lines.push(record(['H', sequence(), BANK_CODE, number(companyAccount, 10), text('PostMax Automation', 40),
    postDate, text(runningNo, 8)]));

  for (const { refCode, amount = 100 } of payments) {
    const { time } = bangkokParts(date);
    // D: 21–28 date, 29–34 time, 35–84 payer, 85–104 reference 1 (refCode), 105–144 references 2–3,
    // 145–152 branch / teller, 153 C = credit, 154–156 transaction code, 157–163 cheque no., 164–176 amount,
    // 177–179 cheque bank, 244–256 copied from the sample file
    lines.push(record(['D', sequence(), BANK_CODE, number(companyAccount, 10), postDate, time,
      text(randomThaiName(), 50), reference(refCode, 20), text('', 20), text('', 20), '0000', '0000', 'C', 'NET',
      number(0, 7), number(amount, 13), '000', text('', 64), '0040000000000']));
  }

  // T: 21–33 total debit amount, 34–39 debit count, 40–52 total credit amount, 53–58 credit count
  const total = payments.reduce((sum, { amount = 100 }) => sum + amount, 0);
  lines.push(record(['T', sequence(), BANK_CODE, number(companyAccount, 10), number(0, 13), number(0, 6),
    number(total, 13), number(payments.length, 6)]));

  return toTis620(lines.map((line) => `${line}\r\n`).join(''));
}

// Reference that matches no future item: 8xxxxxxxx, apart from EOD items (9xxxxxxxx) and manual QA data (61000xxxx)
function unknownRefCode() {
  return `8${String(randomInt(0, 1e8)).padStart(8, '0')}`;
}

module.exports = { buildEodFile, unknownRefCode, RECORD_LENGTH };
