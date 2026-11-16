'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/requests.js');
const metrics = require('../eval/metrics.js');
const triage = require('../src/triage.js');
const baseline = require('../eval/baseline-v1.js');
const results = require('../eval/results.json');

const after = metrics.score(data.requests, triage.runAll(data.requests));
const before = metrics.score(data.requests, baseline.runAll(data.requests));

// The ratchet: these numbers can go up. If one goes down, a change made routing worse.
test('v2 routes at least 156 of 161 requests to the labeled action', () => assert.ok(after.laneOk >= 156, `${after.laneOk}`));
test('v2 makes no harmful miss (no lead screened out, no wrong measure promise)', () => assert.equal(after.harmful, 0, JSON.stringify(after.misses.filter(m => m.harmful))));
test('the holdout split stays at or above 35 of 40', () => assert.ok(after.splits.holdout.ok >= 35));
test('v1 still reproduces its published baseline of 85/161', () => assert.equal(before.laneOk, 85));
test('the committed report matches a fresh run', () => {
  assert.equal(results.after.laneOk, after.laneOk);
  assert.equal(results.before.laneOk, before.laneOk);
  assert.deepEqual(results.after.confusion, after.confusion);
});
test('severity: a lead screened out or a wrong measure promise is harmful; an extra question is not', () => {
  assert.equal(metrics.severity('book', 'spam').harmful, true);
  assert.equal(metrics.severity('book', 'order').harmful, true);
  assert.equal(metrics.severity('order', 'book').harmful, true);
  assert.equal(metrics.severity('order', 'info').harmful, false);
  assert.equal(metrics.severity('spam', 'info').harmful, false);
});
