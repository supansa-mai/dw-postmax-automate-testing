// The portal shows dates in the Buddhist calendar and Bangkok time, e.g. 30/10/2569 - 12:01
const formatter = new Intl.DateTimeFormat('en-GB-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function partsOf(date) {
  return Object.fromEntries(formatter.formatToParts(new Date(date)).map((p) => [p.type, p.value]));
}

/** DD/MM/YYYY (B.E.), the format typed into the date pickers */
function thaiDate(date = new Date()) {
  const { day, month, year } = partsOf(date);
  return `${day}/${month}/${year}`;
}

/** DD/MM/YYYY - HH:mm (B.E.), the format of "วันที่ได้รับข้อมูล" */
function thaiDateTime(date) {
  const { hour, minute } = partsOf(date);
  return `${thaiDate(date)} - ${hour}:${minute}`;
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

module.exports = { thaiDate, thaiDateTime, daysFromNow };
