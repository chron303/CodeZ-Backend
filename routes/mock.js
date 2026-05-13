'use strict';

// backend/routes/mock.js
// Mock Interview — Premium only, 1 session/day
// All sensitive routes protected by Firebase ID token via verifyToken middleware.
// uid is always taken from req.uid (verified token), never from request body.

var express     = require('express');
var https       = require('https');
var router      = express.Router();
var admin       = require('../firebaseAdmin');
var langRunner  = require('../services/langRunner');
var verifyToken = require('../middleware/verifyToken');

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

// ─── Helpers ──────────────────────────────────────────────────

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

var DURATION_MAP = { '1hr': 60, '1.5hr': 90, '2hr': 120 };

function getQuestionCount(duration, level) {
  var base = duration === '1hr' ? 3 : duration === '1.5hr' ? 4 : 5;
  if (level === 'pro') base = Math.min(base + 1, 6);
  return base;
}

function getDifficultyTarget(level) {
  if (level === 'beginner')     return { Easy: 2, Medium: 1, Hard: 0 };
  if (level === 'intermediate') return { Easy: 1, Medium: 2, Hard: 1 };
  return { Easy: 0, Medium: 2, Hard: 2 };
}

var DIFF_MARKS = { Easy: 5, Medium: 10, Hard: 15 };

// ─── POST /api/mock/start ─────────────────────────────────────

