// What รายงานข้อมูล should show, worked out from the orders a company had received at drop off (Back Office data).
// The dashboard reads a view rebuilt every midnight, so it only has days up to yesterday and item statuses as they
// were at midnight (CPM-1783).
const { parseCsv } = require('./orderData');

const DAY = 24 * 60 * 60 * 1000;
const BANGKOK = 7 * 60 * 60 * 1000;
const TYPES = ['NORMAL', 'REGISTERED', 'EMS'];
const LOCATIONS = ['BANGKOK', 'NON_BANGKOK', 'ABROAD'];
const TYPE_BY_LABEL = { 'ธรรมดา': 'NORMAL', 'ลงทะเบียน': 'REGISTERED', EMS: 'EMS' };
// Thai Post statuses of an item (order-items): not received yet, delivered, failed
const NOT_RECEIVED = '002';
const DELIVERED = '501';
const FAILED = '401';

/** 2026-11-11, the Bangkok day of an ISO time */
const bangkokDay = (iso) => new Date(new Date(iso).getTime() + BANGKOK).toISOString().slice(0, 10);

/** Midnight Bangkok time of a Bangkok day, as an ISO time */
const startOfDay = (day) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() - BANGKOK).toISOString();

/** The days of "N วันที่ผ่านมา": N + 1 days up to yesterday, e.g. 7 → 4 - 11 พ.ย. on the 12th */
function lastDays(n, today = new Date()) {
  const midnight = new Date(startOfDay(bangkokDay(today))).getTime();
  return daysBetween(bangkokDay(new Date(midnight - (n + 1) * DAY + BANGKOK)), bangkokDay(new Date(midnight - DAY + BANGKOK)));
}

/** Every day from `first` to `last`, with the startDate / endDate the page sends for them */
function daysBetween(first, last) {
  const days = [];
  for (let t = new Date(`${first}T00:00:00Z`).getTime(); t <= new Date(`${last}T00:00:00Z`).getTime(); t += DAY) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return { days, startDate: startOfDay(first), endDate: new Date(new Date(startOfDay(last)).getTime() + DAY - 1).toISOString() };
}

/** "7 วันที่ผ่านมา", the page's default */
const lastSevenDays = (today) => lastDays(7, today);

/** As the date filter shows a range: "4 - 11 พ.ย. 2569", or "14 ต.ค. - 11 พ.ย. 2569" across months */
function rangeLabel(days) {
  const [first, last] = [days[0], days[days.length - 1]].map((d) => new Date(`${d}T00:00:00Z`));
  const dayMonth = (d) => new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(d);
  const year = last.getUTCFullYear() + 543;
  const from = first.getUTCMonth() === last.getUTCMonth() ? String(first.getUTCDate()) : dayMonth(first);
  return `${from} - ${dayMonth(last)} ${year}`;
}

