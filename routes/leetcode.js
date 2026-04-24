'use strict';

var https  = require('https');
var express = require('express');
var router  = express.Router();

// Updated query using current LeetCode GraphQL schema
var STATS_QUERY = `
query getUserProfile($username: String!) {
  matchedUser(username: $username) {
    username
    submitStats: submitStatsGlobal {
      acSubmissionNum {
        difficulty
        count
      }
    }
  }
  recentAcSubmissionList(username: $username, limit: 50) {
    title
    titleSlug
    timestamp
  }
}`;

function callLeetCode(username) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      query:     STATS_QUERY,
      variables: { username: username },
    });

    var opts = {
      hostname: 'leetcode.com',
      path:     '/graphql',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Referer':        'https://leetcode.com',
        'Origin':         'https://leetcode.com',
        'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept':         'application/json',
        'Accept-Language':'en-US,en;q=0.9',
        'x-csrftoken':    'dummy',
      },
      timeout: 15000,
    };

    var req = https.request(opts, function(res) {
      var raw = '';
      res.setEncoding('utf8');
      res.on('data', function(d) { raw += d; });
      res.on('end', function() {
        console.log('[LeetCode] HTTP', res.statusCode);
        console.log('[LeetCode] Body:', raw.slice(0, 300));
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch(e) {
          reject(new Error('LeetCode invalid JSON: ' + raw.slice(0, 100)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', function() { req.destroy(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

router.get('/:username', async function(req, res, next) {
  var username = (req.params.username || '').trim();
  if (!username || username.length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters.' });
  }

  try {
    var result = await callLeetCode(username);
    var data   = result.data;

    // Log for debugging
    console.log('[LeetCode] matchedUser:', JSON.stringify(data?.data?.matchedUser).slice(0,100));
    console.log('[LeetCode] recentAc:', JSON.stringify(data?.data?.recentAcSubmissionList).slice(0,100));

    if (result.status === 429) {
      return res.status(429).json({ error: 'LeetCode rate limit hit. Try again in a minute.' });
    }

    if (data?.errors) {
      console.error('[LeetCode] GraphQL errors:', data.errors);
    }

    var matchedUser = data?.data?.matchedUser;
    if (!matchedUser) {
      return res.status(404).json({
        error: 'User "' + username + '" not found on LeetCode. Check the username exactly as shown on your profile.',
      });
    }

    var stats  = matchedUser.submitStats?.acSubmissionNum || [];
    var recent = data?.data?.recentAcSubmissionList || [];

    function getCount(diff) {
      var s = stats.find(function(x) { return x.difficulty === diff; });
      return s ? s.count : 0;
    }

    res.json({
      username:     matchedUser.username,
      totalSolved:  getCount('All'),
      easySolved:   getCount('Easy'),
      mediumSolved: getCount('Medium'),
      hardSolved:   getCount('Hard'),
      recentSolved: recent.map(function(s) {
        return {
          title:     s.title,
          slug:      s.titleSlug,
          timestamp: parseInt(s.timestamp) * 1000,
        };
      }),
    });
  } catch(e) {
    console.error('[LeetCode] Error:', e.message);
    res.status(503).json({ error: 'Could not reach LeetCode: ' + e.message });
  }
});

module.exports = router;