'use strict';
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { parseFile } = require('../services/csvParser');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'tmp');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: function(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'upload_' + Date.now() + ext);
  },
});

const fileFilter = function(req, file, cb) {
  const validExts = ['.csv', '.xlsx', '.xls'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (validExts.includes(ext)) return cb(null, true);
  cb(new Error('Only CSV and Excel files (.csv, .xlsx, .xls) are supported.'));
};

const upload = multer({ storage: storage, fileFilter: fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/csv', upload.single('file'), function(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided.' });
  }
  try {
    const result = parseFile(req.file.path, req.file.mimetype);
    fs.unlink(req.file.path, function() {});
    const alreadySolved = result.problems.filter(function(p) { return p.solved; }).length;
    res.json({
      topics: result.topics,
      stats: {
        totalProblems: result.problems.length,
        totalTopics: result.topics.length,
        alreadySolved: alreadySolved,
      },
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, function() {});
    next(err);
  }
});

module.exports = router;