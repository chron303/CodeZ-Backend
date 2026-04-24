// Test what we can actually fetch from the GitHub repo
// Run: node backend/scripts/testGithubFetch.js

var https = require('https');

var REPO = 'chron303/CodeZ';

function fetch(path) {
  return new Promise(function(resolve) {
    var opts = {
      hostname: 'raw.githubusercontent.com',
      path:     '/' + REPO + '/main' + path,
      method:   'GET',
      headers:  { 'User-Agent': 'dsa-quest/1.0' },
      timeout:  10000,
    };
    var req = https.request(opts, function(res) {
      var body = '';
      res.on('data', function(d) { body += d; });
      res.on('end', function() {
        resolve({ status: res.statusCode, body: body.slice(0, 200) });
      });
    });
    req.on('error', function(e) { resolve({ status: 0, body: e.message }); });
    req.on('timeout', function() { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });
}

async function main() {
  var paths = [
    '/problems.index.json',
    '/problems/001-two-sum.json',
    '/comments/001-two-sum.json',
    '/solutions/cpp/001-two-sum.cpp',
  ];

  for (var p of paths) {
    var r = await fetch(p);
    var ok = r.status === 200 ? '✓' : '✗';
    console.log(ok, 'HTTP', r.status, p);
    if (r.status !== 200) console.log('  →', r.body.slice(0, 100));
  }
}

main();