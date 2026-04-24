// Run: node backend/scripts/testPiston.js
// Verifies Piston API is reachable and C++ compiles correctly.

var https = require('https');

var TEST_CODE = '#include <bits/stdc++.h>\nusing namespace std;\nint main(){\ncout<<"hello"<<endl;\nreturn 0;\n}';

var body = JSON.stringify({
  language: 'c++',
  version:  '*',
  files: [{ name: 'solution.cpp', content: TEST_CODE }],
  stdin: '',
});

var opts = {
  hostname: 'emkc.org',
  port: 443,
  path: '/api/v2/piston/execute',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

console.log('Sending C++ test to Piston...');
var req = https.request(opts, function(res) {
  var raw = '';
  res.on('data', function(d) { raw += d; });
  res.on('end', function() {
    var data = JSON.parse(raw);
    console.log('Full response:', JSON.stringify(data, null, 2));
    if (data.run && data.run.stdout) {
      console.log('✓ C++ works! stdout:', data.run.stdout.trim());
    } else if (data.message) {
      console.log('✗ API error:', data.message);
    } else if (data.compile && data.compile.code !== 0) {
      console.log('✗ Compile error:', data.compile.stderr);
    } else {
      console.log('✗ Unexpected result');
    }
  });
});
req.on('error', function(e) { console.error('Network error:', e.message); });
req.write(body);
req.end();