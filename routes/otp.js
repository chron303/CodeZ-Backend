'use strict';

// backend/routes/otp.js
// Email OTP login using Resend (free — 3,000 emails/month, no card needed)
// Sign up at resend.com, get API key, add to .env as RESEND_API_KEY
//
// POST /api/otp/send   — generates OTP, emails it, stores in memory
// POST /api/otp/verify — verifies OTP, returns Firebase custom token

var express = require('express');
var https   = require('https');
var router  = express.Router();
var admin   = require('../firebaseAdmin');

var RESEND_KEY = process.env.RESEND_API_KEY || '';
var FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@yourdomain.com';

// In-memory OTP store: email → { otp, expires, attempts }
// In production replace with Redis or Firestore
var otpStore = {};

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sendEmail(to, subject, html) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      from:    FROM_EMAIL,
      to:      [to],
      subject: subject,
      html:    html,
    });

    var opts = {
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_KEY,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    };

    var req = https.request(opts, function(res) {
      var raw = '';
      res.setEncoding('utf8');
      res.on('data', function(d) { raw += d; });
      res.on('end', function() {
        if (res.statusCode >= 400) {
          return reject(new Error('Resend error ' + res.statusCode + ': ' + raw.slice(0,100)));
        }
        resolve(JSON.parse(raw));
      });
    });

    req.on('error', reject);
    req.on('timeout', function() { req.destroy(new Error('Email timeout')); });
    req.write(body);
    req.end();
  });
}

function otpEmailHTML(otp, email) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f0e17;font-family:'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="480" cellpadding="0" cellspacing="0"
        style="background:#1a1830;border-radius:16px;border:1px solid rgba(124,58,237,0.3);overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#7c3aed,#1d4ed8);padding:28px 32px;">
          <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">
            🎮 DSA Quest
          </h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">
            Your login code
          </p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 20px;color:#94a3b8;font-size:14px;line-height:1.6;">
            Hi there! Here's your one-time login code for DSA Quest.
            It expires in <strong style="color:#c4b5fd;">10 minutes</strong>.
          </p>

          <!-- OTP Box -->
          <div style="background:#0f0e17;border:2px solid rgba(124,58,237,0.5);border-radius:12px;
            padding:24px;text-align:center;margin:0 0 24px;">
            <p style="margin:0 0 8px;color:#64748b;font-size:12px;letter-spacing:2px;text-transform:uppercase;">
              Your login code
            </p>
            <p style="margin:0;font-size:42px;font-weight:800;letter-spacing:12px;
              color:#a78bfa;font-family:monospace;">
              ${otp}
            </p>
          </div>

          <p style="margin:0 0 8px;color:#475569;font-size:12px;line-height:1.6;">
            Signing in as: <strong style="color:#94a3b8;">${email}</strong>
          </p>
          <p style="margin:0;color:#475569;font-size:12px;line-height:1.6;">
            If you didn't request this, ignore this email.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid rgba(255,255,255,0.05);">
          <p style="margin:0;color:#334155;font-size:11px;text-align:center;">
            DSA Quest · Level up your coding skills
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── POST /api/otp/send ─────────────────────────────────────────
router.post('/send', async function(req, res) {
  var email = (req.body.email || '').trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  // Rate limit: 1 OTP per 60 seconds
  var existing = otpStore[email];
  if (existing && existing.expires - (10 * 60 * 1000) + (60 * 1000) > Date.now()) {
    return res.status(429).json({ error: 'Please wait 60 seconds before requesting another code.' });
  }

  var otp = generateOTP();
  otpStore[email] = {
    otp:      otp,
    expires:  Date.now() + 10 * 60 * 1000, // 10 minutes
    attempts: 0,
  };

  try {
    await sendEmail(
      email,
      'Your DSA Quest login code: ' + otp,
      otpEmailHTML(otp, email)
    );
    console.log('[OTP] Sent to', email);
    res.json({ success: true, message: 'Code sent to ' + email });
  } catch(e) {
    console.error('[OTP] Send failed:', e.message);
    // Still log OTP in dev for testing
    if (process.env.NODE_ENV !== 'production') {
      console.log('[OTP DEV] Code for', email, ':', otp);
    }
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});

// ── POST /api/otp/verify ───────────────────────────────────────
router.post('/verify', async function(req, res) {
  var email = (req.body.email || '').trim().toLowerCase();
  var code  = (req.body.code  || '').trim();

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required.' });
  }

  var record = otpStore[email];

  if (!record) {
    return res.status(400).json({ error: 'No code found. Please request a new one.' });
  }

  if (Date.now() > record.expires) {
    delete otpStore[email];
    return res.status(400).json({ error: 'Code expired. Please request a new one.' });
  }

  record.attempts++;
  if (record.attempts > 5) {
    delete otpStore[email];
    return res.status(400).json({ error: 'Too many attempts. Please request a new code.' });
  }

  if (record.otp !== code) {
    return res.status(400).json({
      error: 'Incorrect code. ' + (5 - record.attempts) + ' attempts remaining.',
    });
  }

  // OTP correct — clean up
  delete otpStore[email];

  try {
    // Create or get Firebase user
    var userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch(e) {
      // User doesn't exist — create them
      userRecord = await admin.auth().createUser({
        email:         email,
        emailVerified: true,
        displayName:   email.split('@')[0],
      });
      console.log('[OTP] Created new user:', email);
    }

    // Generate custom token for Firebase client auth
    var customToken = await admin.auth().createCustomToken(userRecord.uid);
    console.log('[OTP] Verified and logged in:', email);

    res.json({ success: true, token: customToken, uid: userRecord.uid });
  } catch(e) {
    console.error('[OTP] Firebase error:', e.message);
    res.status(500).json({ error: 'Authentication failed. Please try again.' });
  }
});

// Cleanup expired OTPs every 5 minutes
setInterval(function() {
  var now = Date.now();
  Object.keys(otpStore).forEach(function(email) {
    if (otpStore[email].expires < now) delete otpStore[email];
  });
}, 5 * 60 * 1000);

module.exports = router;