// Downloaded order documents and the per-weight summaries shown for an order (User Portal and Drop Off)
const fs = require('fs');

async function readDownload(download) {
  return fs.promises.readFile(await download.path());
}

// Quoted cells may hold commas, quotes ("") and line breaks: files made by hand (e.g. on UAT) have addresses like that
function parseCsv(buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '').trim();
  const rows = [[]];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { rows[rows.length - 1].push(cell); cell = ''; } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      rows[rows.length - 1].push(cell); cell = ''; rows.push([]);
    } else cell += char;
  }
  rows[rows.length - 1].push(cell);
  const [header, ...lines] = rows;
  return lines.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i]])));
}

function countBy(values) {
  return [...values.reduce((counts, v) => counts.set(v, (counts.get(v) ?? 0) + 1), new Map())];
}

const grams = (weight) => Number(weight).toFixed(2);

module.exports = { readDownload, parseCsv, countBy, grams };
