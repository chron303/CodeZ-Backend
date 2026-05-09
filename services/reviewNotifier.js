'use strict';

// backend/services/reviewNotifier.js
//
// Sends daily spaced-repetition review reminder emails at 8am IST.
//
// Firestore structure read:
//   userReviews/{uid}/reviews/{problemId}
//     nextReview: Timestamp   — date the problem is due
//     title:      string      — problem title
//     topic:      string      — problem topic
//     difficulty: string      — Easy / Medium / Hard
//
//   users/{uid}
//     email:        string
//     displayName:  string
//     emailNotifications: bool  — opt-out flag (default: notify)
//
// Requires env vars:
//   RESEND_API_KEY  — from resend.com (free tier: 3000 emails/month)
//   FROM_EMAIL      — verified sender e.g. noreply@yourdomain.com

var https = require('https');
var admin = require('../firebaseAdmin');
var db    = admin.firestore();

var RESEND_KEY = process.env.RESEND_API_KEY || '';
var FROM_EMAIL = process.env.FROM_EMAIL     || 'noreply@dsaquest.app';

// ─── Resend email helper ──────────────────────────────────────

function sendEmail(to, subject, html) {
  return new Promise(function(resolve, reject) {
    if (!RESEND_KEY) return reject(new Error('RESEND_API_KEY not set'));

    var body = JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html });
    var opts = {
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization':  'Bearer ' + RESEND_KEY,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    };

    var req = https.request(opts, function(res) {
      var raw = '';
      res.setEncoding('utf8');
      res.on('data', function(d) { raw += d; });
      res.on('end', function() {
        if (res.statusCode >= 400)
          return reject(new Error('Resend ' + res.statusCode + ': ' + raw.slice(0, 120)));
        resolve();
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(new Error('Resend timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── Email template ───────────────────────────────────────────

function buildEmailHTML(displayName, dueProblems) {
  const DIFF_COLOR = { Easy: '#10b981', Medium: '#f59e0b', Hard: '#ef4444' };

  const rows = dueProblems.map(function(p) {
    const color = DIFF_COLOR[p.difficulty] || '#94a3b8';
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="padding:10px 16px;font-size:13px;color:#e2e8f0;">${p.title}</td>
        <td style="padding:10px 16px;font-size:12px;color:#64748b;">${p.topic || ''}</td>
        <td style="padding:10px 16px;font-size:12px;color:${color};font-weight:600;">${p.difficulty}</td>
      </tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f0e17;font-family:'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="520" cellpadding="0" cellspacing="0"
        style="background:#1a1830;border-radius:16px;border:1px solid rgba(124,58,237,0.3);overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#7c3aed,#1d4ed8);padding:28px 32px;">
          <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.5px;">
            🎮 DSA Quest — Review Time!
          </h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">
            You have ${dueProblems.length} problem${dueProblems.length !== 1 ? 's' : ''} due for review today.
          </p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 20px;color:#94a3b8;font-size:14px;line-height:1.6;">
            Hey ${displayName || 'there'}! Your spaced repetition schedule has
            ${dueProblems.length} problem${dueProblems.length !== 1 ? 's' : ''} ready for review.
            Reviewing now keeps them fresh and builds long-term retention. 🧠
          </p>

          <!-- Table -->
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background:#0f0e17;border-radius:10px;overflow:hidden;margin-bottom:24px;">
            <thead>
              <tr style="background:rgba(124,58,237,0.15);">
                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;
                  text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Problem</th>
                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;
                  text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Topic</th>
                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;
                  text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Diff</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>

          <!-- CTA -->
          <div style="text-align:center;">
            <a href="https://dsaquest.vercel.app/practice"
              style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#7c3aed,#1d4ed8);
                color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">
              Start Reviewing →
            </a>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid rgba(255,255,255,0.05);">
          <p style="margin:0;color:#334155;font-size:11px;text-align:center;">
            DSA Quest · You're receiving this because you have reviews due.<br>
            <a href="https://dsaquest.vercel.app/profile"
              style="color:#4b5563;text-decoration:underline;">Manage notification preferences</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Today's date string in IST (YYYY-MM-DD) ──────────────────

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// ─── Main notifier ────────────────────────────────────────────

async function sendReviewNotifications() {
  const today = todayIST();
  console.log('[ReviewNotifier] Running for date:', today);

  if (!RESEND_KEY) {
    console.warn('[ReviewNotifier] RESEND_API_KEY not set — skipping email sends');
    return { skipped: 0, sent: 0, errors: 0 };
  }

  // ── Step 1: get all users ──────────────────────────────────
  let usersSnap;
  try {
    usersSnap = await db.collection('users').get();
  } catch(e) {
    console.error('[ReviewNotifier] Failed to fetch users:', e.message);
    return { skipped: 0, sent: 0, errors: 1 };
  }

  let sent = 0, skipped = 0, errors = 0;

  // ── Step 2: for each user, find due reviews ────────────────
  for (const userDoc of usersSnap.docs) {
    const uid      = userDoc.id;
    const userData = userDoc.data();

    // Respect opt-out — default is to notify (undefined = notify)
    if (userData.emailNotifications === false) { skipped++; continue; }

    const email       = userData.email;
    const displayName = userData.displayName || '';

    if (!email) { skipped++; continue; }

    let reviewsSnap;
    try {
      reviewsSnap = await db
        .collection('userReviews').doc(uid)
        .collection('reviews')
        .get();
    } catch(e) {
      console.error('[ReviewNotifier] Failed reviews for', uid, ':', e.message);
      errors++;
      continue;
    }

    // Filter reviews due on or before today
    const dueProblems = [];
    reviewsSnap.docs.forEach(function(d) {
      const data = d.data();
      if (!data.nextReview) return;
      const reviewDate = data.nextReview.toDate
        ? data.nextReview.toDate().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        : data.nextReview; // already a string

      if (reviewDate <= today) {
        dueProblems.push({
          title:      data.title      || d.id,
          topic:      data.topic      || '',
          difficulty: data.difficulty || 'Medium',
        });
      }
    });

    if (dueProblems.length === 0) { skipped++; continue; }

    // ── Step 3: send email ─────────────────────────────────────
    try {
      await sendEmail(
        email,
        `🎮 ${dueProblems.length} DSA problem${dueProblems.length !== 1 ? 's' : ''} due for review today`,
        buildEmailHTML(displayName, dueProblems)
      );
      console.log('[ReviewNotifier] Sent to', email, '—', dueProblems.length, 'problems');
      sent++;
    } catch(e) {
      console.error('[ReviewNotifier] Email failed for', email, ':', e.message);
      errors++;
    }

    // Small delay between sends to stay within Resend rate limits
    await new Promise(function(r) { setTimeout(r, 200); });
  }

  console.log('[ReviewNotifier] Done — sent:', sent, '| skipped:', skipped, '| errors:', errors);
  return { sent, skipped, errors };
}

module.exports = { sendReviewNotifications };