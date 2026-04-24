'use strict';

// Load .env if dotenv is available (not needed on Railway — env vars are injected directly)
try {
  var dotenv = require('dotenv');
  var result = dotenv.config();
  if (result.error) {
    console.warn('[ENV] No .env file found — using system environment variables');
  } else {
    console.log('[ENV] Loaded .env file successfully');
    console.log('[ENV] GITHUB_REPO =', process.env.GITHUB_REPO || '(not set)');
  }
} catch (e) {
  console.log('[ENV] dotenv not installed — using system environment variables');
}

var express       = require('express');
var cors          = require('cors');
var cron          = require('node-cron');
var uploadRoute   = require('./routes/upload');
var judgeRoute    = require('./routes/judge');
var syncRoute     = require('./routes/sync');
var leetcodeRoute = require('./routes/leetcode');
var githubSync    = require('./services/githubSync');
var aiRoute       = require('./routes/ai');
var otpRoute      = require('./routes/otp');
var premiumRoute  = require('./routes/premium');

var app  = express();
var PORT = process.env.PORT || 4000;

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    var allowed = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
      .split(',').map(function(s) { return s.trim(); });
    if (allowed.indexOf(origin) !== -1 || allowed.indexOf('*') !== -1) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '256kb' }));

app.use('/api/upload',   uploadRoute);
app.use('/api/judge',    judgeRoute);
app.use('/api/sync',     syncRoute);
app.use('/api/ai',       aiRoute);
app.use('/api/otp',      otpRoute);
app.use('/api/premium',  premiumRoute);
app.use('/api/leetcode', leetcodeRoute);

app.get('/api/health', function(req, res) {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use(function(err, req, res, next) {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message });
});

app.listen(PORT, function() {
  console.log('DSA Quest API running on http://localhost:' + PORT);

  cron.schedule('0 0 * * *', function() {
    console.log('[Cron] Running scheduled GitHub sync...');
    githubSync.syncFromGitHub()
      .then(function(log) {
        console.log('[Cron] Sync complete:', log.created, 'created,', log.updated, 'updated');
      })
      .catch(function(err) {
        console.error('[Cron] Sync failed:', err.message);
      });
  }, { timezone: 'Asia/Kolkata' });

  console.log('[Cron] GitHub sync scheduled — runs daily at midnight IST');

  // Run sync on startup
  console.log('[Sync] Running initial sync on startup...');
  githubSync.syncFromGitHub()
    .then(function(log) {
      console.log('[Sync] Startup sync done:',
        log.created, 'created,',
        log.updated, 'updated,',
        log.skipped, 'skipped'
      );
    })
    .catch(function(err) {
      console.error('[Sync] Startup sync failed:', err.message);
    });
});