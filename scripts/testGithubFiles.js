require('dotenv').config();
var https = require('https');
var REPO  = process.env.GITHUB_REPO || 'chron303/CodeZ';

function check(path) {
  return new Promise(function(resolve) {
    var opts = {
      hostname: 'raw.githubusercontent.com',
      path:     '/' + REPO + '/main' + path,
      method:   'GET',
      headers:  { 'User-Agent': 'dsa-quest/1.0' },
      timeout:  8000,
    };
    var req = https.request(opts, function(res) {
      resolve({ path: path, status: res.statusCode });
    });
    req.on('error', function() { resolve({ path: path, status: 0 }); });
    req.on('timeout', function() { req.destroy(); resolve({ path: path, status: 0 }); });
    req.end();
  });
}

async function main() {
  var files = [
    '/problems.index.json',
    '/problems/two-sum.json',
    '/problems/best-time-to-buy-and-sell-stock.json',
    '/comments/two-sum.json',
    '/comments/best-time-to-buy-and-sell-stock.json',
    '/solutions/cpp/two-sum.cpp',
    '/solutions/cpp/best-time-to-buy-and-sell-stock.cpp',
    '/solutions/python/two-sum.py',
    '/solutions/python/best-time-to-buy-and-sell-stock.py',
  ];
  for (var f of files) {
    var r = await check(f);
    console.log(r.status === 200 ? '✓' : '✗', r.status, r.path);
  }
}
main();