'use strict';

// backend/routes/mock.js
//
// Mock Interview (Online Assessment Mode) — Premium only, 1 session/day
//
// POST /api/mock/start       — validate premium, pick problems via Gemini, create session
// GET  /api/mock/session/:id — get current session state (for timer recovery)
// POST /api/mock/submit      — submit code for one problem, run judge, store result
// POST /api/mock/finish      — end session early or on timer expiry, generate report
// GET  /api/mock/reports/:uid — list all past report cards for stats page

var express    = require('express');
var https      = require('https');
var router     = express.Router();
var admin      = require('../firebaseAdmin');
var langRunner = require('../services/langRunner');

var db           = admin.firestore();
var GEMINI_KEY   = process.env.GEMINI_API_KEY || '';
var GEMINI_MODEL = 'gemini-2.5-flash';
var GEMINI_HOST  = 'generativelanguage.googleapis.com';

// ─── Gemini helper ────────────────────────────────────────────

function gemini(prompt) {
  return new Promise(function(resolve, reject) {
    if (!GEMINI_KEY) return reject(new Error('GEMINI_API_KEY not set'));
    var body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
    });
    var path = '/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + GEMINI_KEY;
    var opts = {
      hostname: GEMINI_HOST, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    };
    var req = https.request(opts, function(res) {
      var raw = '';
      res.setEncoding('utf8');
      res.on('data', function(d) { raw += d; });
      res.on('end', function() {
        try {
          var data = JSON.parse(raw);
          if (data.error) return reject(new Error(data.error.message));
          var text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) return reject(new Error('No text in Gemini response'));
          resolve(text.trim());
        } catch(e) { reject(new Error('Gemini parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(new Error('Gemini timed out')); });
    req.write(body); req.end();
  });
}

function parseJSON(text) {
  var clean = text.replace(/```json|```/g, '').trim();
  var match = clean.match(/[\[\{][\s\S]*[\]\}]/);
  if (match) clean = match[0];
  return JSON.parse(clean);
}

// ─── Helpers ─────────────────────────────────────────────────

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// Duration map in minutes
var DURATION_MAP = { '1hr': 60, '1.5hr': 90, '2hr': 120 };

// Question count by duration + level
function getQuestionCount(duration, level) {
  var base = duration === '1hr' ? 3 : duration === '1.5hr' ? 4 : 5;
  if (level === 'pro') base = Math.min(base + 1, 6);
  return base;
}

// Difficulty distribution by level
function getDifficultyTarget(level) {
  if (level === 'beginner') return { Easy: 2, Medium: 1, Hard: 0 };
  if (level === 'intermediate') return { Easy: 1, Medium: 2, Hard: 1 };
  return { Easy: 0, Medium: 2, Hard: 2 }; // pro
}

// ─── POST /api/mock/start ─────────────────────────────────────

router.post('/start', async function(req, res) {
  var { uid, level, duration } = req.body;

  // ── Validate input ─────────────────────────────────────────
  if (!uid) return res.status(400).json({ error: 'uid is required.' });
  if (!['beginner', 'intermediate', 'pro'].includes(level))
    return res.status(400).json({ error: 'level must be beginner, intermediate, or pro.' });
  if (!DURATION_MAP[duration])
    return res.status(400).json({ error: 'duration must be 1hr, 1.5hr, or 2hr.' });

  // ── Premium check ──────────────────────────────────────────
  var userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return res.status(401).json({ error: 'User not found.' });
  var userData = userSnap.data();
  if (!userData.premium) return res.status(403).json({ error: 'Mock interviews require Premium.' });
  if (userData.premiumExpiresAt) {
    var exp = userData.premiumExpiresAt.toDate ? userData.premiumExpiresAt.toDate() : new Date(userData.premiumExpiresAt);
    if (exp < new Date()) return res.status(403).json({ error: 'Your Premium subscription has expired.' });
  }

  // ── 1 mock per day limit ───────────────────────────────────
  var today = todayIST();
  var usageRef  = db.collection('mockUsage').doc(uid);
  var usageSnap = await usageRef.get();
  if (usageSnap.exists && usageSnap.data().date === today) {
    return res.status(429).json({ error: 'You can only take one mock interview per day. Come back tomorrow!' });
  }

  // ── Fetch all available problems ───────────────────────────
  var problemsSnap = await db.collection('problems').get();
  var allProblems  = problemsSnap.docs.map(function(d) {
    return { id: d.id, ...d.data() };
  });

  if (allProblems.length < 3) {
    return res.status(400).json({ error: 'Not enough problems in the bank to run a mock interview.' });
  }

  // ── Fetch user's solve history ─────────────────────────────
  var progressSnap = await db.collection('userProgress').doc(uid).collection('problems').get();
  var solvedIds    = new Set(progressSnap.docs.filter(d => d.data().solved).map(d => d.id));

  // Build summary for Gemini
  var problemSummary = allProblems.map(function(p) {
    return {
      id:         p.id,
      title:      p.title,
      topic:      p.topic || 'General',
      difficulty: p.difficulty || 'Medium',
      solved:     solvedIds.has(p.id),
    };
  });

  var targetCount = getQuestionCount(duration, level);
  var diffTarget  = getDifficultyTarget(level);

  // ── Ask Gemini to pick problems ────────────────────────────
  // Randomness seed in prompt ensures variety
  var seed = Math.floor(Math.random() * 10000);

  var pickPrompt = [
    'You are selecting problems for a coding interview assessment.',
    '',
    'Candidate level: ' + level,
    'Duration: ' + duration + ' (' + DURATION_MAP[duration] + ' minutes)',
    'Target problems: ' + targetCount,
    'Target difficulty: Easy=' + diffTarget.Easy + ', Medium=' + diffTarget.Medium + ', Hard=' + diffTarget.Hard,
    'Randomness seed (use this to vary selections): ' + seed,
    '',
    'Available problems (JSON array):',
    JSON.stringify(problemSummary),
    '',
    'Rules:',
    '1. Pick exactly ' + targetCount + ' problems.',
    '2. Prefer UNSOLVED problems first — only reuse solved ones if not enough unsolved.',
    '3. Aim for the difficulty distribution above.',
    '4. Spread across different topics where possible.',
    '5. Use the seed to randomize — different seeds must produce different selections.',
    '6. Do NOT pick the same problem twice.',
    '',
    'Respond ONLY with a JSON array of problem IDs, nothing else. Example: ["id1","id2","id3"]',
  ].join('\n');

  var selectedIds;
  try {
    var raw = await gemini(pickPrompt);
    selectedIds = parseJSON(raw);
    if (!Array.isArray(selectedIds) || selectedIds.length === 0) throw new Error('Bad response');
    // Trim to targetCount in case Gemini over-selects
    selectedIds = selectedIds.slice(0, targetCount);
  } catch(e) {
    console.error('[Mock] Gemini problem pick failed:', e.message, '— falling back to random');
    // Fallback: random selection respecting difficulty targets
    var byDiff = { Easy: [], Medium: [], Hard: [] };
    allProblems.forEach(function(p) {
      var d = p.difficulty || 'Medium';
      if (byDiff[d]) byDiff[d].push(p);
    });
    // Shuffle each bucket
    Object.keys(byDiff).forEach(function(d) {
      byDiff[d].sort(function() { return Math.random() - 0.5; });
    });
    var picked = [];
    Object.entries(diffTarget).forEach(function([diff, count]) {
      byDiff[diff].slice(0, count).forEach(function(p) { picked.push(p.id); });
    });
    // Fill remaining if needed
    if (picked.length < targetCount) {
      allProblems
        .filter(function(p) { return !picked.includes(p.id); })
        .sort(function() { return Math.random() - 0.5; })
        .slice(0, targetCount - picked.length)
        .forEach(function(p) { picked.push(p.id); });
    }
    selectedIds = picked.slice(0, targetCount);
  }

  // Resolve full problem objects
  var selectedProblems = selectedIds
    .map(function(id) { return allProblems.find(function(p) { return p.id === id; }); })
    .filter(Boolean)
    .map(function(p) {
      return {
        id:          p.id,
        title:       p.title,
        topic:       p.topic || 'General',
        difficulty:  p.difficulty || 'Medium',
        description: p.description || '',
        testCases:   (p.testCases || []).filter(function(tc) { return !tc.hidden; }),
        url:         p.url || null,
        status:      'pending', // pending | attempted | passed | failed
        code:        '',
        language:    'python',
        passed:      0,
        total:       (p.testCases || []).filter(function(tc) { return !tc.hidden; }).length,
        timeMs:      null,
      };
    });

  if (selectedProblems.length === 0) {
    return res.status(500).json({ error: 'Could not resolve selected problems.' });
  }

  // ── Create Firestore session ───────────────────────────────
  var durationMins = DURATION_MAP[duration];
  var now     = new Date();
  var endsAt  = new Date(now.getTime() + durationMins * 60 * 1000);

  var sessionRef  = db.collection('mockSessions').doc();
  var sessionId   = sessionRef.id;

  await sessionRef.set({
    uid,
    level,
    duration,
    durationMins,
    startedAt:  admin.firestore.Timestamp.fromDate(now),
    endsAt:     admin.firestore.Timestamp.fromDate(endsAt),
    problems:   selectedProblems,
    status:     'active',
    report:     null,
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
  });

  // ── Mark usage for today ───────────────────────────────────
  await usageRef.set({ date: today, sessionId });

  console.log('[Mock] Session started:', sessionId, '| uid:', uid, '| level:', level, '| problems:', selectedProblems.length);

  res.json({
    sessionId,
    endsAt:   endsAt.toISOString(),
    durationMins,
    problems: selectedProblems,
    level,
  });
});

// ─── GET /api/mock/session/:sessionId ─────────────────────────
// Used on page reload to recover timer and state

router.get('/session/:sessionId', async function(req, res) {
  var { sessionId } = req.params;
  var { uid }       = req.query;

  if (!uid) return res.status(400).json({ error: 'uid required' });

  var snap = await db.collection('mockSessions').doc(sessionId).get();
  if (!snap.exists) return res.status(404).json({ error: 'Session not found.' });

  var session = snap.data();
  if (session.uid !== uid) return res.status(403).json({ error: 'Access denied.' });

  // Auto-finish if timer expired
  if (session.status === 'active') {
    var endsAt = session.endsAt.toDate();
    if (new Date() > endsAt) {
      await db.collection('mockSessions').doc(sessionId).update({ status: 'finished' });
      session.status = 'finished';
    }
  }

  res.json({
    sessionId,
    status:      session.status,
    endsAt:      session.endsAt.toDate().toISOString(),
    durationMins:session.durationMins,
    problems:    session.problems,
    level:       session.level,
    report:      session.report || null,
  });
});

// ─── POST /api/mock/submit ────────────────────────────────────
// Run code for one problem and store result in session

router.post('/submit', async function(req, res) {
  var { uid, sessionId, problemId, code, language } = req.body;

  if (!uid || !sessionId || !problemId || !code)
    return res.status(400).json({ error: 'uid, sessionId, problemId, code required.' });

  var snap = await db.collection('mockSessions').doc(sessionId).get();
  if (!snap.exists) return res.status(404).json({ error: 'Session not found.' });

  var session = snap.data();
  if (session.uid !== uid) return res.status(403).json({ error: 'Access denied.' });
  if (session.status !== 'active') return res.status(400).json({ error: 'Session is not active.' });

  // Check timer hasn't expired
  var endsAt = session.endsAt.toDate();
  if (new Date() > endsAt) {
    await db.collection('mockSessions').doc(sessionId).update({ status: 'finished' });
    return res.status(400).json({ error: 'Time is up! Session has ended.' });
  }

  // Find problem in session
  var problems = session.problems || [];
  var pIdx     = problems.findIndex(function(p) { return p.id === problemId; });
  if (pIdx === -1) return res.status(404).json({ error: 'Problem not in this session.' });

  var problem   = problems[pIdx];
  var testCases = problem.testCases || [];

  if (testCases.length === 0) {
    return res.status(400).json({ error: 'No test cases for this problem.' });
  }

  // ── Run code ───────────────────────────────────────────────
  var judgeResult;
  try {
    judgeResult = await langRunner.runTests(language || 'python', code, testCases);
  } catch(e) {
    return res.status(500).json({ error: 'Execution error: ' + e.message });
  }

  // ── Update problem in session ──────────────────────────────
  problems[pIdx] = {
    ...problem,
    code,
    language:   language || 'python',
    passed:     judgeResult.passed,
    total:      judgeResult.total,
    status:     judgeResult.allPassed ? 'passed' : 'attempted',
    timeMs:     judgeResult.results.reduce(function(s, r) { return s + (r.timeMs || 0); }, 0),
    verdict:    judgeResult.verdict,
    lastSubmit: new Date().toISOString(),
  };

  await db.collection('mockSessions').doc(sessionId).update({ problems });

  res.json({
    passed:    judgeResult.passed,
    total:     judgeResult.total,
    allPassed: judgeResult.allPassed,
    verdict:   judgeResult.verdict,
    results:   judgeResult.results,
  });
});

// ─── POST /api/mock/finish ────────────────────────────────────
// End session + generate Gemini report card

router.post('/finish', async function(req, res) {
  var { uid, sessionId } = req.body;

  if (!uid || !sessionId) return res.status(400).json({ error: 'uid and sessionId required.' });

  var ref  = db.collection('mockSessions').doc(sessionId);
  var snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Session not found.' });

  var session = snap.data();
  if (session.uid !== uid) return res.status(403).json({ error: 'Access denied.' });
  if (session.report) {
    // Already finished — return existing report
    return res.json({ report: session.report, sessionId });
  }

  var problems  = session.problems || [];
  var passed    = problems.filter(function(p) { return p.status === 'passed'; }).length;
  var attempted = problems.filter(function(p) { return p.status !== 'pending'; }).length;
  var total     = problems.length;

  // ── Ask Gemini to generate report ──────────────────────────
  var problemSummary = problems.map(function(p) {
    return {
      title:      p.title,
      topic:      p.topic,
      difficulty: p.difficulty,
      status:     p.status,
      passed:     p.passed + '/' + p.total + ' test cases',
      verdict:    p.verdict || 'Not attempted',
      language:   p.language || 'Not submitted',
    };
  });

  var reportPrompt = [
    'You are a senior interviewer generating a mock interview report card.',
    '',
    'Candidate level: ' + session.level,
    'Duration: ' + session.durationMins + ' minutes',
    'Problems solved: ' + passed + '/' + total,
    'Problems attempted: ' + attempted + '/' + total,
    '',
    'Problem results:',
    JSON.stringify(problemSummary, null, 2),
    '',
    'Generate a detailed report card. Respond ONLY with valid JSON:',
    '{',
    '  "overallScore": <number 0-100>,',
    '  "grade": <"S"|"A"|"B"|"C"|"D">,',
    '  "verdict": <"Excellent"|"Good"|"Average"|"Needs Improvement"|"Poor">,',
    '  "summary": <2-3 sentence overall assessment>,',
    '  "strengths": [<up to 3 specific strengths>],',
    '  "improvements": [<up to 3 specific areas to improve>],',
    '  "topicFeedback": { <topic>: <one line feedback> },',
    '  "nextSteps": <one actionable recommendation>,',
    '  "problemReports": [',
    '    { "title": <title>, "feedback": <one sentence>, "score": <0-100> }',
    '  ]',
    '}',
  ].join('\n');

  var report;
  try {
    var raw = await gemini(reportPrompt);
    report  = parseJSON(raw);
  } catch(e) {
    console.error('[Mock] Report generation failed:', e.message);
    // Fallback report
    var score = Math.round((passed / Math.max(total, 1)) * 100);
    report = {
      overallScore: score,
      grade:        score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D',
      verdict:      score >= 75 ? 'Good' : score >= 50 ? 'Average' : 'Needs Improvement',
      summary:      'You solved ' + passed + ' out of ' + total + ' problems.',
      strengths:    passed > 0 ? ['Completed ' + passed + ' problem(s)'] : ['Attempted the assessment'],
      improvements: ['Practice more problems across different topics'],
      topicFeedback:{},
      nextSteps:    'Focus on your weak topics and attempt more mock interviews.',
      problemReports: problems.map(function(p) {
        return { title: p.title, feedback: p.status === 'passed' ? 'Solved correctly.' : 'Needs more practice.', score: p.status === 'passed' ? 100 : p.passed > 0 ? 50 : 0 };
      }),
    };
  }

  // Add metadata
  report.sessionId    = sessionId;
  report.level        = session.level;
  report.duration     = session.duration;
  report.durationMins = session.durationMins;
  report.problemCount = total;
  report.passedCount  = passed;
  report.finishedAt   = new Date().toISOString();
  report.startedAt    = session.startedAt.toDate().toISOString();

  // ── Save report to session + user reports collection ───────
  await ref.update({ status: 'finished', report });

  await db
    .collection('mockReports')
    .doc(uid)
    .collection('reports')
    .doc(sessionId)
    .set(report);

  console.log('[Mock] Session finished:', sessionId, '| score:', report.overallScore);
  res.json({ report, sessionId });
});

// ─── GET /api/mock/reports/:uid ───────────────────────────────

router.get('/reports/:uid', async function(req, res) {
  var { uid }      = req.params;
  var { requester } = req.query;

  if (requester !== uid) return res.status(403).json({ error: 'Access denied.' });

  var snap = await db
    .collection('mockReports')
    .doc(uid)
    .collection('reports')
    .orderBy('finishedAt', 'desc')
    .limit(20)
    .get();

  var reports = snap.docs.map(function(d) {
    return { id: d.id, ...d.data() };
  });

  res.json({ reports });
});

module.exports = router;