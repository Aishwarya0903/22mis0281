

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Log } = require('./logger');

async function run() {
 
  const ok = await Log('backend', 'info', 'middleware', 'logger smoke test');
  process.stdout.write(`happy path -> ${ok.ok ? 'PASS' : 'FAIL'}: ${JSON.stringify(ok)}\n`);

  
  const badStack = await Log('Backend', 'info', 'middleware', 'should fail');
  process.stdout.write(`bad stack  -> ${badStack.reason === 'validation' ? 'PASS' : 'FAIL'}: ${JSON.stringify(badStack)}\n`);

  
  const badPkg = await Log('backend', 'info', 'component', 'should fail');
  process.stdout.write(`bad pkg    -> ${badPkg.reason === 'validation' ? 'PASS' : 'FAIL'}: ${JSON.stringify(badPkg)}\n`);

  
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
