// backend/firebaseAdmin.js
//
// Initializes Firebase Admin SDK.
// Used to verify Firebase Auth ID tokens sent from the frontend.
//
// SETUP:
//   1. Firebase Console → Project Settings → Service accounts
//   2. Click "Generate new private key" → download JSON file
//   3. Save it as backend/serviceAccountKey.json
//   4. That file is gitignored — never commit it
//
// Alternatively, set GOOGLE_APPLICATION_CREDENTIALS env var
// to the path of the service account JSON file.

'use strict';

var admin = require('firebase-admin');
var path  = require('path');
var fs    = require('fs');

var keyPath = path.join(__dirname, 'serviceAccountKey.json');

if (!admin.apps.length) {
  if (fs.existsSync(keyPath)) {
    var serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  } else {
    // Dev fallback: no auth verification (remove in production)
    console.warn('[WARN] No Firebase service account found. Token verification disabled.');
    admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'dsa-quest' });
  }
}

module.exports = admin;