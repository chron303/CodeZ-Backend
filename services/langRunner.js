'use strict';

// backend/services/langRunner.js
// Remote execution via Wandbox API — free, no API key needed.

var https = require('https');

var COMPILER = {
  python: { compiler: 'cpython-3.12.7',   options: '' },
  cpp:    { compiler: 'gcc-13.2.0',        options: '-std=c++17\n-O2' },
  java:   { compiler: 'openjdk-jdk-21+35', options: '' },
};

// Java: Wandbox names the file after the public class.
// We rename Solution → Main so filename = Main.java automatically.
function prepareCode(langId, code) {
  if (langId === 'java') {
    return code
      .replace(/public\s+class\s+Solution\b/g, 'public class Main')
      .replace(/\bclass\s+Solution\b/g,         'class Main');
  }
  return code;
}

function wandboxRun(langId, code, stdin) {
  return new Promise(function(resolve, reject) {
    var cfg = COMPILER[langId];
    if (!cfg) return reject(new Error('Unknown language: ' + langId));

    var finalCode = prepareCode(langId, code);

    // Wandbox requires top-level "code" field (always).
    // "codes" array is for additional files — not needed here.
    var payload = {
      compiler:              cfg.compiler,
      code:                  finalCode,
      stdin:                 stdin || '',
      'compiler-option-raw': cfg.options,
      save:                  false,
    };

    var body = JSON.stringify(payload);

    var opts = {
      hostname: 'wandbox.org',
      path:     '/api/compile.json',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'dsa-quest/1.0',
      },
      timeout: 30000,
    };

    var req = https.request(opts, function(res) {
      var raw = '';
      res.setEncoding('utf8');
      res.on('data', function(d) { raw += d; });
      res.on('end', function() {
        try {
          resolve({ data: JSON.parse(raw), status: res.statusCode });
        } catch(e) {
          reject(new Error('Wandbox bad response HTTP ' + res.statusCode + ': ' + raw.slice(0, 100)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', function() { req.destroy(new Error('Wandbox timed out')); });
    req.write(body);
    req.end();
  });
}

function norm(s) {
  if (!s) return '';
  s = String(s).replace(/\r\n/g, '\n').trim();
  try { return JSON.stringify(JSON.parse(s)); } catch(e) { return s; }
}

function fail(tc, status, error, ms) {
  return {
    id: tc.id, label: tc.label, passed: false,
    status: status, input: tc.input, expected: tc.expected,
    actual: null, error: error, timeMs: ms,
  };
}

function runOne(langId, code, tc) {
  var t0    = Date.now();
  var stdin = langId === 'python'
    ? (tc.input || '')
    : (tc.stdinLines || tc.input || '');

  return wandboxRun(langId, code, stdin)
    .then(function(res) {
      var ms = Date.now() - t0;
      var d  = res.data;

      if (res.status !== 200)
        return fail(tc, 'Network Error', 'HTTP ' + res.status, ms);
      if (d.status === 'Error' || d.compiler_error)
        return fail(tc, 'Compile Error',
          (d.compiler_error || d.compiler_message || 'Compile failed').slice(0, 800), ms);
      if (d.program_error && !d.program_output)
        return fail(tc, 'Runtime Error', d.program_error.slice(0, 800), ms);

      var got  = norm(d.program_output);
      var want = norm(tc.expected);
      var ok   = got === want;

      return {
        id: tc.id, label: tc.label, passed: ok,
        status:  ok ? 'Accepted' : 'Wrong Answer',
        input:   tc.input, expected: tc.expected,
        actual:  (d.program_output || '').trim(),
        error:   d.program_error ? d.program_error.slice(0, 400) : null,
        timeMs:  ms,
      };
    })
    .catch(function(err) {
      return fail(tc, 'Network Error', err.message, Date.now() - t0);
    });
}

function runTests(langId, code, testCases) {
  return testCases.reduce(function(chain, tc) {
    return chain.then(function(acc) {
      return runOne(langId, code, tc).then(function(r) { return acc.concat(r); });
    });
  }, Promise.resolve([]))
  .then(function(results) {
    var passed   = results.filter(function(r) { return r.passed; }).length;
    var total    = results.length;
    var statuses = results.map(function(r) { return r.status; });
    var verdict  =
      passed === total                                    ? 'Accepted'
      : statuses.indexOf('Network Error')       !== -1   ? 'Network Error'
      : statuses.indexOf('Time Limit Exceeded') !== -1   ? 'Time Limit Exceeded'
      : statuses.indexOf('Compile Error')       !== -1   ? 'Compile Error'
      : statuses.indexOf('Runtime Error')       !== -1   ? 'Runtime Error'
      :                                                     'Wrong Answer';

    return { results, passed, total, verdict, allPassed: passed === total };
  });
}

module.exports = { runTests };