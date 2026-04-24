// Tests the ACTUAL backend /api/judge/run endpoint
// Run: node backend/scripts/testBackendEndpoint.js
// Make sure backend is running on port 4000 first

var http = require('http');

var code = [
  '#include <bits/stdc++.h>',
  'using namespace std;',
  'int main() {',
  '    int n; cin >> n;',
  '    vector<int> nums(n);',
  '    for (int i = 0; i < n; i++) cin >> nums[i];',
  '    int target; cin >> target;',
  '    unordered_map<int,int> seen;',
  '    for (int i = 0; i < n; i++) {',
  '        int c = target - nums[i];',
  '        if (seen.count(c)) { cout << "[" << seen[c] << "," << i << "]" << endl; return 0; }',
  '        seen[nums[i]] = i;',
  '    }',
  '    return 0;',
  '}',
].join('\n');

var body = JSON.stringify({
  language: 'cpp',
  code: code,
  testCases: [
    { id: 1, input: '[[2,7,11,15],9]', stdinLines: '4\n2 7 11 15\n9', expected: '[0,1]', label: 'Basic' },
  ],
});

var opts = {
  hostname: 'localhost',
  port: 4000,
  path: '/api/judge/run',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
  timeout: 30000,
};

console.log('Hitting backend at localhost:4000/api/judge/run...\n');

var req = http.request(opts, function(res) {
  var raw = '';
  res.on('data', function(d) { raw += d; });
  res.on('end', function() {
    try {
      var data = JSON.parse(raw);
      console.log('Verdict:', data.verdict);
      console.log('Passed:', data.passed, '/', data.total);
      if (data.results && data.results[0]) {
        var r = data.results[0];
        console.log('Status:', r.status);
        console.log('Actual:', r.actual);
        console.log('Error:', r.error);
      }
    } catch(e) {
      console.log('Raw response:', raw.slice(0, 300));
    }
  });
});

req.on('error', function(e) {
  console.error('Cannot reach backend:', e.message);
  console.error('Make sure backend is running: cd backend && npm run dev');
});
req.write(body);
req.end();