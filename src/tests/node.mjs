/* Headless test runner. `npm test` — no dependencies, no build.
   The browser runner in tests.html executes the same suite file. */
import { runAll } from './harness.js';
import './engines.test.js';
import './phases.test.js';

const { results, passed, failed, total } = await runAll();

for (const suite of results) {
  console.log(`\n  ${suite.name}`);
  for (const t of suite.tests) {
    console.log(t.pass ? `    \x1b[32mPASS\x1b[0m  ${t.label}`
                       : `    \x1b[31mFAIL\x1b[0m  ${t.label}\n          ${t.error}`);
  }
}

console.log(`\n  ${passed}/${total} passed${failed ? `, \x1b[31m${failed} failed\x1b[0m` : ''}\n`);
process.exit(failed ? 1 : 0);
