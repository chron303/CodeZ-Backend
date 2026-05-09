'use strict';

// backend/routes/leetcode.js
// Fetches LeetCode stats via alfa-leetcode-api (community proxy) instead of
// hitting leetcode.com/graphql directly — LeetCode's GraphQL blocks server-side
// requests without a valid browser session cookie.
//
// Proxy base: https://alfa-leetcode-api.onrender.com
// Endpoints used:
//   GET /:username/solved     → { solvedProblem, easySolved, mediumSolved, hardSolved }
//   GET /:username/submission → { submission: [{ title, titleSlug, timestamp, ... }] }

var https   = require('https');
var express = require('express');
var router  = express.Router();

var PROXY_HOST = 'alfa-leetcode-api.onrender.com';
var TIMEOUT_MS = 20000; // proxy can be slow on Render free tier (cold start)

// ─── Generic GET helper ───────────────────────────────────────────────────────

function proxyGet(path) {
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: PROXY_HOST,
      path:     path,
      method:   'GET',
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'dsa-quest/1.0',
      },
      timeout: TIMEOUT_MS,
    };

    var req = https.request(opts, function(res) {
      var raw = '';
      res.setEncoding('utf8');
      res.on('data', function(d) { raw += d; });
      res.on('end', function() {
        console.log('[LeetCode proxy] GET', path, '→ HTTP', res.statusCode);
        if (res.statusCode === 429) {
          return reject(Object.assign(new Error('Rate limited'), { code: 429 }));
        }
        try {
          var parsed = JSON.parse(raw);
          resolve({ status: res.statusCode, data: parsed });
        } catch(e) {
          reject(new Error('Bad JSON from proxy: ' + raw.slice(0, 100)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', function() {
      req.destroy(new Error('Proxy timed out after ' + TIMEOUT_MS + 'ms'));
    });
    req.end();
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get('/:username', async function(req, res, next) {
  var username = (req.params.username || '').trim();

  if (!username || username.length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters.' });
  }

  try {
    // Fire both requests in parallel
    var [solvedRes, submissionRes] = await Promise.all([
      proxyGet('/' + encodeURIComponent(username) + '/solved'),
      proxyGet('/' + encodeURIComponent(username) + '/submission'),
    ]);

    // ── Solved stats ──────────────────────────────────────────────────────────
    if (solvedRes.status === 404 || solvedRes.data?.errors) {
      return res.status(404).json({
        error: 'User "' + username + '" not found on LeetCode. Check the username exactly as shown on your profile.',
      });
    }

    var solved = solvedRes.data || {};

    // ── Recent submissions ────────────────────────────────────────────────────
    // Proxy returns { submission: [...] } — may be empty/missing if private
    var rawSubs = submissionRes.data?.submission || [];
    var recentSolved = rawSubs.map(function(s) {
      return {
        title:     s.title     || s.titleSlug || '',
        slug:      s.titleSlug || '',
        // proxy returns timestamp as unix seconds string or number
        timestamp: parseInt(s.timestamp) * 1000,
        lang:      s.lang || null,
        status:    s.statusDisplay || null,
      };
    });

    res.json({
      username:     username,
      totalSolved:  solved.solvedProblem  || 0,
      easySolved:   solved.easySolved     || 0,
      mediumSolved: solved.mediumSolved   || 0,
      hardSolved:   solved.hardSolved     || 0,
      recentSolved: recentSolved,
    });

  } catch(e) {
    console.error('[LeetCode proxy] Error:', e.message);

    if (e.code === 429) {
      return res.status(429).json({
        error: 'LeetCode stats service is rate-limited. Please try again in a minute.',
      });
    }

    // Proxy cold-start on Render can take ~30s — give the user a helpful message
    if (e.message.includes('timed out')) {
      return res.status(503).json({
        error: 'LeetCode stats service is warming up. Please try again in 30 seconds.',
      });
    }

    res.status(503).json({
      error: 'Could not fetch LeetCode stats: ' + e.message,
    });
  }
});

module.exports = router;