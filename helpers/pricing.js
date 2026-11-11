// Price of an order item per the fee settings in Back Office, as in "PostMax Service Code_vInt":
// Thai Post fee (domestic by weight band, abroad by the country's zone and weight band) + e-AR + PostMax service,
// plus the rural area fee for EMS to a rural area (other types stay at their price). Insurance adds nothing.

/**
 * A rural area in Back Office > จัดการพื้นที่พิเศษ is a whole postal code, or with an area (an island) only the addresses
 * that name it
 */
const isRural = (rural, item) => !item.country
  && rural.areas.some((a) => a.postalCode === item.postalCode && (!a.area || item.address?.includes(a.area)));

/** Weight bands are "เกิน min แต่ไม่เกิน max" */
const band = (rows, weight) => rows.find((row) => Number(row.minWeight) < weight && weight <= Number(row.maxWeight));

/** `item`: { type, service, eAr, weight, country, postalCode, address } (type NORMAL / REGISTERED / EMS); returns { zone, price } */
async function itemPrice(fees, item) {
  const weight = Number(item.weight);
  let zone = 0;
  let thaiPost;
  if (item.country) {
    const zoneType = item.type === 'EMS' ? 'EMS' : 'REGISTERED';
    const country = fees.zones[zoneType].find((c) => c.country === item.country || c.variants?.includes(item.country));
    if (!country) throw new Error(`No ${zoneType} zone for ${item.country}`);
    zone = country.zone;
    thaiPost = band(await fees.international(zoneType, zone), weight);
  } else {
    thaiPost = band(fees.domestic[item.type], weight);
  }
  if (!thaiPost) throw new Error(`No fee for ${item.type} ${weight} g (zone ${zone})`);
  const rural = item.type === 'EMS' && isRural(fees.rural, item) ? fees.rural.price : 0;
  const price = Number(thaiPost.basePrice) + fees.eAr[item.eAr] + fees.service[item.service] + rural;
  return { zone, price: Math.round(price * 100) / 100 };
}

/** Items grouped like an order's preloadedSummary: one row per type, zone (-1 = rural area), service, e-AR and weight */
async function expectedSummary(fees, items) {
  const groups = new Map();
  for (const item of items) {
    const { zone: countryZone, price } = await itemPrice(fees, item);
    const zone = isRural(fees.rural, item) ? -1 : countryZone;
    const weight = Number(item.weight).toFixed(2);
    const key = [item.type, zone, item.service, item.eAr, weight].join('|');
    const group = groups.get(key) ?? { type: item.type, zone, service: item.service, eArService: item.eAr, weight, basePrice: price.toFixed(2), total: 0 };
    group.total += 1;
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({ ...g, totalPrice: (Number(g.basePrice) * g.total).toFixed(2) }));
}

/** Sorts summary rows (Back Office preloadedSummary or expectedSummary) so the two can be compared */
const bySummaryKey = (rows) => [...rows].sort((a, b) =>
  [a.type, a.zone, a.service, a.eArService, a.weight].join('|').localeCompare([b.type, b.zone, b.service, b.eArService, b.weight].join('|')));

/** As the User Portal shows an amount: 1,234.50 บาท */
const baht = (amount) => `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;

module.exports = { itemPrice, expectedSummary, bySummaryKey, baht };
