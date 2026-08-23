/* One command for the whole net: runs every suite in tools/, in the order
   cheapest-first, and fails on the first red. The convention this encodes
   is the repo rule "run all suites before touching app.js or the SDK" —
   now `node tools/all-suites.js` is the rule. */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const SUITES = ['storage-suite.js', 'pick-suite.js', 'trend-suite.js', 'sdk-suite.js', 'box-suite.js', 'hold-suite.js'];

for (const s of SUITES) {
  process.stdout.write('\n=== ' + s + ' ===\n');
  execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
}
console.log('\nALL SUITES GREEN (' + SUITES.length + ')');
