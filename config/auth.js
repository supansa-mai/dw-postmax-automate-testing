const path = require('path');

// Saved User Portal session (git-ignored), written by tests/auth.setup.js
const USER_STATE = path.join(__dirname, '..', 'playwright', '.auth', 'user.json');

// Future items prepared by tests/eod.setup.js (git-ignored), read by the specs of the eod project
const EOD_STATE = path.join(__dirname, '..', 'playwright', '.eod', 'items.json');

// Saved Drop Off session (git-ignored), written by tests/auth.setup.js
const DROPOFF_STATE = path.join(__dirname, '..', 'playwright', '.auth', 'dropoff.json');

// Saved User Portal sessions of the normal (non-TSD) and TSD users, written by tests/auth.setup.js
const NORMAL_STATE = path.join(__dirname, '..', 'playwright', '.auth', 'normal.json');
const TSD_STATE = path.join(__dirname, '..', 'playwright', '.auth', 'tsd.json');

// Saved Back Office session, written by tests/auth.setup.js
const ADMIN_STATE = path.join(__dirname, '..', 'playwright', '.auth', 'admin.json');

module.exports = { USER_STATE, DROPOFF_STATE, NORMAL_STATE, TSD_STATE, ADMIN_STATE, EOD_STATE };
