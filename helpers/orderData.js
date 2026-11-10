// Downloaded order documents and the per-weight summaries shown for an order (User Portal and Drop Off)
const fs = require('fs');

async function readDownload(download) {
  return fs.promises.readFile(await download.path());
}

// Plain split is enough: generated names and addresses never contain commas
function parseCsv(buffer) {
  const [header, ...lines] = buffer.toString('utf8').replace(/^﻿/, '').trim().split(/\r?\n/).map((line) => line.split(','));
  return lines.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i]])));
}

function countBy(values) {
  return [...values.reduce((counts, v) => counts.set(v, (counts.get(v) ?? 0) + 1), new Map())];
}

const grams = (weight) => Number(weight).toFixed(2);

module.exports = { readDownload, parseCsv, countBy, grams };
