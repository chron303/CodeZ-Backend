'use strict';

// backend/firebaseAdmin.js
// Firebase Admin SDK initializer.
// Supports 3 auth methods in order of priority:
//   1. FIREBASE_SERVICE_ACCOUNT env var (JSON string) ← best for Railway
//   2. serviceAccountKey.json file ← best for local dev
//   3. GOOGLE_APPLICATION_CREDENTIALS path ← GCP native
//v1.1

var admin = require('firebase-admin');
var path  = require('path');
var fs    = require('fs');

if (!admin.apps.length) {

  // Method 1: JSON string in environment variable (Railway/Vercel/Render)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      var serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('[Firebase] Initialized from FIREBASE_SERVICE_ACCOUNT env var');
    } catch(e) {
      console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT:', e.message);
    }

  // Method 2: Local serviceAccountKey.json file
  } else {
    var keyPath = path.join(__dirname, 'serviceAccountKey.json');
    if (fs.existsSync(keyPath)) {
      var sa = require('./serviceAccountKey.json');
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      console.log('[Firebase] Initialized from serviceAccountKey.json');

    // Method 3: GOOGLE_APPLICATION_CREDENTIALS path
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
      console.log('[Firebase] Initialized from GOOGLE_APPLICATION_CREDENTIALS');

    // Fallback: no credentials — Firestore writes will fail
    } else {
      console.warn('[Firebase] WARNING: No credentials found. Firestore writes will fail.');
      console.warn('[Firebase] Add FIREBASE_SERVICE_ACCOUNT env var in Railway.');
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'dsa-quest-865d4',
      });
    }
  }
}

module.exports = admin;