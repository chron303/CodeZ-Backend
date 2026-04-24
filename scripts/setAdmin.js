// backend/scripts/setAdmin.js
//
// Run this script to make a user an admin:
//   node scripts/setAdmin.js <user-uid>
//
// Find the UID in Firebase Console → Authentication → Users

'use strict';

var admin = require('../firebaseAdmin');

var uid = process.argv[2];
if (!uid) {
  console.error('Usage: node scripts/setAdmin.js <user-uid>');
  process.exit(1);
}

admin.firestore().doc('users/' + uid).set({ isAdmin: true }, { merge: true })
  .then(function() {
    console.log('Set isAdmin=true for user:', uid);
    process.exit(0);
  })
  .catch(function(err) {
    console.error('Failed:', err.message);
    process.exit(1);
  });