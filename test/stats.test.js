'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { wilson, bootstrap, quantile } = require('../eval/stats.js');
const near = (a, b, tol = 0.001) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('Wilson interval matches published values', () => {
  // 0/161: upper bound ~2.33%; 0/60: ~6.02%; 81/263 (Newcombe 1998 example style): sanity on a middle value
  near(wilson(0, 161).hi, 0.0233);
  near(wilson(0, 60).hi, 0.0602);
  const w = wilson(32, 60);
  near(w.lo, 0.4086); near(w.hi, 0.6540);
  assert.equal(wilson(0, 0).p, null);
});
test('bootstrap is seeded and brackets the estimate', () => {
  const xs = Array.from({ length: 50 }, (_, i) => i % 5);
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const a = bootstrap(xs, mean), b = bootstrap(xs, mean);
  assert.deepEqual(a, b);
  assert.ok(a.lo <= a.est && a.est <= a.hi);
});
test('quantile interpolates', () => { assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5); assert.equal(quantile([], 0.5), null); });
