'use strict';

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
    var auth    = Buffer.from(RZP_KEY_ID + ':' + RZP_KEY_SECRET).toString('base64');
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

// ── POST /api/premium/create-order ────────────────────────────
router.post('/create-order', async function(req, res) {
  var { plan, uid } = req.body;
  if (!plan || !PLANS[plan]) return res.status(400).json({ error: 'Invalid plan.' });
  if (!uid)                   return res.status(400).json({ error: 'User ID required.' });

  var p = PLANS[plan];
  try {
    var result = await razorpayRequest('/v1/orders', {
      amount:   p.amount,
      currency: p.currency,
      receipt:  'dsa_' + uid.slice(0,8) + '_' + Date.now(),
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

// ── POST /api/premium/verify ───────────────────────────────────
router.post('/verify', async function(req, res) {
  var { razorpay_order_id, razorpay_payment_id, razorpay_signature, uid, plan } = req.body;

  // Verify HMAC
  var body      = razorpay_order_id + '|' + razorpay_payment_id;
  var expected  = crypto.createHmac('sha256', RZP_KEY_SECRET).update(body).digest('hex');
  if (expected !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment verification failed.' });
  }

  var p   = PLANS[plan] || PLANS.monthly;
  var db  = admin.firestore();
  var ref = db.collection('users').doc(uid);

  try {
    var snap = await ref.get();
    var existing = snap.exists ? snap.data() : {};

    // Calculate new expiry — extend if already premium
    var now     = new Date();
    var currentExpiry = existing.premiumExpiresAt
      ? (existing.premiumExpiresAt.toDate ? existing.premiumExpiresAt.toDate() : new Date(existing.premiumExpiresAt))
      : now;

    // If still active, extend from current expiry. Otherwise start from now.
    var baseDate   = (existing.premium && currentExpiry > now) ? currentExpiry : now;
    var newExpiry  = new Date(baseDate.getTime() + p.days * 24 * 60 * 60 * 1000);
    var isRenewal  = existing.premium && currentExpiry > now;

    // Payment record
    var payment = {
      paymentId:  razorpay_payment_id,
      orderId:    razorpay_order_id,
      plan:       plan,
      amount:     p.amount,
      currency:   'INR',
      paidAt:     now.toISOString(),
      expiresAt:  newExpiry.toISOString(),
      type:       isRenewal ? 'renewal' : 'new',
    };

    await ref.set({
      premium:             true,
      premiumPlan:         plan,
      premiumExpiresAt:    newExpiry,
      premiumActivatedAt:  existing.premiumActivatedAt || admin.firestore.FieldValue.serverTimestamp(),
      premiumGrantedBy:    'razorpay',
      lastPaymentId:       razorpay_payment_id,
      lastPaymentAt:       admin.firestore.FieldValue.serverTimestamp(),
      paymentHistory:      admin.firestore.FieldValue.arrayUnion(payment),
    }, { merge: true });

    console.log('[Premium]', isRenewal ? 'Renewed' : 'Activated', 'for', uid,
      '| plan:', plan, '| expires:', newExpiry.toISOString());

    res.json({
      success:   true,
      expiresAt: newExpiry.toISOString(),
      extended:  isRenewal,
      plan:      plan,
    });
  } catch(e) {
    res.status(500).json({ error: 'Could not activate premium: ' + e.message });
  }
});

// ── GET /api/premium/status/:uid ──────────────────────────────
router.get('/status/:uid', async function(req, res) {
  try {
    var snap = await admin.firestore().collection('users').doc(req.params.uid).get();
    if (!snap.exists) return res.json({ premium: false });

    var data    = snap.data();
    var expires = data.premiumExpiresAt
      ? (data.premiumExpiresAt.toDate ? data.premiumExpiresAt.toDate() : new Date(data.premiumExpiresAt))
      : null;
    var active  = data.premium && (!expires || expires > new Date());

    res.json({
      premium:    active,
      plan:       data.premiumPlan || null,
      expiresAt:  expires?.toISOString() || null,
      grantedBy:  data.premiumGrantedBy || null,
      payments:   (data.paymentHistory || []).slice(-5), // last 5 payments
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/premium/admin-grant ─────────────────────────────
// Admin can manually grant premium to any user with custom dates
router.post('/admin-grant', async function(req, res) {
  var { uid, plan, days, adminKey } = req.body;

  if (adminKey !== process.env.ADMIN_SYNC_KEY) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }
  if (!uid) return res.status(400).json({ error: 'uid required.' });

  var daysCount = days || (plan === 'yearly' ? 365 : 30);
  var expiresAt = new Date(Date.now() + daysCount * 24 * 60 * 60 * 1000);

  try {
    await admin.firestore().collection('users').doc(uid).set({
      premium:             true,
      premiumPlan:         plan || 'monthly',
      premiumExpiresAt:    expiresAt,
      premiumActivatedAt:  admin.firestore.FieldValue.serverTimestamp(),
      premiumGrantedBy:    'admin',
      paymentHistory:      admin.firestore.FieldValue.arrayUnion({
        paymentId:  'admin_grant_' + Date.now(),
        plan:       plan || 'monthly',
        amount:     0,
        paidAt:     new Date().toISOString(),
        expiresAt:  expiresAt.toISOString(),
        type:       'admin_grant',
      }),
    }, { merge: true });

    console.log('[Premium] Admin granted to', uid, 'for', daysCount, 'days');
    res.json({ success: true, expiresAt: expiresAt.toISOString() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;