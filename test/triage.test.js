'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const triage = require('../src/triage.js');

let n = 0;
const req = (over = {}, at = '2026-11-09T09:00') => ({ id: `T-${++n}`, received: at, form: Object.assign({ name: 'Test A.', role: 'Homeowner', location: 'Orlando', project: 'Kitchen', units: '', budget: '$10–20K', timeline: '1–3 months', phone: `407-555-01${String(n % 100).padStart(2, '0')}`, email: `t${n}@example.com`, source: 'Meta ad', plans: 'No', message: '' }, over) });
const one = r => triage.runAll([r])[0];

test('a complete in-area homeowner gets Book measure', () => assert.equal(one(req()).lane, 'book'));
test('missing details in area get Needs info, asking only for what is missing', () => {
  const r = one(req({ phone: '', budget: '' }));
  assert.equal(r.lane, 'info');
  assert.deepEqual(r.ask, ['phone', 'budget']);
});
test('an unplaceable location asks for a city or ZIP instead of guessing', () => {
  const r = one(req({ location: 'near Orlando' }));
  assert.equal(r.lane, 'info');
  assert.deepEqual(r.ask, ['location']);
});
test('outside the four counties is Order-taking, even with details missing', () => assert.equal(one(req({ location: 'Tampa', phone: '' })).lane, 'order'));
test('10 or more units is the Trade desk, and is checked before the service area', () => {
  assert.equal(one(req({ role: 'Builder / developer', units: '120', location: 'Lakeland' })).lane, 'trade');
  assert.deepEqual(one(req({ role: 'Builder / developer', units: '40', plans: 'No' })).ask, ['plans']);
});
test('an investor with 2-9 units goes to the Trade desk (Nov 11); with one unit, Book measure', () => {
  assert.equal(one(req({ role: 'Investor / landlord', units: '4' })).lane, 'trade');
  assert.equal(one(req({ role: 'Investor / landlord', units: '1' })).lane, 'book');
});
test('a remodeler with one job always gets Book measure (Nov 11)', () => assert.equal(one(req({ role: 'Contractor / remodeler', units: '1', plans: 'Yes' })).lane, 'book'));
test('spam is caught first, and a spam "URGENT" is never flagged urgent', () => {
  const r = one(req({ name: 'Ranking Pros', location: '', project: '', phone: '', message: 'URGENT: our SEO agency guarantees the first page of Google. https://x.example' }));
  assert.equal(r.lane, 'spam');
  assert.equal(r.urgent, false);
  assert.equal(r.draft, null, 'spam gets no reply');
});
test('install-only gets Not a fit', () => assert.equal(one(req({ message: 'I already have the cabinets, just need an installer.' })).lane, 'decline'));

test('a resubmission with the same email merges into the first and says what it fills in', () => {
  const a = req({ phone: '', timeline: '', email: 'same@example.com' }, '2026-11-08T11:00');
  const b = req({ phone: '(407) 555-0177', email: 'Same@Example.com', message: 'Forgot my number.' }, '2026-11-09T08:00');
  const [ra, rb] = triage.runAll([a, b]);
  assert.equal(ra.lane, 'info');
  assert.equal(rb.lane, 'duplicate');
  assert.equal(rb.duplicateOf, a.id);
  assert.deepEqual(rb.dup.fills.sort(), ['phone', 'timeline']);
});
test('the same contractor with a job in another city is a new request, not a duplicate', () => {
  const a = req({ role: 'Contractor / remodeler', email: 'gc@example.com', location: 'Sanford' }, '2026-11-01T10:00');
  const b = req({ role: 'Contractor / remodeler', email: 'gc@example.com', location: 'Tavares', project: 'Bathroom' }, '2026-11-05T10:00');
  assert.equal(triage.runAll([a, b])[1].lane, 'book');
});
test('a repeat after the 14-day window is a new request', () => {
  const a = req({ email: 'late@example.com' }, '2026-10-01T10:00');
  const b = req({ email: 'late@example.com' }, '2026-10-20T10:00');
  assert.equal(triage.runAll([a, b])[1].lane, 'book');
});
test('urgent leads sort first, screen-outs last', () => {
  const rs = triage.runAll([req({ message: 'Spam? no.' }), req({ message: 'Water damage from a leak.' }), req({ message: 'I already have the cabinets, just need an installer.' })]);
  const sorted = rs.slice().sort(triage.priority);
  assert.equal(sorted[0].urgent, true);
  assert.equal(sorted[2].lane, 'decline');
});
test('every decision carries reasons a person can read', () => {
  for (const over of [{}, { phone: '' }, { location: 'Tampa' }, { role: 'Investor / landlord', units: '3' }]) {
    const r = one(req(over));
    assert.ok(r.reasons.length >= 1);
    r.reasons.forEach(line => assert.ok(line.length < 200 && /[.]$/.test(line), line));
  }
});
