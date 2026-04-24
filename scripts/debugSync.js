// Debug exactly what the sync does for problem 002
require('dotenv').config();

var https = require('https');
var REPO  = process.env.GITHUB_REPO || 'chron303/CodeZ';

function fetchRaw(path) {
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
  // 1. Fetch index from GitHub
  console.log('Fetching index from GitHub...');
  var r = await fetchRaw('/problems.index.json');
  console.log('HTTP:', r.status);
  
  var index = JSON.parse(r.body);
  var p002  = index.problems[1];
  
  console.log('\nProblem 002 in GitHub index:');
  console.log('  id:   ', p002.id);
  console.log('  title:', p002.title);
  console.log('  slug: ', p002.slug || '(NO SLUG FIELD)');
  
  // 2. Build path exactly like githubSync does
  var slug = p002.slug ||
    p002.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  var filePath = '/problems/' + p002.id + '-' + slug + '.json';
  
  console.log('\nPath being fetched:', filePath);
  
  var r2 = await fetchRaw(filePath);
  console.log('HTTP:', r2.status);
  
  if (r2.status === 200) {
    console.log('✓ File found!');
  } else {
    console.log('✗ File NOT found');
    // Try the other slug
    var altSlug = 'best-time-to-buy-sell-stock';
    var altPath = '/problems/002-' + altSlug + '.json';
    console.log('\nTrying alternative path:', altPath);
    var r3 = await fetchRaw(altPath);
    console.log('HTTP:', r3.status, r3.status === 200 ? '✓ Found!' : '✗ Not found');
  }
}

main().catch(console.error);