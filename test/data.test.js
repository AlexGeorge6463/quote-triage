'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/requests.js');
const json = require('../data/requests.json');

const reqs = data.requests;

test('the browser copy and the JSON copy of the data are identical', () => {
  assert.deepEqual(data, json);
});

test('the generator is deterministic: rerunning it reproduces the committed data', () => {
  const path = require.resolve('../scripts/generate.js');
  delete require.cache[path];
  const fresh = require(path);
  assert.deepEqual(JSON.parse(JSON.stringify(fresh)), json);
});

test('the set is labelled SYNTHETIC and is large enough to mean something', () => {
  assert.equal(data.synthetic, true);
  assert.match(data.note, /SYNTHETIC/);
  assert.ok(reqs.length >= 150, `only ${reqs.length} requests`);
  assert.ok(reqs.filter(r => r.split === 'holdout').length >= 35);
});

test('no real contact details: phones are 555-01xx and emails use example domains', () => {
  for (const r of reqs) {
    const digits = r.form.phone.replace(/\D/g, '');
    if (digits.length >= 10) assert.match(digits.slice(-7), /^55501\d\d$/, `${r.id} phone ${r.form.phone}`);
    if (r.form.email) assert.match(r.form.email, /@([a-z0-9-]+\.)*example(\.com)?$/i, `${r.id} email ${r.form.email}`);
    assert.doesNotMatch(r.form.message + r.form.location, /\b\d{2,5}\s+[A-Z][a-z]+\s+(St|Ave|Rd|Blvd|Dr|Ln|Ct)\b/, `${r.id} looks like a street address`);
  }
});

test('a shared phone number always belongs to the same person', () => {
  const owner = new Map();
  for (const r of reqs) {
    const d = r.form.phone.replace(/\D/g, '').slice(-10);
    if (d.length < 10) continue;
    if (owner.has(d)) assert.equal(owner.get(d), r.form.name, `${d} used by two people`);
    owner.set(d, r.form.name);
  }
});

test('every label is complete and consistent', () => {
  const ids = new Set(reqs.map(r => r.id));
  assert.equal(ids.size, reqs.length, 'ids are unique');
  const lanes = ['book', 'info', 'trade', 'order', 'duplicate', 'spam', 'decline'];
  for (const r of reqs) {
    assert.ok(lanes.includes(r.label.lane), `${r.id} lane ${r.label.lane}`);
    assert.ok(r.label.why && r.label.why.length > 10, `${r.id} has a reason for its label`);
    if (r.label.lane === 'info') assert.ok(r.label.ask.length > 0, `${r.id} Needs info must say what to ask`);
    if (r.label.lane === 'duplicate') {
      const orig = reqs.find(x => x.id === r.label.duplicateOf);
      assert.ok(orig, `${r.id} duplicate target exists`);
      assert.ok(orig.received < r.received, `${r.id} comes after its original`);
    }
  }
});

test('every request was received before the sample clock', () => {
  const clock = Date.parse(data.clock);
  for (const r of reqs) assert.ok(Date.parse(r.received + ':00-05:00') <= clock, `${r.id} ${r.received}`);
});
