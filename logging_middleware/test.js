/**
 * Sanity test for the logging middleware.
 * Run with `node test.js` after setting up `.env` in a sibling app folder
 * or exporting EVAL_* vars into your shell.
 *
 * This is not a unit test framework — it's a manual smoke test that hits
 * the live test server and prints whether the response shape is what we
 * expected. Helpful when you're not sure if your env vars are right.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Log } = require('./logger');

async function run() {
  // 1. Happy path
  const ok = await Log('backend', 'info', 'middleware', 'logger smoke test');
  process.stdout.write(`happy path -> ${ok.ok ? 'PASS' : 'FAIL'}: ${JSON.stringify(ok)}\n`);

  // 2. Bad stack
  const badStack = await Log('Backend', 'info', 'middleware', 'should fail');
  process.stdout.write(`bad stack  -> ${badStack.reason === 'validation' ? 'PASS' : 'FAIL'}: ${JSON.stringify(badStack)}\n`);

  // 3. Bad package for stack (frontend pkg on backend stack)
  const badPkg = await Log('backend', 'info', 'component', 'should fail');
  process.stdout.write(`bad pkg    -> ${badPkg.reason === 'validation' ? 'PASS' : 'FAIL'}: ${JSON.stringify(badPkg)}\n`);

  // 4. Concurrent calls should share one auth round trip
  const burst = await Promise.all([
    Log('backend', 'debug', 'middleware', 'burst 1'),
    Log('backend', 'debug', 'middleware', 'burst 2'),
    Log('backend', 'debug', 'middleware', 'burst 3'),
  ]);
  const allOk = burst.every(r => r.ok);
  process.stdout.write(`burst      -> ${allOk ? 'PASS' : 'FAIL'}\n`);
}

run().catch(err => {
  process.stderr.write(`test runner threw: ${err.message}\n`);
  process.exit(1);
});
