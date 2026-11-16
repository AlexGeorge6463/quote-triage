'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/requests.js');
const triage = require('../src/triage.js');

// Guardrails checked on every one of the SYNTHETIC requests, not on a hand-picked few.
const results = triage.runAll(data.requests);

test('no draft states a price, a discount or a percentage', () => {
  for (const r of results) if (r.draft) assert.doesNotMatch(r.draft, /\$|\d+\s*%|percent|discount|\boff\b|per cabinet|price is/i, r.id);
});
test('no draft promises installation or an installer', () => {
  for (const r of results) if (r.draft) assert.doesNotMatch(r.draft, /we (?:can|will|'ll) install|installation included|recommend (?:an|a) installer|installer referral/i, r.id);
});
test('a lead that mentions installing is told up front that QBC does not install', () => {
  const asked = results.filter(r => r.draft && /\binstall/i.test(r.q.message));
  assert.ok(asked.length > 0);
  for (const r of asked) assert.match(r.draft, /don't (?:install|do installation)/, r.id);
});
test('nothing the customer typed reaches a reply (prompt injection has no path in)', () => {
  for (const r of results) {
    if (!r.draft || !r.q.message) continue;
    const words = r.q.message.split(/\s+/);
    for (let i = 0; i + 6 <= words.length; i++) assert.ok(!r.draft.includes(words.slice(i, i + 6).join(' ')), `${r.id} echoes the message`);
  }
  for (const r of results.filter(x => x.q.signals.injection)) {
    assert.ok(['book', 'info', 'order', 'trade'].includes(r.lane), `${r.id} still routed as a lead`);
    assert.doesNotMatch(r.draft, /ignore|system|\$1|60%|50%/i);
  }
});
test('Needs info drafts ask for exactly the missing fields', () => {
  const words = { location: 'city or ZIP', phone: 'phone number', timeline: 'timeline', budget: 'budget' };
  for (const r of results.filter(x => x.lane === 'info')) {
    for (const [k, w] of Object.entries(words)) {
      if (r.ask.includes(k)) assert.match(r.draft, new RegExp(w), `${r.id} should ask for ${k}`);
      else assert.doesNotMatch(r.draft, new RegExp(w), `${r.id} should not ask for ${k}`);
    }
  }
});
test('spam and duplicates get no reply; every other lane gets one', () => {
  for (const r of results) {
    if (r.lane === 'spam' || r.lane === 'duplicate') assert.equal(r.draft, null, r.id);
    else assert.ok(r.draft && r.draft.length > 40, r.id);
  }
});
test('no draft names a person on the QBC side; a call is promised by "the QBC team"', () => {
  for (const r of results) if (r.draft && /call you/.test(r.draft)) assert.match(r.draft, /The QBC team/, r.id);
  // Names to keep out of replies are supplied privately (QT_DENY_NAMES=a,b), never committed.
  const deny = (process.env.QT_DENY_NAMES || '').split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
  for (const r of results) if (r.draft) for (const n of deny) assert.ok(!r.draft.toLowerCase().includes(n), r.id);
});
test('the draft cannot change the lane: an out-of-area reply never offers a measure', () => {
  for (const r of results.filter(x => x.lane === 'order')) assert.doesNotMatch(r.draft, /free in-home measure|\[slot/, r.id);
  for (const r of results.filter(x => x.lane === 'book')) assert.match(r.draft, /free in-home measure/, r.id);
});
