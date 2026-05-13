'use strict';

// backend/middleware/verifyToken.js
//
// Verifies the Firebase ID token sent in the Authorization header.
// On success: sets req.uid to the verified user's uid.
// On failure: returns 401.
//
// Usage:
//   var verifyToken = require('../middleware/verifyToken');
//   router.post('/hint', verifyToken, async function(req, res) {
//     var uid = req.uid; // safe — verified by Firebase
//   });

var admin = require('../firebaseAdmin');

module.exports = async function verifyToken(req, res, next) {
  var authHeader = req.headers.authorization || '';
  var token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token.' });
  }

  try {
    var decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid; // attach verified uid to request
    next();
  } catch(e) {
    console.error('[verifyToken] Invalid token:', e.message);
    return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  }
};