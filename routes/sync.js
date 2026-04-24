'use strict';

// backend/routes/sync.js
// GET  /api/sync/run     — trigger manual sync (admin only)
// GET  /api/sync/status  — get last sync log

var express      = require('express');
var githubSync   = require('../services/githubSync');
var admin        = require('../firebaseAdmin');

var router = express.Router();

// ── Manual trigger (admin only) ────────────────────────────────
router.get('/run', async function(req, res) {
  // Simple admin check via query param or header
  // In production use requireAdmin middleware
  var adminKey = req.query.key || req.headers['x-admin-key'];
  var expectedKey = process.env.ADMIN_SYNC_KEY || 'changeme';

  if (adminKey !== expectedKey) {
    return res.status(403).json({ error: 'Unauthorized. Pass ?key=YOUR_ADMIN_SYNC_KEY' });
  }

  try {
    console.log('[Sync] Manual sync triggered');
    var log = await githubSync.syncFromGitHub();
    res.json({ success: true, log: log });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Last sync status ───────────────────────────────────────────
router.get('/status', async function(req, res) {
  try {
    var snap = await admin.firestore()
      .collection('syncLogs')
      .orderBy('startedAt', 'desc')
      .limit(1)
      .get();

    if (snap.empty) return res.json({ message: 'No sync has run yet.' });
    res.json(snap.docs[0].data());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;