/** 10/11/2569, as the custom range fields take a day */
const fieldDate = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${Number(day.slice(0, 4)) + 543}`;

/** กรุงเทพและปริมณฑล = postal codes 10xxx-12xxx, as the order report groups them */
function locationOf({ country, postalCode }) {
  if (country && country !== 'Thailand') return 'ABROAD';
  return /^1[0-2]/.test(postalCode) ? 'BANGKOK' : 'NON_BANGKOK';
}

/**
 * The orders `companyId` had received at drop off on `days`, each with its items: Lite items have no Thai Post status,
 * so they come from the preloaded file and only the order's count tells how many of them were received
 */
async function receivedOrders(backOffice, companyId, days) {
  const from = new Date(new Date(startOfDay(days[0])).getTime() - 30 * DAY).toISOString();
  const to = new Date(new Date(startOfDay(days[days.length - 1])).getTime() + DAY).toISOString();
  const listed = [];
  for (let page = 1; ; page++) {
    const batch = await backOffice.get(`orders?startDate=${from}&endDate=${to}&page=${page}&perPage=100`);
    listed.push(...batch);
    if (batch.length < 100) break;
  }
  const orders = [];
  for (const row of listed.filter((o) => o.company.id === companyId && o.totalDroppedOffOrderItems > 0)) {
    const order = await backOffice.order(row.id);
    if (!order.dropOffAt || !days.includes(bangkokDay(order.dropOffAt))) continue;
    const tracked = await backOffice.orderItems(row.id);
    const file = parseCsv(await backOffice.preloadedFile(row.id));
    const lite = file.filter((r) => r['บริการ'].startsWith('Lite')).map((r) => ({
      type: TYPE_BY_LABEL[r['ประเภทการขนส่ง']],
      location: locationOf({ country: r['ประเทศ'], postalCode: r['รหัสไปรษณีย์'] }),
      trackingNumber: r['หมายเลขติดตามพัสดุ'],
      name: r['ชื่อผู้รับ'],
      email: r['อีเมล'],
      phone: r['เบอร์ติดต่อ'],
    }));
    const items = tracked.filter((i) => i.status !== NOT_RECEIVED).map((i) => ({
      type: i.type,
      location: locationOf(i.receiver),
      trackingNumber: i.trackingNumber,
      name: i.receiver.name,
      email: i.receiver.email,
      phone: i.receiver.phone,
      status: i.status,
      // Changed after the view was built: the dashboard still has its status of midnight
      changedToday: bangkokDay(i.updatedAt) === bangkokDay(new Date()),
    }));
    orders.push({
      number: order.trackingNumber,
      reference: order.refNumber,
      documentType: order.documentType,
      day: bangkokDay(order.dropOffAt),
      received: order.totalDroppedOffOrderItems,
      missing: order.totalOrderItems - order.totalDroppedOffOrderItems,
      missingReason: order.missingItemReason?.name,
      items,
      lite,
      liteReceived: order.totalDroppedOffOrderItems - items.length,
    });
  }
  return orders;
}

/**
 * The settlement summaries of `companyId` confirmed (settled) so far: ค่าบริการ adds up their final amounts by the day
 * they were confirmed
 */
async function settledFees(backOffice, companyId) {
  const [from, to] = ['2024-01-01T00:00:00.000Z', new Date(Date.now() + DAY).toISOString()];
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await backOffice.get(`settlement-summaries?issueStartDate=${from}&issueEndDate=${to}`
      + `&releaseStartDate=${from}&releaseEndDate=${to}&page=${page}&perPage=100`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.filter((s) => s.paymentSummary.company.id === companyId && s.settledAt).map((s) => ({
    amount: Number(s.paymentSummary.finalAmount),
    settledAt: s.settledAt,
    orderNumber: s.order.trackingNumber,
    // TSD's reference search looks in ประเภทเอกสาร, ชื่อรายการ and หมายเลขอ้างอิง together
    searchText: [s.order.documentType, s.order.orderName, s.order.refNumber].join(' '),
  }));
}

/** [min, max] of a count; exact when min === max */
const range = (min, max = min) => ({ min, max });
const add = (a, b) => range(a.min + b.min, a.max + b.max);

/**
 * How many received items each key (type or location) should have. Lite items count when all or none of an order's
 * Lite items were received; when only some were, which ones is not known, so the count is a range
 */
function countBy(orders, key, keys) {
  const counts = Object.fromEntries(keys.map((k) => [k, range(0)]));
  for (const order of orders) {
    for (const item of order.items) counts[item[key]] = add(counts[item[key]], range(1));
    const per = Object.fromEntries(keys.map((k) => [k, order.lite.filter((l) => l[key] === k).length]));
    const missingLite = order.lite.length - order.liteReceived;
    for (const k of keys) {
      // Each key can lose at most all its Lite items, and only as many as went missing
      counts[k] = add(counts[k], range(Math.max(per[k] - missingLite, 0), per[k]));
    }
  }
  return counts;
}

/**
 * Received items of `orders` matching `match({ type, location })`, as a range like countBy(): Lite items count when it
 * is known whether they were received
 */
function countWhere(orders, match) {
  let total = range(0);
  for (const order of orders) {
    total = add(total, range(order.items.filter(match).length));
    const matching = order.lite.filter(match).length;
    const missingLite = order.lite.length - order.liteReceived;
    total = add(total, range(Math.max(matching - missingLite, 0), matching));
  }
  return total;
}

/** Delivered / failed items; a status set today may or may not be in the view yet */
function deliveryCounts(orders) {
  const items = orders.flatMap((o) => o.items);
  const count = (status) => range(
    items.filter((i) => i.status === status && !i.changedToday).length,
    items.filter((i) => i.status === status).length,
  );
  return { success: count(DELIVERED), fail: count(FAILED) };
}

/** Everything the dashboard should show for `orders`, per day and for the whole range */
function expectedDashboard(orders, days) {
  const perDay = Object.fromEntries(days.map((day) => {
    const ofDay = orders.filter((o) => o.day === day);
    return [day, {
      received: ofDay.reduce((sum, o) => sum + o.received, 0),
      byType: countBy(ofDay, 'type', TYPES),
      ...deliveryCounts(ofDay),
    }];
  }));
  // 10 อันดับสาเหตุในการรับฝากไม่ครบ counts orders per reason, not their missing items
  const missingReasons = {};
  for (const o of orders.filter((x) => x.missingReason)) {
    missingReasons[o.missingReason] = (missingReasons[o.missingReason] ?? 0) + 1;
  }
  return {
    perDay,
    received: orders.reduce((sum, o) => sum + o.received, 0),
    byType: countBy(orders, 'type', TYPES),
    byLocation: countBy(orders, 'location', LOCATIONS),
    ...deliveryCounts(orders),
    missingReasons,
  };
}

module.exports = {
  TYPES, LOCATIONS, bangkokDay, startOfDay, lastDays, lastSevenDays, daysBetween, rangeLabel, fieldDate, receivedOrders,
  expectedDashboard, countWhere, settledFees,
};
