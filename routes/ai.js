'use strict';

// backend/routes/ai.js
// AI features powered by Google Gemini 1.5 Flash (free tier)
// Routes:
//   POST /api/ai/hint        — get a hint for a problem
//   POST /api/ai/review      — get code review after solving
//   POST /api/ai/studyplan   — get personalized study plan

var express = require('express');
var https   = require('https');
var router  = express.Router();

var GEMINI_KEY   = process.env.GEMINI_API_KEY || '';
var GEMINI_MODEL = 'gemini-2.5-flash-lite';
var GEMINI_URL   = '/v1/models/' + GEMINI_MODEL + ':generateContent?key=';

// ── Call Gemini API ───────────────────────────────────────────
function gemini(prompt) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature:     0.7,
        maxOutputTokens: 1024,
      },
    });

    var opts = {
      hostname: 'generativelanguage.googleapis.com',
      path:     GEMINI_URL + GEMINI_KEY,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 20000,
    };

    var req = https.request(opts, function(res) {
      var raw = '';
      res.setEncoding('utf8');
      res.on('data', function(d) { raw += d; });
      res.on('end', function() {
        try {
          var data = JSON.parse(raw);
          if (data.error) return reject(new Error(data.error.message));
          var text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text.trim());
        } catch(e) {
          reject(new Error('Gemini parse error: ' + raw.slice(0, 100)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', function() { req.destroy(new Error('Gemini timeout')); });
    req.write(body);
    req.end();
  });
}

// ── POST /api/ai/hint ─────────────────────────────────────────
// Body: { problem: { title, description, difficulty }, code, language }
// Returns: { hint: string }
router.post('/hint', async function(req, res, next) {
  var { problem, code, language } = req.body;
  if (!problem) return res.status(400).json({ error: 'problem is required' });

  var hasCode = code && code.trim().length > 20;

  var prompt = [
    'You are a helpful DSA tutor. A student is working on this problem:',
    '',
    'Problem: ' + problem.title,
    'Difficulty: ' + (problem.difficulty || 'Medium'),
    'Description: ' + (problem.description || ''),
    '',
    hasCode
      ? 'Their current code (' + language + '):\n```\n' + code.slice(0, 800) + '\n```'
      : 'They have not written any code yet.',
    '',
    'Give ONE helpful hint that guides them toward the solution WITHOUT giving away the answer.',
    'Rules:',
    '- Max 3 sentences',
    '- No code in your response',
    '- Focus on the KEY INSIGHT or data structure they should think about',
    '- Be encouraging',
    'Just write the hint directly, no preamble.',
  ].join('\n');

  try {
    var hint = await gemini(prompt);
    res.json({ hint });
  } catch(e) {
    next(e);
  }
});

// ── POST /api/ai/review ───────────────────────────────────────
// Body: { problem: { title, description }, code, language, passed, total }
// Returns: { timeComplexity, spaceComplexity, strengths[], improvements[], optimized? }
router.post('/review', async function(req, res, next) {
  var { problem, code, language, passed, total } = req.body;
  if (!code || !problem) return res.status(400).json({ error: 'code and problem required' });

  var prompt = [
    'You are a senior software engineer reviewing a DSA solution.',
    '',
    'Problem: ' + problem.title,
    'Language: ' + language,
    'Test results: ' + passed + '/' + total + ' passed',
    '',
    'Code:\n```' + language + '\n' + code.slice(0, 1500) + '\n```',
    '',
    'Provide a concise code review. Respond in this EXACT JSON format (no markdown, just JSON):',
    '{',
    '  "timeComplexity": "O(n)",',
    '  "spaceComplexity": "O(n)",',
    '  "strengths": ["point 1", "point 2"],',
    '  "improvements": ["suggestion 1", "suggestion 2"],',
    '  "tip": "One key takeaway in one sentence"',
    '}',
    '',
    'Keep each point under 15 words. Be specific and technical.',
  ].join('\n');

  try {
    var raw = await gemini(prompt);
    // Strip any markdown code fences if present
    var clean = raw.replace(/```json|```/g, '').trim();
    try {
      var review = JSON.parse(clean);
      res.json(review);
    } catch(e) {
      // Gemini didn't return pure JSON — parse what we can
      res.json({
        timeComplexity:  'See analysis below',
        spaceComplexity: 'See analysis below',
        strengths:       ['Code runs correctly'],
        improvements:    [raw.slice(0, 200)],
        tip:             'Review your complexity analysis.',
      });
    }
  } catch(e) {
    next(e);
  }
});

// ── POST /api/ai/studyplan ────────────────────────────────────
// Body: { topics: [...], totalSolved, streak, weakTopics: [...] }
// Returns: { greeting, plan: [...], focus, encouragement }
router.post('/studyplan', async function(req, res, next) {
  var { topics, totalSolved, streak, weakTopics } = req.body;
  if (!topics) return res.status(400).json({ error: 'topics required' });

  var topicSummary = (topics || [])
    .slice(0, 15)
    .map(function(t) { return t.topic + ': ' + t.solved + '/' + t.total + ' (' + t.percentage + '%)'; })
    .join('\n');

  var weak = (weakTopics || []).slice(0, 3).map(function(t) { return t.topic; }).join(', ');

  var prompt = [
    'You are a DSA coach creating a personalized study plan.',
    '',
    'Student stats:',
    '- Total problems solved: ' + (totalSolved || 0),
    '- Current streak: ' + (streak || 0) + ' days',
    '- Weakest topics: ' + (weak || 'not determined yet'),
    '',
    'Topic progress:',
    topicSummary,
    '',
    'Create a focused 3-day study plan. Respond in this EXACT JSON format (no markdown):',
    '{',
    '  "greeting": "Short motivational opener (1 sentence)",',
    '  "focus": "The ONE topic they should focus on most this week",',
    '  "plan": [',
    '    { "day": "Today", "topic": "Arrays", "goal": "Solve 2 medium problems", "why": "Short reason" },',
    '    { "day": "Tomorrow", "topic": "Trees", "goal": "Solve 1 easy + 1 medium", "why": "Short reason" },',
    '    { "day": "Day 3", "topic": "DP", "goal": "Review Climbing Stairs pattern", "why": "Short reason" }',
    '  ],',
    '  "encouragement": "One specific encouraging sentence based on their progress"',
    '}',
    '',
    'Base recommendations on their weakest topics. Keep each field under 20 words.',
  ].join('\n');

  try {
    var raw = await gemini(prompt);
    var clean = raw.replace(/```json|```/g, '').trim();
    try {
      var plan = JSON.parse(clean);
      res.json(plan);
    } catch(e) {
      res.json({
        greeting:      'Keep going — every problem solved makes you stronger!',
        focus:         weak ? weak.split(',')[0].trim() : 'Arrays',
        plan: [
          { day: 'Today',    topic: weak ? weak.split(',')[0] : 'Arrays',
            goal: 'Solve 2 problems', why: 'Build consistency' },
          { day: 'Tomorrow', topic: weak ? weak.split(',')[1] || 'Trees' : 'Trees',
            goal: 'Solve 1-2 problems', why: 'Target weak areas' },
          { day: 'Day 3',    topic: 'Review',
            goal: 'Re-attempt any wrong answers', why: 'Reinforce learning' },
        ],
        encouragement: 'You have solved ' + (totalSolved||0) + ' problems — keep the momentum!',
      });
    }
  } catch(e) {
    next(e);
  }
});

module.exports = router;