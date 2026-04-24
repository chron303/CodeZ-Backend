// Find correct Python and Java compiler names on Wandbox
// Run: node backend/scripts/testWandboxCompilers.js

var https = require('https');

var opts = {
  hostname: 'wandbox.org',
  path:     '/api/list.json',
  method:   'GET',
  timeout:  15000,
};

var req = https.request(opts, function(res) {
  var raw = '';
  res.on('data', function(d) { raw += d; });
  res.on('end', function() {
    var list = JSON.parse(raw);
    console.log('\n=== Python compilers ===');
    list.filter(function(c) { return c.language === 'Python'; })
        .forEach(function(c) { console.log(c.name, '|', c.version); });

    console.log('\n=== Java compilers ===');
    list.filter(function(c) { return c.language === 'Java'; })
        .forEach(function(c) { console.log(c.name, '|', c.version); });

    console.log('\n=== C++ compilers (first 5) ===');
    list.filter(function(c) { return c.language === 'C++'; })
        .slice(0, 5)
        .forEach(function(c) { console.log(c.name, '|', c.version); });
  });
});
req.on('error', function(e) { console.error(e.message); });
req.end();