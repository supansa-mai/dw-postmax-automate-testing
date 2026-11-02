const path = require('path');

// Saved User Portal session (git-ignored), written by tests/auth.setup.js
const USER_STATE = path.join(__dirname, '..', 'playwright', '.auth', 'user.json');

// Future items prepared by tests/eod.setup.js (git-ignored), read by the specs of the eod project
const EOD_STATE = path.join(__dirname, '..', 'playwright', '.eod', 'items.json');

module.exports = { USER_STATE, EOD_STATE };
