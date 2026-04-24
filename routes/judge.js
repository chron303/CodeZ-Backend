'use strict';

var express    = require('express');
var langRunner = require('../services/langRunner');

var router = express.Router();

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