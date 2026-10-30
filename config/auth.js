const path = require('path');

// Saved User Portal session (git-ignored), written by tests/auth.setup.js
const USER_STATE = path.join(__dirname, '..', 'playwright', '.auth', 'user.json');

module.exports = { USER_STATE };
