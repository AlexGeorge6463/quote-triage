'use strict';
// Exercises the private harness on SYNTHETIC fixtures written to the OS temp folder (outside the repo).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('../scripts/private-run.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'private-run.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-private-'));
const run = (file, extra = []) => { try { return { code: 0, out: execFileSync('node', [SCRIPT, file, ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };

const TEMPLATE = `received,source,name,phone,email,location,role,project,units,budget,timeline,plans,message,team_action,team_action_at,exclude
2026-11-12T10:00,Meta ad,Zelda Q.,407-555-0141,zelda.q@example.com,Winter Park,Homeowner,Kitchen,1,$10–20K,1–3 months,No,"Want white shaker, galley kitchen",book,2026-11-12T10:40,
2026-11-12T19:30,Website form,Yorick W.,407-555-0142,,Sanford,,,,,,,"Kitchen redo",book,2026-11-13T09:05,
2026-11-13T08:00,Website form,TEST lead,407-555-0143,,Orlando,,,,,,,TEST row,none,,
`;

test('refuses an input file that sits inside a git repository', () => {
  const r = run(path.join(__dirname, 'nonexistent-private.csv'));
  assert.equal(r.code, 3);
  assert.match(r.out, /Refusing/);
});

test('template CSV: prints only aggregates and never a name, phone, email, town or message', () => {
  const f = path.join(dir, 'leads.csv');
  fs.writeFileSync(f, TEMPLATE);
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Real leads run: 2 \(excluded 1/);
  assert.match(r.out, /Agreement: \d of 2/);
  assert.match(r.out, /Team minutes from arrival to first action: median 40/);
  for (const s of ['Zelda', 'Yorick', '0141', '0142', 'example.com', 'Winter Park', 'Sanford', 'shaker', 'galley']) assert.ok(!r.out.includes(s), `leaked ${s}`);
});

test('a website lead with only name, phone and city is asked for timeline and budget (the Sep 23 form gap)', () => {
  const f = path.join(dir, 'leads2.csv');
  fs.writeFileSync(f, TEMPLATE);
  const a = JSON.parse(run(f, ['--json']).out);
  assert.equal(a.draftsAskingFor.budget, 1);
  assert.equal(a.disagreements['info -> book'], 1);
});

test('Meta Leads Center export (UTF-16, tab separated) is read, with custom questions folded into the message', () => {
  const tsv = ['id\tcreated_time\tad_id\tform_name\tplatform\twhat_room_is_this_for?\tfull_name\tphone_number\temail\tcity\tteam_action\tteam_action_at',
    'l:1\t2026-11-12T15:04:00-05:00\tag:1\tKitchen form\tfb\tkitchen\tVesna K.\tp:+14075550144\tvesna.k@example.com\tKissimmee\tbook\t2026-11-12T16:00'].join('\n');
  const f = path.join(dir, 'meta.csv');
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(tsv, 'utf16le')]));
  const a = JSON.parse(run(f, ['--json']).out);
  assert.equal(a.leads, 1);
  assert.equal(a.placesNotRecognised, 0);
  assert.equal(a.teamMinutesToFirstAction.median, 56);
});

test('pasted website lead emails are parsed', () => {
  const email = ['New consultation request', '', 'Name:      Ulric P.', 'Phone:     407-555-0145', 'City:      Oviedo', 'Best time: evenings', '', 'Submitted: 2026-11-15T19:03:00.000Z', 'Ref:       x1', 'Team action: book', 'Team action at: 2026-11-15T15:10'].join('\n');
  const f = path.join(dir, 'emails.txt');
  fs.writeFileSync(f, email + '\n-----\n' + email.replace('Ulric P.', 'TEST person'));
  const a = JSON.parse(run(f, ['--json']).out);
  assert.equal(a.leads, 1);
  assert.equal(a.excluded, 1);
  assert.equal(a.teamMinutesToFirstAction.median, 67); // 19:03Z is 14:03 ET; action at 15:10 ET
});

test('the leak check catches a name, an email or a phone in the output', () => {
  assert.deepEqual(H.leaks('Agreement: 1 of 1', ['Zelda', 'zelda.q@example.com', '5550141']), []);
  assert.equal(H.leaks('hello Zelda', ['Zelda']).length, 1);
  assert.equal(H.leaks('call 407-555-0141', ['5550141']).length, 1);
});
