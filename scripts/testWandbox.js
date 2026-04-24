var https = require('https');

var TESTS = [
  {
    name: 'C++ 17', compiler: 'gcc-13.2.0', options: '-std=c++17\n-O2',
    code: '#include<iostream>\nusing namespace std;\nint main(){cout<<"hello"<<endl;return 0;}',
  },
  {
    name: 'Python 3.12', compiler: 'cpython-3.12.7', options: '',
    code: 'print("hello")',
  },
  {
    name: 'Java', compiler: 'openjdk-jdk-21+35', options: '',
    // Class must be Main (Wandbox names it prog.java internally but compiles by class name)
    code: 'public class Main{\npublic static void main(String[] a){\nSystem.out.println("hello");\n}\n}',
  },
];

function run(t, cb) {
  var body = JSON.stringify({
    compiler: t.compiler,
    code: t.code,
    stdin: '',
    'compiler-option-raw': t.options,
    save: false,
  });
  var opts = {
    hostname: 'wandbox.org', path: '/api/compile.json', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 20000,
  };
  var req = https.request(opts, function(res) {
    var raw = '';
    res.on('data', function(d) { raw += d; });
    res.on('end', function() {
      try {
        var d = JSON.parse(raw);
        if (d.program_output) console.log(t.name, '→ ✓', d.program_output.trim());
        else if (d.compiler_error) console.log(t.name, '→ ✗ compile:', d.compiler_error.slice(0, 150));
        else console.log(t.name, '→ ✗', JSON.stringify(d).slice(0, 150));
      } catch(e) { console.log(t.name, '→ parse error:', raw.slice(0, 150)); }
      cb();
    });
  });
  req.on('error', function(e) { console.log(t.name, '→ Error:', e.message); cb(); });
  req.on('timeout', function() { req.destroy(); console.log(t.name, '→ Timeout'); cb(); });
  req.write(body); req.end();
}

console.log('Testing all 3 languages on Wandbox...\n');
run(TESTS[0], function() {
  run(TESTS[1], function() {
    run(TESTS[2], function() { console.log('\nDone.'); });
  });
});