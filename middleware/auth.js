// backend/middleware/auth.js
//
// Express middleware that verifies a Firebase Auth ID token
// sent in the Authorization header as "Bearer <token>".
//
// Usage:
//   const { requireAuth, requireAdmin } = require('./middleware/auth');
//   router.post('/run', requireAuth, handler);   // any logged-in user
//   router.post('/admin', requireAdmin, handler); // isAdmin users only

'use strict';

var admin = require('../firebaseAdmin');

// Verify token — attach decoded user to req.user
async function requireAuth(req, res, next) {
  var header = req.headers.authorization || '';
  var token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    // If Firebase Admin isn't configured, skip auth (dev mode)
    if (!admin.apps.length || !admin.apps[0]) {
      req.user = { uid: 'dev-user', isAdmin: false };
      return next();
    }
    return res.status(401).json({ error: 'No auth token provided.' });
  }

  try {
    var decoded = await admin.auth().verifyIdToken(token);
    req.user    = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Only allow users with isAdmin: true in their Firestore profile
async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    if (!req.user?.uid) return res.status(401).json({ error: 'Not authenticated.' });

    try {
      var userRecord = await admin.auth().getUser(req.user.uid);
      // Check custom claims or Firestore profile
      var db     = admin.firestore();
      var snap   = await db.doc('users/' + req.user.uid).get();
      var isAdmin = snap.exists && snap.data().isAdmin === true;

      if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
      next();
    } catch (err) {
      return res.status(403).json({ error: 'Could not verify admin status.' });
    }
  });
}

module.exports = { requireAuth, requireAdmin };