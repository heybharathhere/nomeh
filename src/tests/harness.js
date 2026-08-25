/* A test harness small enough to read in one sitting.
 *
 * It runs unchanged in a browser (tests.html) and in Node (npm test), which
 * matters because the whole point of keeping the engines pure was that they can
 * be verified without a browser, a build step or a framework.
 */

const suites = [];

export function describe(name, body) {
  const tests = [];
  body({
    it: (label, fn) => tests.push({ label, fn })
  });
  suites.push({ name, tests });
}

export function getSuites() { return suites; }

class AssertionError extends Error {}

export const assert = {
  equal(actual, expected, message) {
    if (actual !== expected) {
      throw new AssertionError(message || `expected ${format(expected)}, got ${format(actual)}`);
    }
  },

  /* Floating-point comparison with an explicit tolerance. Exact equality on
     derived nutrition numbers would make the suite fail on rounding rather than
     on incorrectness. */
  close(actual, expected, tolerance = 0.5, message) {
    if (typeof actual !== 'number' || Number.isNaN(actual)) {
      throw new AssertionError(message || `expected a number near ${expected}, got ${format(actual)}`);
    }
    if (Math.abs(actual - expected) > tolerance) {
      throw new AssertionError(message || `expected ${expected} ±${tolerance}, got ${actual}`);
    }
  },

  ok(value, message) {
    if (!value) throw new AssertionError(message || `expected truthy, got ${format(value)}`);
  },

  notOk(value, message) {
    if (value) throw new AssertionError(message || `expected falsy, got ${format(value)}`);
  },

  isNull(value, message) {
    if (value !== null) throw new AssertionError(message || `expected null, got ${format(value)}`);
  },

  deep(actual, expected, message) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new AssertionError(message || `expected ${b}, got ${a}`);
  },

  throws(fn, message) {
    try { fn(); }
    catch { return; }
    throw new AssertionError(message || 'expected the call to throw');
  }
};

function format(v) {
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}

export async function runAll() {
  const results = [];
  let passed = 0, failed = 0;

  for (const suite of suites) {
    const suiteResult = { name: suite.name, tests: [] };
    for (const test of suite.tests) {
      try {
        await test.fn();
        suiteResult.tests.push({ label: test.label, pass: true });
        passed++;
      } catch (err) {
        suiteResult.tests.push({ label: test.label, pass: false, error: err.message });
        failed++;
      }
    }
    results.push(suiteResult);
  }

  return { results, passed, failed, total: passed + failed };
}
