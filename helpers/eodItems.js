const fs = require('fs');
const path = require('path');
const { EOD_STATE } = require('../config/auth');

function saveEodItems(items) {
  fs.mkdirSync(path.dirname(EOD_STATE), { recursive: true });
  fs.writeFileSync(EOD_STATE, JSON.stringify(items, null, 2));
}

/**
 * Future items prepared by tests/eod.setup.js:
 * `{ fileName, earlyRefCode, groups: { <name>: { batchRef, paid, unpaid } }, order: { number, batchRef, items } }`.
 * Call it inside a hook or test: specs are loaded before the setup project writes the file.
 */
function readEodItems() {
  return JSON.parse(fs.readFileSync(EOD_STATE, 'utf8'));
}

module.exports = { saveEodItems, readEodItems };
