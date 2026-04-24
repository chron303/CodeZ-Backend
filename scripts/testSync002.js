// Test fetching problem 002 specifically
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
      res.on('end', function() { resolve({ status: res.statusCode, body: body }); });
    });
    req.on('error', function(e) { resolve({ status: 0, body: e.message }); });
    req.on('timeout', function() { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });
}

async function main() {
  // First check what index says about problem 002
  var idx = await fetch('/problems.index.json');
  var index = JSON.parse(idx.body);
  console.log('Index problem 002 entry:');
  console.log(JSON.stringify(index.problems[1], null, 2));

  // The sync builds the slug from the title — let's see what path it tries
  var p = index.problems[1];
  var slug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  var path = '/problems/' + p.id + '-' + slug + '.json';
  console.log('\nExpected file path:', path);

  // Try fetching it
  var r = await fetch(path);
  console.log('HTTP status:', r.status);
  if (r.status !== 200) {
    // List what files actually exist in problems/
    console.log('\nChecking actual filename variations...');
    var attempts = [
      '/problems/002-best-time-to-buy-and-sell-stock.json',
      '/problems/002-best-time-to-buy-sell-stock.json',
      '/problems/002-best-time-to-buy-and-sell-stock .json',
    ];
    for (var a of attempts) {
      var r2 = await fetch(a);
      console.log(r2.status === 200 ? '✓' : '✗', a);
    }
  } else {
    console.log('✓ Found it!');
  }
}
main();