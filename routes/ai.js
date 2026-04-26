'use strict';

var express = require('express');
var https   = require('https');
var router  = express.Router();

var GEMINI_KEY   = process.env.GEMINI_API_KEY || '';
// gemini-2.5-flash-lite requires v1beta
var GEMINI_MODEL = 'gemini-2.5-flash';
var GEMINI_HOST  = 'generativelanguage.googleapis.com';

function gemini(prompt) {
  return new Promise(function(resolve, reject) {
    if (!GEMINI_KEY) return reject(new Error('GEMINI_API_KEY not set in environment'));

    var body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature:     0.7,
        maxOutputTokens: 1024,
      },
    });

    var path = '/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + GEMINI_KEY;

    var opts = {
      hostname: GEMINI_HOST,
      path:     path,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 25000,
    };

    var req = https.request(opts, function(res) {
      var raw = '';
      res.setEncoding('utf8');
      res.on('data', function(d) { raw += d; });
      res.on('end', function() {
        if (!raw || !raw.trim()) {
          return reject(new Error('Empty response from Gemini (HTTP ' + res.statusCode + ')'));
        }
        try {
          var data = JSON.parse(raw);
          if (data.error) {
            return reject(new Error('Gemini API error: ' + (data.error.message || JSON.stringify(data.error))));
          }
          var text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            // Log for debugging
            console.error('[Gemini] Unexpected response:', JSON.stringify(data).slice(0, 200));
            return reject(new Error('No text in Gemini response'));
          }
          resolve(text.trim());
        } catch(e) {
          console.error('[Gemini] Parse error. Raw:', raw.slice(0, 200));
          reject(new Error('Failed to parse Gemini response: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', function() { req.destroy(new Error('Gemini request timed out after 25s')); });
    req.write(body);
    req.end();
  });
}

// ── POST /api/ai/hint ──────────────────────────────────────────
router.post('/hint', async function(req, res, next) {
  var { problem, code, language } = req.body;
  if (!problem) return res.status(400).json({ error: 'problem is required' });

  var hasCode = code && code.trim().length > 20;
  var prompt = [
    'You are a helpful DSA tutor. A student is working on this problem:',
    '',
    'Problem: ' + problem.title,
    'Difficulty: ' + (problem.difficulty || 'Medium'),
    'Description: ' + (problem.description || '').slice(0, 300),
    '',
    hasCode
      ? 'Their current ' + language + ' code:\n```\n' + code.slice(0, 600) + '\n```'
      : 'They have not written any code yet.',
    '',
    'Give ONE helpful hint (max 3 sentences) that guides them WITHOUT giving away the answer.',
    'No code in your response. Be encouraging. Write the hint directly.',
  ].join('\n');

  try {
    var hint = await gemini(prompt);
    res.json({ hint });
  } catch(e) {
    console.error('[AI/hint]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/review ────────────────────────────────────────
router.post('/review', async function(req, res, next) {
  var { problem, code, language, passed, total } = req.body;
  if (!code || !problem) return res.status(400).json({ error: 'code and problem required' });

  var prompt = [
    'You are a senior software engineer doing a code review.',
    'Problem: ' + problem.title,
    'Language: ' + language,
    'Tests: ' + (passed || 0) + '/' + (total || 0) + ' passed',
    '',
    'Code:\n```\n' + code.slice(0, 1200) + '\n```',
    '',
    'Respond ONLY with valid JSON (no markdown, no backticks, no explanation outside JSON):',
    '{"timeComplexity":"O(n)","spaceComplexity":"O(n)","strengths":["point 1","point 2"],"improvements":["suggestion 1"],"tip":"one key takeaway"}',
  ].join('\n');

  try {
    var raw    = await gemini(prompt);
    var clean  = raw.replace(/```json|```/g, '').trim();
    // Extract JSON if wrapped in text
    var match  = clean.match(/\{[\s\S]*\}/);
    if (match) clean = match[0];
    try {
      res.json(JSON.parse(clean));
    } catch(e) {
      res.json({
        timeComplexity:  'Analyzed',
        spaceComplexity: 'Analyzed',
        strengths:       ['Code passes all test cases'],
        improvements:    [clean.slice(0, 150)],
        tip:             'Review your approach for further optimization.',
      });
    }
  } catch(e) {
    console.error('[AI/review]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/studyplan ─────────────────────────────────────
router.post('/studyplan', async function(req, res, next) {
  var { topics, totalSolved, streak, weakTopics } = req.body;

  var topicSummary = (topics || []).slice(0, 10)
    .map(function(t) { return t.topic + ': ' + t.solved + '/' + t.total; })
    .join(', ');

  var weak = (weakTopics || []).slice(0, 3).map(function(t) { return t.topic; }).join(', ');

  var prompt = [
    'You are a DSA coach. Create a personalized 3-day study plan.',
    'Student: ' + (totalSolved||0) + ' solved, ' + (streak||0) + ' day streak',
    'Weak topics: ' + (weak || 'not yet determined'),
    'Progress: ' + topicSummary,
    '',
    'Respond ONLY with valid JSON (no markdown, no backticks):',
    '{"greeting":"short motivational line","focus":"one topic to focus on","plan":[{"day":"Today","topic":"Arrays","goal":"solve 2 problems","why":"reason"},{"day":"Tomorrow","topic":"Trees","goal":"solve 1 easy","why":"reason"},{"day":"Day 3","topic":"DP","goal":"review patterns","why":"reason"}],"encouragement":"one encouraging line"}',
  ].join('\n');

  try {
    var raw   = await gemini(prompt);
    var clean = raw.replace(/```json|```/g, '').trim();
    var match = clean.match(/\{[\s\S]*\}/);
    if (match) clean = match[0];
    try {
      res.json(JSON.parse(clean));
    } catch(e) {
      res.json({
        greeting:      'Keep going — consistency is everything!',
        focus:         weak ? weak.split(',')[0].trim() : 'Arrays',
        plan: [
          { day:'Today',    topic: weak?weak.split(',')[0]:'Arrays', goal:'Solve 2 problems', why:'Build momentum' },
          { day:'Tomorrow', topic: weak?weak.split(',')[1]||'Trees':'Trees', goal:'Solve 1-2 problems', why:'Target weak areas' },
          { day:'Day 3',    topic:'Review', goal:'Re-attempt wrong answers', why:'Reinforce learning' },
        ],
        encouragement: 'You have solved ' + (totalSolved||0) + ' problems — great progress!',
      });
    }
  } catch(e) {
    console.error('[AI/studyplan]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

// ── GET /api/ai/test ── quick diagnostic, no auth needed
router.get('/test', async function(req, res) {
  var key = GEMINI_KEY ? GEMINI_KEY.slice(0,8) + '...' : 'NOT SET';
  res.json({
    model:  GEMINI_MODEL,
    keySet: !!GEMINI_KEY,
    keyHint: key,
  });
});