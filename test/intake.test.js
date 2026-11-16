'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const places = require('../src/places.js');
const intake = require('../src/intake.js');

const form = (over = {}) => ({ id: 'T-1', received: '2026-11-09T09:00', form: Object.assign({ name: 'Test A.', role: 'Homeowner', location: 'Orlando', project: 'Kitchen', units: '', budget: '$10–20K', timeline: '1–3 months', phone: '407-555-0100', email: 'test.a@example.com', source: 'Meta ad', plans: 'No', message: '' }, over) });

test('the measure area is exactly Orange, Seminole, Osceola and Lake (Nov 11)', () => {
  assert.deepEqual(places.MEASURE_COUNTIES, ['Orange', 'Seminole', 'Osceola', 'Lake']);
  assert.equal(places.resolve('Davenport').inArea, false, 'Polk is out');
  assert.equal(places.resolve('Clermont').inArea, true, 'Lake is in');
});

test('locations are read however people type them', () => {
  const cases = { 'winter park, fl': 'Winter Park', '32789': 'Winter Park', 'Oviedo FL 32765': 'Oviedo', 'Lake Nona': 'Lake Nona',
    'Kissimee': 'Kissimmee', 'St Cloud': 'St. Cloud', 'Saint Cloud': 'St. Cloud', 'Mt Dora': 'Mount Dora', 'Altamonte': 'Altamonte Springs',
    'Sandford': 'Sanford', 'Celebration': 'Celebration', '33844': 'Haines City' };
  for (const [typed, city] of Object.entries(cases)) assert.equal(places.resolve(typed).city, city, typed);
});

test('a hedge or an unknown town is not guessed', () => {
  assert.equal(places.resolve('near Orlando').known, false);
  assert.equal(places.resolve('Orlando area').known, false);
  assert.equal(places.resolve('Bartow, FL').known, false);
  assert.equal(places.resolve(''), null, 'blank resolves to nothing');
});

test('out-of-state addresses are known and out of the area', () => {
  const p = places.resolve('Atlanta, GA');
  assert.equal(p.known, true);
  assert.equal(p.inArea, false);
});

test('a blank location box falls back to a place named in the message', () => {
  const q = intake.normalize(form({ location: '', message: 'Galley kitchen. We are in Leesburg.' }));
  assert.equal(q.place.city, 'Leesburg');
  assert.equal(q.place.inArea, true);
});

test('unit counts are read from words, hyphens and building types, and never from rooms or feet', () => {
  const n = t => (intake.unitsFromText(t) || { n: 1 }).n;
  assert.equal(n('Kitchens, 3 condos.'), 3);
  assert.equal(n('Two rental houses between tenants'), 2);
  assert.equal(n('a 286-unit job'), 286);
  assert.equal(n('Five-unit building'), 5);
  assert.equal(n('Own a fourplex'), 4);
  assert.equal(n('Duplex, both sides'), 2);
  assert.equal(n('Kitchen plus two bathroom vanities'), 1);
  assert.equal(n('about 14 feet of cabinets'), 1);
  assert.equal(n('Approval in 24 hours'), 1);
});

test('a partial phone number counts as missing', () => {
  assert.equal(intake.normalize(form({ phone: '407-555' })).phone, null);
  assert.equal(intake.normalize(form({ phone: '+1 407 555 0100' })).phone, '4075550100');
  assert.equal(intake.normalize(form({ phone: '(407) 555-0100' })).phone, '4075550100');
});

test('rental language makes a self-described homeowner an investor', () => {
  const q = intake.normalize(form({ message: 'Two rental houses need kitchens.' }));
  assert.equal(q.type, 'Investor');
  assert.equal(q.units, 2);
});

test('one spam-ish word in a real lead is not spam; a vendor pitch is', () => {
  assert.equal(intake.normalize(form({ message: 'My neighbor does SEO and recommended you.' })).signals.spam.isSpam, false);
  assert.equal(intake.normalize(form({ message: 'Here is my inspiration: https://example.com/inspo' })).signals.spam.isSpam, false);
  const pitch = form({ name: 'Ranking Co', location: '', project: '', phone: '', message: 'Our SEO agency gets you on the first page of Google. https://x.example' });
  assert.equal(intake.normalize(pitch).signals.spam.isSpam, true);
});

test('install-only is not a fit; cabinets plus a question about installing is a lead', () => {
  assert.equal(intake.normalize(form({ message: 'Already bought cabinets, just need someone to install them.' })).signals.notAFit, 'install only');
  assert.equal(intake.normalize(form({ message: 'Need new kitchen cabinets. Do you also install?' })).signals.notAFit, null);
  assert.equal(intake.normalize(form({ message: 'Just need new quartz countertops, keeping my cabinets.' })).signals.notAFit, 'countertops only');
});

test('urgency is a dated deadline or active damage, not the word ASAP', () => {
  assert.ok(intake.normalize(form({ message: 'Dishwasher leak ruined the sink base.' })).signals.urgent);
  assert.ok(intake.normalize(form({ message: 'We close on the house Nov 20.' })).signals.urgent);
  assert.equal(intake.normalize(form({ timeline: 'ASAP', message: 'Want new cabinets.' })).signals.urgent, null);
  assert.equal(intake.normalize(form({ message: 'Kitchen between tenants.' })).signals.urgent, null);
});

test('every value read is recorded with where it came from', () => {
  const q = intake.normalize(form({ location: '32789', message: 'Two rental houses.' }));
  const city = q.read.find(r => r.field === 'City');
  assert.match(city.from, /ZIP 32789/);
  assert.match(q.read.find(r => r.field === 'Units').from, /message/);
});
