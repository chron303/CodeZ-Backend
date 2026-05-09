'use strict';

// backend/routes/otp.js
// ─────────────────────────────────────────────────────────────────────────────
// DEPRECATED — Email OTP login has been replaced by:
//   • Firebase Email + Password (create account / sign in / forgot password)
//   • Firebase Phone Auth (SMS OTP, invisible reCAPTCHA)
//
// Both routes return 410 Gone so any stale frontend call gets a clear error
// instead of silently hanging or hitting an un-initialised in-memory store.
//
// Safe to delete this file entirely once you confirm no frontend code calls
// /api/otp/* — search for "otp" in src/ to verify.
// ─────────────────────────────────────────────────────────────────────────────

var express = require('express');
var router  = express.Router();

var GONE_MESSAGE =
  'Email OTP login has been removed. Please use Email + Password or Phone login instead.';

router.post('/send',   function(_req, res) { res.status(410).json({ error: GONE_MESSAGE }); });
router.post('/verify', function(_req, res) { res.status(410).json({ error: GONE_MESSAGE }); });

module.exports = router;