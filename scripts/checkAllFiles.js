var fs   = require('fs');
var path = require('path');

function check(filePath) {
  var full    = path.join(__dirname, '..', filePath);
  var content = fs.readFileSync(full, 'utf8');
  console.log('\n=== ' + filePath + ' (first 5 imports) ===');
  content.split('\n').filter(function(l) {
    return l.includes('require(');
  }).slice(0, 5).forEach(function(l) { console.log(' ', l.trim()); });
}

check('routes/judge.js');
check('services/judge.js');
check('services/langRunner.js');