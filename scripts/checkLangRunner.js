// Shows exactly what langRunner is loaded in your backend
// Run: node backend/scripts/checkLangRunner.js

var path = require('path');
var fs   = require('fs');

var filePath = path.join(__dirname, '../services/langRunner.js');
var content  = fs.readFileSync(filePath, 'utf8');

console.log('File path:', filePath);
console.log('First 300 chars:');
console.log('---');
console.log(content.slice(0, 300));
console.log('---');
console.log('Contains "wandbox":', content.toLowerCase().includes('wandbox'));
console.log('Contains "piston":', content.toLowerCase().includes('piston'));
console.log('Contains "judge0":', content.toLowerCase().includes('judge0'));
console.log('Contains "vm" (local eval):', content.includes("require('vm')"));