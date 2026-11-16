'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../eval/kpi.js');
const recorded = require('../eval/kpi.json');

const at = s => K.wall(s);
const item = (s, sec = 60, extra = {}) => Object.assign({ arrive: at(s), lead: true, urgent: 0, rank: 0, sec }, extra);

test('the 1-hour clock starts at arrival inside 8am-8pm, and at 8am otherwise', () => {
  assert.equal(K.clockStart(at('2026-11-10T09:15')), at('2026-11-10T09:15'));
  assert.equal(K.clockStart(at('2026-11-10T06:00')), at('2026-11-10T08:00'));
  assert.equal(K.clockStart(at('2026-11-10T21:00')), at('2026-11-11T08:00'));
});
test('checks happen on the cadence inside the window only', () => {
  assert.equal(K.nextCheck(at('2026-11-10T09:10'), 60), at('2026-11-10T10:00'));
  assert.equal(K.nextCheck(at('2026-11-10T19:30'), 60), at('2026-11-11T08:00'));
  assert.equal(K.nextCheck(at('2026-11-10T05:00'), 30), at('2026-11-10T08:00'));
});
test('a burst is worked in order at the first check, one item after another', () => {
  const items = Array.from({ length: 20 }, (_, i) => item('2026-11-10T07:00', 180, { arrive: at('2026-11-10T07:00') + i * 0.1 }));
  const done = K.simulate(items, 60, 'fifo');
  assert.equal(Math.round(done[0] - at('2026-11-10T08:00')), 3);
  assert.equal(Math.round(done[19] - at('2026-11-10T08:00')), 60);
  done.forEach((d, i) => assert.ok(d >= items[i].arrive));
});
test('the tool works urgent items first; the manual reader works in arrival order', () => {
  const items = [item('2026-11-10T07:00', 600), item('2026-11-10T07:30', 600, { urgent: 1 })];
  assert.ok(K.simulate(items, 60, 'priority')[1] < K.simulate(items, 60, 'priority')[0]);
  assert.ok(K.simulate(items, 60, 'fifo')[0] < K.simulate(items, 60, 'fifo')[1]);
});
test('nothing is started after 8pm', () => {
  const done = K.simulate([item('2026-11-10T19:45', 60)], 60, 'fifo');
  assert.equal(Math.round(done[0]), at('2026-11-11T08:00') + 1);
});
test('the reviewer model: a wrong suggestion costs time; typing from scratch costs more than a template', () => {
  const req = { form: { message: 'Kitchen in Orlando.', location: 'Orlando', phone: '407-555-0100', budget: '$10–20K', timeline: '1–3 months' }, label: { lane: 'book', ask: [] } };
  const right = { lane: 'book', ask: [], reasons: ['Orlando is in the area.'], draft: 'Hi, we do a free in-home measure.', q: { signals: { mentionsInstall: false }, name: 'A B.', type: 'Homeowner', scope: 'kitchen', place: { known: true, city: 'Orlando' } } };
  const wrong = Object.assign({}, right, { lane: 'info', ask: ['budget'] });
  assert.ok(K.toolSeconds(req, wrong) > K.toolSeconds(req, right));
  assert.ok(K.manualSeconds(req, right, 'scratch') > K.manualSeconds(req, right, 'template'));
});
test('the committed KPI report matches a fresh run (compute timing excluded)', () => {
  const fresh = JSON.parse(JSON.stringify(K.run({ timing: false })));
  fresh.computeMsPerRequest = recorded.computeMsPerRequest;
  assert.deepEqual(fresh, recorded);
});
