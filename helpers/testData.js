const { randomInt } = require('crypto');

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------
const PREFIXES = ['นาย', 'นางสาว', 'นาง'];
const FIRST_NAMES = ['สมชาย', 'สมหญิง', 'กมล', 'วิภา', 'นิติ', 'ปิยะ', 'รุ่งโรจน์', 'อารียา', 'ธนวัฒน์', 'พิมพ์ใจ'];
const LAST_NAMES = ['ใจดี', 'มีสุข', 'รักชาติ', 'วงศ์ทอง', 'สุขสม', 'จันทร์เพ็ญ', 'บุญมา', 'ศรีสวัสดิ์'];

function randomThaiName() {
  const prefix = PREFIXES[randomInt(0, PREFIXES.length)];
  const first = FIRST_NAMES[randomInt(0, FIRST_NAMES.length)];
  const last = LAST_NAMES[randomInt(0, LAST_NAMES.length)];
  return `${prefix}${first} ${last}`;
}

// ---------------------------------------------------------------------------
// Phone — ขึ้นต้นด้วย 06 / 08 / 09 ตาม format ไทย
// ---------------------------------------------------------------------------
const PHONE_PREFIXES = ['06', '08', '09'];

function randomThaiPhone() {
  const prefix = PHONE_PREFIXES[randomInt(0, PHONE_PREFIXES.length)];
  return `${prefix}${String(randomInt(0, 1e8)).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// Email — unique ทุกครั้ง, คละ domain
// ---------------------------------------------------------------------------
const EMAIL_DOMAINS = ['gmail.com', 'hotmail.com'];

function randomEmail() {
  const domain = EMAIL_DOMAINS[randomInt(0, EMAIL_DOMAINS.length)];
  return `qa.auto.${randomInt(10000, 99999)}@${domain}`;
}

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------
const STREET_NAMES = ['สุขุมวิท', 'พระราม 9', 'ลาดพร้าว', 'รัชดาภิเษก', 'พหลโยธิน', 'สีลม', 'เจริญกรุง'];
const DISTRICTS = ['กรุงเทพฯ', 'เชียงใหม่', 'ขอนแก่น', 'นนทบุรี', 'ปทุมธานี'];

function randomThaiAddress() {
  const num = randomInt(1, 999);
  const street = STREET_NAMES[randomInt(0, STREET_NAMES.length)];
  const district = DISTRICTS[randomInt(0, DISTRICTS.length)];
  return `${num} ถนน${street} ${district}`;
}

// ---------------------------------------------------------------------------
// Postal code — เฉพาะรหัสที่มีจริงในไทย
// ---------------------------------------------------------------------------
const POSTAL_CODES = [
  // กรุงเทพฯ
  '10100', '10110', '10120', '10150', '10160', '10170', '10200', '10210',
  '10230', '10240', '10250', '10260', '10270', '10300', '10310', '10330',
  // เชียงใหม่
  '50000', '50100', '50200', '50300',
  // ขอนแก่น
  '40000', '40110', '40120',
  // นนทบุรี
  '11000', '11120', '11130',
  // ปทุมธานี
  '12000', '12110', '12120',
];

function randomThaiPostalCode() {
  return POSTAL_CODES[randomInt(0, POSTAL_CODES.length)];
}

// ---------------------------------------------------------------------------
// Weight — 0.5 – 30.0 กก. (1 decimal)
// ---------------------------------------------------------------------------
function randomWeight() {
  return (randomInt(5, 300) / 10).toFixed(1);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  randomThaiName,
  randomThaiPhone,
  randomEmail,
  randomThaiAddress,
  randomThaiPostalCode,
  randomWeight,
};
