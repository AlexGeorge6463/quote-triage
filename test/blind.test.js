'use strict';
// The blind holdout was run ONCE (Nov 16) and recorded. This test does not set a target to tune toward:
// it fails if the rules change in a way that moves the recorded result, because BLIND.md would then
// describe rules that no longer exist. If it fails after a deliberate rule change, write a NEW blind
// set to docs/BLIND-SPEC.md instead of re-recording this one.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../eval/blind.js');
const recorded = require('../eval/blind-results.json');

test('the recorded blind result still describes the current rules', () => {
  const now = run();
  assert.equal(now.v2.lane.x, recorded.v2.lane.x, 'v2 lane matches changed: the blind set is now spent; write a new one');
  assert.equal(now.v2.harmful.x, recorded.v2.harmful.x);
  assert.deepEqual(now.v2.confusion, recorded.v2.confusion);
});
test('the blind run recorded zero harmful misses and zero false screen-outs (with their upper bounds)', () => {
  assert.equal(recorded.v2.harmful.x, 0);
  assert.equal(recorded.v2.falseScreen.x, 0);
  assert.ok(recorded.v2.harmful.hi < 0.07);
});
