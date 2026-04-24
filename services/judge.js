'use strict';

var express    = require('express');
var https      = require('https');
var langRunner = require('../services/langRunner');

var router = express.Router();

// GET /api/judge/runtimes — proxy Piston runtimes for debugging
router.get('/runtimes', function(req, res) {
  var options = {
    hostname: 'emkc.org',
    path:     '/api/v2/piston/runtimes',
    method:   'GET',
    headers:  { 'Accept': 'application/json' },
    timeout:  10000,
  };
  var request = https.request(options, function(response) {
    var body = '';
    response.on('data', function(chunk) { body += chunk; });
    response.on('end', function() {
      try {
        var runtimes = JSON.parse(body);
        // Filter to just the ones we care about
        var relevant = runtimes.filter(function(r) {
          return ['python', 'c++', 'java', 'cpp'].indexOf(r.language) !== -1;
        });
        res.json(relevant);
      } catch (e) {
        res.status(500).json({ error: 'Could not parse Piston response' });
      }
    });
  });
  request.on('error', function(err) {
    res.status(503).json({ error: 'Cannot reach Piston: ' + err.message });
  });
  request.end();
});

// POST /api/judge/run
router.post('/run', function(req, res, next) {
  var language  = req.body.language || 'python';
  var code      = req.body.code || '';
  var testCases = req.body.testCases;

  if (!Array.isArray(testCases) || testCases.length === 0) {
    return res.status(400).json({ error: 'testCases array is required.' });
  }

  if (['python', 'cpp', 'java'].indexOf(language) === -1) {
    return res.status(400).json({ error: 'Language must be python, cpp, or java.' });
  }

  if (!code.trim()) {
    return res.json({
      results: testCases.map(function(tc) {
        return { id: tc.id, label: tc.label, passed: false,
          status: 'No Code', input: tc.input, expected: tc.expected, actual: null };
      }),
      passed: 0, total: testCases.length, verdict: 'No Code', allPassed: false,
    });
  }

  langRunner.runTests(language, code, testCases)
    .then(function(result) { res.json(result); })
    .catch(function(err)   { next(err); });
});

module.exports = router;