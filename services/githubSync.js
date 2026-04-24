'use strict';

// backend/services/githubSync.js
//
// Syncs problems from GitHub repo into Firestore.
// Files are named by slug only: two-sum.json (no number prefix).
// Numbers are assigned automatically based on order in Firestore.

var https = require('https');
var admin = require('../firebaseAdmin');

var GITHUB_REPO  = process.env.GITHUB_REPO  || '';
var GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

function fetchRaw(path) {
  return new Promise(function(resolve, reject) {
    if (!GITHUB_REPO) {
      return reject(new Error('GITHUB_REPO is not set in .env'));
    }
    var headers = { 'User-Agent': 'dsa-quest-sync/1.0' };
    if (GITHUB_TOKEN) headers['Authorization'] = 'Bearer ' + GITHUB_TOKEN;

    var opts = {
      hostname: 'raw.githubusercontent.com',
      path:     '/' + GITHUB_REPO + '/main' + path,
      method:   'GET',
      headers:  headers,
      timeout:  15000,
    };

    var req = https.request(opts, function(res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function(d) { body += d; });
      res.on('end', function() {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' for ' + path));
        resolve(body);
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(new Error('Timeout: ' + path)); });
    req.end();
  });
}

async function fetchJSON(path) {
  var raw = await fetchRaw(path);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e) { return null; }
}

// ── Get or create the next problem number ──────────────────────
// Reads from a Firestore counter document so numbers are globally unique
// and sequential regardless of where problems come from (built-in or GitHub)
async function getNextNumber() {
  var db      = admin.firestore();
  var counter = db.collection('meta').doc('problemCounter');

  return db.runTransaction(async function(tx) {
    var snap = await tx.get(counter);
    var current = snap.exists ? (snap.data().count || 0) : 0;
    var next    = current + 1;
    tx.set(counter, { count: next }, { merge: true });
    return next;
  });
}

// ── Get current highest problem number across all problems ─────
async function getCurrentMaxNumber() {
  var db   = admin.firestore();
  var snap = await db.collection('problems')
    .orderBy('number', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return 0;
  return snap.docs[0].data().number || 0;
}

// ── Upsert one problem ─────────────────────────────────────────
async function upsertProblem(slug, data) {
  var db  = admin.firestore();
  var ref = db.collection('problems').doc(slug);  // slug as doc ID
  var snap = await ref.get();

  if (!snap.exists) {
    // New problem — assign next number
    var maxNum = await getCurrentMaxNumber();
    var number = maxNum + 1;

    await ref.set({
      slug:        slug,
      number:      number,
      title:       data.title,
      topic:       data.topic || 'General',
      difficulty:  data.difficulty || 'Medium',
      description: data.description || '',
      url:         data.url || '',
      tags:        data.tags || [],
      examples:    data.examples || [],
      testCases:   data.testCases || [],
      author:      data.author || '',
      order:       number,
      source:      'github',
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
    });
    return { result: 'created', number: number };
  }

  // Existing — check if changed
  var existing = snap.data();
  var changed  =
    existing.title       !== data.title ||
    existing.description !== data.description ||
    JSON.stringify(existing.testCases) !== JSON.stringify(data.testCases);

  if (!changed) return { result: 'skipped', number: existing.number };

  await ref.update({
    title:       data.title,
    topic:       data.topic || existing.topic,
    difficulty:  data.difficulty || existing.difficulty,
    description: data.description || '',
    url:         data.url || '',
    tags:        data.tags || [],
    examples:    data.examples || [],
    testCases:   data.testCases || [],
    updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
  });
  return { result: 'updated', number: existing.number };
}

// ── Main sync ──────────────────────────────────────────────────
async function syncFromGitHub() {
  var log = {
    startedAt: new Date().toISOString(),
    repo:      GITHUB_REPO,
    created: 0, updated: 0, skipped: 0, failed: 0,
    errors: [], problems: [],
  };

  if (!GITHUB_REPO) {
    console.error('[Sync] GITHUB_REPO is not set in .env');
    log.errors.push('GITHUB_REPO not set');
    log.finishedAt = new Date().toISOString();
    return log;
  }

  console.log('[Sync] Starting GitHub sync from', GITHUB_REPO);

  var index = await fetchJSON('/problems.index.json');
  if (!index || !Array.isArray(index.problems)) {
    console.error('[Sync] Could not fetch problems.index.json — is the repo public?');
    log.errors.push('problems.index.json not found');
    log.finishedAt = new Date().toISOString();
    return log;
  }

  console.log('[Sync] Index loaded —', index.problems.length, 'problems found');

  for (var entry of index.problems) {
    var slug = entry.slug;
    if (!slug) {
      log.errors.push('Entry missing slug: ' + JSON.stringify(entry));
      log.failed++;
      continue;
    }

    try {
      var data = await fetchJSON('/problems/' + slug + '.json');
      if (!data) {
        console.error('[Sync] Not found:', slug + '.json');
        log.errors.push('Not found: ' + slug + '.json');
        log.failed++;
        continue;
      }

      var r = await upsertProblem(slug, data);
      log[r.result]++;
      log.problems.push({ slug: slug, title: data.title, number: r.number, result: r.result });
      console.log('[Sync]', '#' + r.number, data.title, '→', r.result);

      await new Promise(function(resolve) { setTimeout(resolve, 100); });

    } catch(e) {
      console.error('[Sync] Error on', slug, ':', e.message);
      log.errors.push(slug + ': ' + e.message);
      log.failed++;
    }
  }

  log.finishedAt = new Date().toISOString();
  log.total      = index.problems.length;

  try {
    await admin.firestore().collection('syncLogs').add(log);
  } catch(e) {}

  console.log('[Sync] Done —',
    log.created, 'created,', log.updated, 'updated,',
    log.skipped, 'skipped,', log.failed,  'failed'
  );
  return log;
}

module.exports = { syncFromGitHub };