router.post('/start', verifyToken, async function(req, res) {
  var uid      = req.uid; // from verified token
  var { level, duration } = req.body;

  if (!['beginner', 'intermediate', 'pro'].includes(level))
    return res.status(400).json({ error: 'level must be beginner, intermediate, or pro.' });
  if (!DURATION_MAP[duration])
    return res.status(400).json({ error: 'duration must be 1hr, 1.5hr, or 2hr.' });

  // Premium check
  var userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return res.status(401).json({ error: 'User not found.' });
  var userData = userSnap.data();
  if (!userData.premium) return res.status(403).json({ error: 'Mock interviews require Premium.' });
  if (userData.premiumExpiresAt) {
    var exp = userData.premiumExpiresAt.toDate
      ? userData.premiumExpiresAt.toDate()
      : new Date(userData.premiumExpiresAt);
    if (exp < new Date()) return res.status(403).json({ error: 'Your Premium subscription has expired.' });
  }

  // 1 mock per day
  var today     = todayIST();
  var usageRef  = db.collection('mockUsage').doc(uid);
  var usageSnap = await usageRef.get();
  if (usageSnap.exists && usageSnap.data().date === today)
    return res.status(429).json({ error: 'You can only take one mock interview per day. Come back tomorrow!' });

  // Fetch problems
  var problemsSnap = await db.collection('problems').get();
  var allProblems  = problemsSnap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
  if (allProblems.length < 3)
    return res.status(400).json({ error: 'Not enough problems in the bank to run a mock interview.' });

  // Solve history
  var progressSnap = await db.collection('userProgress').doc(uid).collection('problems').get();
  var solvedIds    = new Set(progressSnap.docs.filter(function(d) { return d.data().solved; }).map(function(d) { return d.id; }));

  var problemSummary = allProblems.map(function(p) {
    return { id: p.id, title: p.title, topic: p.topic || 'General', difficulty: p.difficulty || 'Medium', solved: solvedIds.has(p.id) };
  });

  var targetCount = getQuestionCount(duration, level);
  var diffTarget  = getDifficultyTarget(level);
  var seed        = Math.floor(Math.random() * 10000);

  var pickPrompt = [
    'You are selecting problems for a coding interview assessment.',
    'Candidate level: ' + level,
    'Duration: ' + duration + ' (' + DURATION_MAP[duration] + ' minutes)',
    'Target problems: ' + targetCount,
    'Target difficulty: Easy=' + diffTarget.Easy + ', Medium=' + diffTarget.Medium + ', Hard=' + diffTarget.Hard,
    'Randomness seed (use this to vary selections): ' + seed,
    '',
    'Available problems:',
    JSON.stringify(problemSummary),
    '',
    'Rules:',
    '1. Pick exactly ' + targetCount + ' problems.',
    '2. Prefer UNSOLVED problems first.',
    '3. Aim for the difficulty distribution above.',
    '4. Spread across different topics.',
    '5. Use the seed to randomize selections.',
    '',
    'Respond ONLY with a JSON array of problem IDs. Example: ["id1","id2","id3"]',
  ].join('\n');

  var selectedIds;
  try {
    var raw = await gemini(pickPrompt);
    selectedIds = parseJSON(raw);
    if (!Array.isArray(selectedIds) || selectedIds.length === 0) throw new Error('Bad response');
    selectedIds = selectedIds.slice(0, targetCount);
  } catch(e) {
    console.error('[Mock] Gemini pick failed:', e.message, '— falling back to random');
    var byDiff = { Easy: [], Medium: [], Hard: [] };
    allProblems.forEach(function(p) {
      var d = p.difficulty || 'Medium';
      if (byDiff[d]) byDiff[d].push(p);
    });
    Object.keys(byDiff).forEach(function(d) { byDiff[d].sort(function() { return Math.random() - 0.5; }); });
    var picked = [];
    Object.entries(diffTarget).forEach(function([diff, count]) {
      byDiff[diff].slice(0, count).forEach(function(p) { picked.push(p.id); });
    });
    if (picked.length < targetCount) {
      allProblems
        .filter(function(p) { return !picked.includes(p.id); })
        .sort(function() { return Math.random() - 0.5; })
        .slice(0, targetCount - picked.length)
        .forEach(function(p) { picked.push(p.id); });
    }
    selectedIds = picked.slice(0, targetCount);
  }

  var selectedProblems = selectedIds
    .map(function(id) { return allProblems.find(function(p) { return p.id === id; }); })
    .filter(Boolean)
    .map(function(p) {
      return {
        id: p.id, title: p.title, topic: p.topic || 'General',
        difficulty: p.difficulty || 'Medium', description: p.description || '',
        testCases: (p.testCases || []).filter(function(tc) { return !tc.hidden; }),
        url: p.url || null, status: 'pending', code: '', language: 'python',
        passed: 0, total: (p.testCases || []).filter(function(tc) { return !tc.hidden; }).length,
        timeMs: null,
      };
    });

  if (selectedProblems.length === 0)
    return res.status(500).json({ error: 'Could not resolve selected problems.' });

  var durationMins = DURATION_MAP[duration];
  var now    = new Date();
  var endsAt = new Date(now.getTime() + durationMins * 60 * 1000);

  var sessionRef = db.collection('mockSessions').doc();
  var sessionId  = sessionRef.id;

  await sessionRef.set({
    uid, level, duration, durationMins,
    startedAt: admin.firestore.Timestamp.fromDate(now),
    endsAt:    admin.firestore.Timestamp.fromDate(endsAt),
    problems:  selectedProblems,
    status:    'active',
    report:    null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await usageRef.set({ date: today, sessionId });

  console.log('[Mock] Session started:', sessionId, '| uid:', uid, '| level:', level);

  res.json({ sessionId, endsAt: endsAt.toISOString(), durationMins, problems: selectedProblems, level });
});

// ─── GET /api/mock/session/:sessionId ─────────────────────────

router.get('/session/:sessionId', verifyToken, async function(req, res) {
  var uid       = req.uid;
  var sessionId = req.params.sessionId;

  var snap = await db.collection('mockSessions').doc(sessionId).get();
  if (!snap.exists) return res.status(404).json({ error: 'Session not found.' });

  var session = snap.data();
  if (session.uid !== uid) return res.status(403).json({ error: 'Access denied.' });

  if (session.status === 'active') {
    var endsAt = session.endsAt.toDate();
    if (new Date() > endsAt) {
      await db.collection('mockSessions').doc(sessionId).update({ status: 'finished' });
      session.status = 'finished';
    }
  }

  res.json({
    sessionId, status: session.status,
    endsAt:       session.endsAt.toDate().toISOString(),
    durationMins: session.durationMins,
    problems:     session.problems,
    level:        session.level,
    report:       session.report || null,
  });
});

// ─── POST /api/mock/submit ────────────────────────────────────

router.post('/submit', verifyToken, async function(req, res) {
  var uid = req.uid;
  var { sessionId, problemId, code, language } = req.body;

  if (!sessionId || !problemId || !code)
    return res.status(400).json({ error: 'sessionId, problemId, code required.' });

  var snap = await db.collection('mockSessions').doc(sessionId).get();
  if (!snap.exists) return res.status(404).json({ error: 'Session not found.' });

  var session = snap.data();
  if (session.uid !== uid)       return res.status(403).json({ error: 'Access denied.' });
  if (session.status !== 'active') return res.status(400).json({ error: 'Session is not active.' });

  var endsAt = session.endsAt.toDate();
  if (new Date() > endsAt) {
    await db.collection('mockSessions').doc(sessionId).update({ status: 'finished' });
    return res.status(400).json({ error: 'Time is up! Session has ended.' });
  }

  var problems = session.problems || [];
  var pIdx     = problems.findIndex(function(p) { return p.id === problemId; });
  if (pIdx === -1) return res.status(404).json({ error: 'Problem not in this session.' });

  var problem   = problems[pIdx];
  var testCases = problem.testCases || [];
  if (testCases.length === 0) return res.status(400).json({ error: 'No test cases for this problem.' });

  var judgeResult;
  try {
    judgeResult = await langRunner.runTests(language || 'python', code, testCases);
  } catch(e) {
    return res.status(500).json({ error: 'Execution error: ' + e.message });
  }

  problems[pIdx] = {
    ...problem, code, language: language || 'python',
    passed:  judgeResult.passed,
    total:   judgeResult.total,
    status:  judgeResult.allPassed ? 'passed' : 'attempted',
    timeMs:  judgeResult.results.reduce(function(s, r) { return s + (r.timeMs || 0); }, 0),
    verdict: judgeResult.verdict,
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

router.post('/finish', verifyToken, async function(req, res) {
  var uid       = req.uid;
  var { sessionId } = req.body;

  if (!sessionId) return res.status(400).json({ error: 'sessionId required.' });

  var ref  = db.collection('mockSessions').doc(sessionId);
  var snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Session not found.' });

  var session = snap.data();
  if (session.uid !== uid) return res.status(403).json({ error: 'Access denied.' });
  if (session.report) return res.json({ report: session.report, sessionId });

  var problems  = session.problems || [];
  var passed    = problems.filter(function(p) { return p.status === 'passed'; }).length;
  var attempted = problems.filter(function(p) { return p.status !== 'pending'; }).length;
  var total     = problems.length;

  // Weighted scoring
  var totalMaxMarks = problems.reduce(function(sum, p) {
    return sum + (DIFF_MARKS[p.difficulty] || 10);
  }, 0);

  var problemScores = problems.map(function(p) {
    var maxMarks = DIFF_MARKS[p.difficulty] || 10;
    var tcTotal  = p.total  || 0;
    var tcPassed = p.passed || 0;
    var rawMarks = tcTotal > 0 ? Math.round((tcPassed / tcTotal) * maxMarks) : 0;
    var pctScore = maxMarks > 0 ? Math.round((rawMarks / maxMarks) * 100) : 0;
    return { title: p.title, topic: p.topic, difficulty: p.difficulty, status: p.status,
      maxMarks, rawMarks, pctScore, tcPassed, tcTotal, verdict: p.verdict || 'Not attempted',
      language: p.language || 'Not submitted' };
  });

  var totalEarned  = problemScores.reduce(function(s, p) { return s + p.rawMarks; }, 0);
  var overallScore = totalMaxMarks > 0 ? Math.round((totalEarned / totalMaxMarks) * 100) : 0;
  var grade = overallScore >= 90 ? 'S' : overallScore >= 75 ? 'A' :
              overallScore >= 60 ? 'B' : overallScore >= 40 ? 'C' : 'D';

  var problemSummaryForGemini = problemScores.map(function(p) {
    return { title: p.title, topic: p.topic, difficulty: p.difficulty,
      marks: p.rawMarks + '/' + p.maxMarks, testCases: p.tcPassed + '/' + p.tcTotal + ' passed',
      verdict: p.verdict, language: p.language };
  });

  var reportPrompt = [
    'You are a senior interviewer generating a mock interview report card.',
    'Candidate level: ' + session.level,
    'Duration: ' + session.durationMins + ' minutes',
    'Total score: ' + totalEarned + '/' + totalMaxMarks + ' marks (' + overallScore + '/100)',
    'Problems fully solved: ' + passed + '/' + total,
    'Problems attempted: ' + attempted + '/' + total,
    'Scoring: Easy=5, Medium=10, Hard=15 marks. Partial credit proportional to test cases passed.',
    '',
    'Problem results:',
    JSON.stringify(problemSummaryForGemini, null, 2),
    '',
    'Generate narrative feedback only. DO NOT change the scores.',
    'Respond ONLY with valid JSON (no markdown):',
    '{"summary":"<2-3 sentences>","strengths":["<s1>","<s2>","<s3>"],"improvements":["<i1>","<i2>","<i3>"],"topicFeedback":{"<topic>":"<one line>"},"nextSteps":"<one actionable recommendation>","problemReports":[{"title":"<title>","feedback":"<one sentence>"}]}',
  ].join('\n');

  var report;
  try {
    var raw       = await gemini(reportPrompt);
    var narrative = parseJSON(raw);
    report = {
      overallScore, grade, totalEarned, totalMaxMarks,
      verdict: overallScore >= 75 ? 'Excellent' : overallScore >= 60 ? 'Good' :
               overallScore >= 40 ? 'Average'   : overallScore >= 20 ? 'Needs Improvement' : 'Poor',
      summary:       narrative.summary       || '',
      strengths:     narrative.strengths     || [],
      improvements:  narrative.improvements  || [],
      topicFeedback: narrative.topicFeedback || {},
      nextSteps:     narrative.nextSteps     || '',
      problemReports: problemScores.map(function(ps) {
        var geminiP = (narrative.problemReports || []).find(function(gp) { return gp.title === ps.title; });
        return {
          title: ps.title, difficulty: ps.difficulty,
          marks: ps.rawMarks + '/' + ps.maxMarks, score: ps.pctScore,
          feedback: geminiP ? geminiP.feedback :
            ps.tcPassed === ps.tcTotal && ps.tcTotal > 0 ? 'All test cases passed. Well done!' :
            ps.tcPassed > 0 ? ps.tcPassed + '/' + ps.tcTotal + ' test cases passed.' : 'No test cases passed.',
        };
      }),
    };
  } catch(e) {
    console.error('[Mock] Report generation failed:', e.message);
    report = {
      overallScore, grade, totalEarned, totalMaxMarks,
      verdict: overallScore >= 75 ? 'Good' : overallScore >= 50 ? 'Average' : 'Needs Improvement',
      summary: 'You scored ' + totalEarned + '/' + totalMaxMarks + ' marks.',
      strengths:    passed > 0 ? ['Solved ' + passed + ' problem(s) fully'] : ['Attempted the assessment'],
      improvements: ['Review problems where test cases failed'],
      topicFeedback: {}, nextSteps: 'Focus on weak topics and attempt another mock interview tomorrow.',
      problemReports: problemScores.map(function(ps) {
        return { title: ps.title, difficulty: ps.difficulty,
          marks: ps.rawMarks + '/' + ps.maxMarks, score: ps.pctScore,
          feedback: ps.tcPassed === ps.tcTotal && ps.tcTotal > 0 ? 'All test cases passed.' :
            ps.tcPassed > 0 ? ps.tcPassed + '/' + ps.tcTotal + ' test cases passed.' : 'No test cases passed.' };
      }),
    };
  }

  report.sessionId    = sessionId;
  report.level        = session.level;
  report.duration     = session.duration;
  report.durationMins = session.durationMins;
  report.problemCount = total;
  report.passedCount  = passed;
  report.finishedAt   = new Date().toISOString();
  report.startedAt    = session.startedAt.toDate().toISOString();

  await ref.update({ status: 'finished', report });
  await db.collection('mockReports').doc(uid).collection('reports').doc(sessionId).set(report);

  console.log('[Mock] Session finished:', sessionId, '| score:', report.overallScore);
  res.json({ report, sessionId });
});

// ─── GET /api/mock/reports/:uid ───────────────────────────────
// uid in URL must match the authenticated user

router.get('/reports/:uid', verifyToken, async function(req, res) {
  var tokenUid = req.uid;
  var paramUid = req.params.uid;

  if (tokenUid !== paramUid)
    return res.status(403).json({ error: 'Access denied.' });

  var snap = await db.collection('mockReports').doc(tokenUid)
    .collection('reports').orderBy('finishedAt', 'desc').limit(20).get();

  res.json({ reports: snap.docs.map(function(d) { return { id: d.id, ...d.data() }; }) });
});

module.exports = router;