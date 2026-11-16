'use strict';
// Checks the blind holdout's DATA against docs/BLIND-SPEC.md. It never runs the triage rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const blind = require('../data/blind/requests.json');
const reqs = blind.requests;
const count = (f) => reqs.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});

test('the blind set is SYNTHETIC and matches the spec quotas', () => {
  assert.equal(blind.synthetic, true);
  assert.match(blind.note, /SYNTHETIC/);
  assert.equal(reqs.length, 60);
  assert.deepEqual(count(r => r.label.lane), { book: 20, info: 10, trade: 8, order: 8, spam: 6, duplicate: 4, decline: 4 });
  assert.deepEqual(count(r => r.category), { clean: 13, typos: 12, spanish: 8, voicemail: 9, forwarded: 9, minimal: 9 });
  assert.equal(reqs.filter(r => r.label.urgent).length, 6);
});

test('no real contact details anywhere, including inside messages and transcripts', () => {
  for (const r of reqs) {
    const text = [r.form.phone, r.form.message].join(' ');
    for (const m of text.matchAll(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\b\d{10}\b/g)) {
      assert.match(m[0].replace(/\D/g, '').slice(-7), /^55501\d\d$/, `${r.id} phone ${m[0]}`);
    }
    for (const m of (r.form.email + ' ' + r.form.message).matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)) {
      assert.match(m[0], /@([a-z0-9-]+\.)*example(\.com)?$/i, `${r.id} email ${m[0]}`);
    }
    assert.doesNotMatch(r.form.message, /\b\d{2,5}\s+[A-Z][a-z]+\s+(St|Ave|Rd|Blvd|Dr|Ln|Ct|Way)\b/, `${r.id} street address`);
  }
});

test('labels are complete; duplicates point back in time; urgent only on leads', () => {
  for (const r of reqs) {
    assert.ok(r.label.why.length > 10, r.id);
    if (r.label.lane === 'info') assert.ok(r.label.ask.length, r.id);
    if (r.label.urgent) assert.ok(['book', 'info', 'trade', 'order'].includes(r.label.lane), r.id);
    if (r.label.lane === 'duplicate') {
      const o = reqs.find(x => x.id === r.label.duplicateOf);
      assert.ok(o && o.received < r.received, r.id);
    }
    assert.ok(Date.parse(r.received + ':00-05:00') < Date.parse(blind.clock), r.id);
  }
});

test('the browser copies match their JSON sources', () => {
  assert.deepEqual(require('../data/blind/requests.js'), blind);
  assert.deepEqual(require('../eval/kpi-data.js'), require('../eval/kpi.json'));
  assert.deepEqual(require('../eval/blind-results.js'), require('../eval/blind-results.json'));
});
