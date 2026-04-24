'use strict';

// backend/routes/premium.js
// Razorpay integration for DSA Quest Premium
// POST /api/premium/create-order  — creates a Razorpay order
// POST /api/premium/verify        — verifies payment signature + activates premium

var express  = require('express');
var https    = require('https');
var crypto   = require('crypto');
var router   = express.Router();
var admin    = require('../firebaseAdmin');

var RZP_KEY_ID     = process.env.RAZORPAY_KEY_ID     || '';
var RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

var PLANS = {
  monthly: { amount: 9900,  currency: 'INR', description: 'DSA Quest Premium — 1 Month',  days: 30  },
  yearly:  { amount: 79900, currency: 'INR', description: 'DSA Quest Premium — 1 Year',   days: 365 },
};

function razorpayRequest(path, body) {
  return new Promise(function(resolve, reject) {
    var auth = Buffer.from(RZP_KEY_ID + ':' + RZP_KEY_SECRET).toString('base64');
    var bodyStr = JSON.stringify(body);
    var opts = {
      hostname: 'api.razorpay.com',
      path:     path,
      method:   'POST',
      headers: {
        'Authorization':  'Basic ' + auth,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
      timeout: 10000,
    };
    var req = https.request(opts, function(res) {
      var raw = '';
      res.setEncoding('utf8');
      res.on('data', function(d) { raw += d; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch(e) { reject(new Error('Razorpay parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(new Error('Razorpay timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// ── Create order ───────────────────────────────────────────────
router.post('/create-order', async function(req, res) {
  var { plan, uid } = req.body;
  if (!plan || !PLANS[plan]) return res.status(400).json({ error: 'Invalid plan.' });
  if (!uid) return res.status(400).json({ error: 'User ID required.' });

  var p = PLANS[plan];
  try {
    var result = await razorpayRequest('/v1/orders', {
      amount:   p.amount,
      currency: p.currency,
      receipt:  'dsa_' + uid + '_' + Date.now(),
      notes:    { uid, plan },
    });

    if (result.status !== 200) {
      return res.status(500).json({ error: 'Could not create order: ' + JSON.stringify(result.data) });
    }

    res.json({
      orderId:     result.data.id,
      amount:      result.data.amount,
      currency:    result.data.currency,
      keyId:       RZP_KEY_ID,
      description: p.description,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Verify payment ─────────────────────────────────────────────
router.post('/verify', async function(req, res) {
  var { razorpay_order_id, razorpay_payment_id, razorpay_signature, uid, plan } = req.body;

  // Verify HMAC signature
  var body      = razorpay_order_id + '|' + razorpay_payment_id;
  var expected  = crypto.createHmac('sha256', RZP_KEY_SECRET)
    .update(body).digest('hex');

  if (expected !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment verification failed.' });
  }

  // Activate premium in Firestore
  var p       = PLANS[plan] || PLANS.monthly;
  var expires = new Date(Date.now() + p.days * 24 * 60 * 60 * 1000);

  try {
    await admin.firestore().collection('users').doc(uid).set({
      premium:          true,
      premiumPlan:      plan,
      premiumExpiresAt: expires,
      premiumActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastPaymentId:    razorpay_payment_id,
    }, { merge: true });

    console.log('[Premium] Activated for', uid, 'plan:', plan, 'expires:', expires);
    res.json({ success: true, expiresAt: expires.toISOString() });
  } catch(e) {
    res.status(500).json({ error: 'Could not activate premium: ' + e.message });
  }
});

// ── Get status ─────────────────────────────────────────────────
router.get('/status/:uid', async function(req, res) {
  try {
    var snap = await admin.firestore().collection('users').doc(req.params.uid).get();
    if (!snap.exists) return res.json({ premium: false });
    var data = snap.data();
    var expired = data.premiumExpiresAt && data.premiumExpiresAt.toDate() < new Date();
    res.json({
      premium:    data.premium && !expired,
      plan:       data.premiumPlan,
      expiresAt:  data.premiumExpiresAt?.toDate()?.toISOString(),
      expired:    expired,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;