#!/usr/bin/env node
/* Run the triage rules on REAL leads, privately, and print ONLY aggregates.
 *
 *   node scripts/private-run.js <file> [--json]
 *
 * <file> must live OUTSIDE any git repository (the script refuses otherwise), so real names,
 * phones and addresses can never be committed by accident. Nothing is written to disk.
 *
 * Accepted inputs (detected automatically):
 *   1. Template CSV: received, source, name, phone, email, location, role, project, units, budget,
 *      timeline, plans, message, team_action, team_action_at, exclude
 *   2. A Meta Leads Center CSV export (comma or tab separated, UTF-8 or UTF-16), with two columns
 *      added by hand: team_action and team_action_at
 *   3. A .txt file of website lead emails pasted one after another, each separated by a line of
 *      five or more dashes, with "Team action:" and "Team action at:" lines added by hand
 *
 * team_action is what the team actually did first, as one of:
 *   book, info, trade, order, decline, spam, duplicate, none (nothing yet)
 * Rows whose exclude column is y/yes/true, or whose name or message contains the word TEST, are skipped.
 *
 * Output: counts only. No name, phone, email, town or message text is printed; the script checks its
 * own output for every one of them and refuses to print if any would leak.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const triage = require('../src/triage.js');
const metrics = require('../eval/metrics.js');

const LANES = ['book', 'info', 'trade', 'order', 'decline', 'spam', 'duplicate'];
const SYNONYM = { measure: 'book', booked: 'book', 'book measure': 'book', 'needs info': 'info', 'trade desk': 'trade', 'order-taking': 'order',
  'not a fit': 'decline', declined: 'decline', dup: 'duplicate', 'no action': 'none', '': 'none' };

function insideGitRepo(p) {
  let dir = path.dirname(path.resolve(p));
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function decode(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
  if (buf[0] === 0xFE && buf[1] === 0xFF) { const b = Buffer.from(buf.slice(2)); b.swap16(); return b.toString('utf16le'); }
  const s = buf.toString('utf8');
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const d = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map(h => h.trim().toLowerCase());
  return rows.filter(r => r.some(v => v.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

/** ISO time with any offset -> ET wall clock "YYYY-MM-DDTHH:MM". */
function toEt(s) {
  const t = Date.parse(String(s || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (Number.isNaN(t)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const META_SYSTEM = new Set(['id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'form_id', 'form_name',
  'is_organic', 'platform', 'lead_status', 'inbox_url', 'full_name', 'first_name', 'last_name', 'phone_number', 'phone', 'email', 'city', 'zip_code', 'post_code',
  'zip', 'state', 'team_action', 'team_action_at', 'exclude']);
function fromMeta(r) {
  const extra = Object.entries(r).filter(([k, v]) => !META_SYSTEM.has(k) && v).map(([k, v]) => `${k.replace(/_/g, ' ').replace(/\?$/, '')}: ${v}`);
  return {
    received: toEt(r.created_time), source: 'Meta ad', name: r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' '),
    phone: String(r.phone_number || r.phone || '').replace(/^p:/, ''), email: r.email || '',
    location: [r.city, r.zip_code || r.post_code || r.zip].filter(Boolean).join(' '),
    message: extra.join('. '), team_action: r.team_action, team_action_at: r.team_action_at, exclude: r.exclude
  };
}
function fromEmails(text) {
  return text.split(/^-{5,}\s*$/m).map(b => b.trim()).filter(Boolean).map(b => {
    const get = k => { const m = b.match(new RegExp('^' + k + ':\\s*(.*)$', 'mi')); return m ? m[1].trim() : ''; };
    return { received: toEt(get('Submitted')), source: 'Website form', name: get('Name'), phone: get('Phone'), email: get('Email'),
      location: get('City') || get('Address'), timeline: get('Timeline'), message: get('Notes'),
      team_action: get('Team action'), team_action_at: get('Team action at') };
  });
}

function load(file) {
  const text = decode(fs.readFileSync(file));
  if (/\.txt$/i.test(file)) return fromEmails(text);
  const rows = parseCsv(text);
  return rows.map(r => ('created_time' in r || 'full_name' in r || 'phone_number' in r ? fromMeta(r) : r));
}

function aggregate(rows) {
  const isTest = r => /\bTEST\b/.test(`${r.name || ''} ${r.message || ''}`) || /^(y|yes|true|1)$/i.test(r.exclude || '');
  const kept = rows.filter(r => !isTest(r));
  const reqs = kept.map((r, i) => ({
    id: `L-${String(i + 1).padStart(2, '0')}`, received: (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.received || '') ? r.received : toEt(r.received)) || '2026-11-16T12:00',
    form: { name: r.name || '', role: r.role || '', location: r.location || '', project: r.project || '', units: r.units || '', budget: r.budget || '',
      timeline: r.timeline || '', phone: r.phone || '', email: r.email || '', source: r.source || 'Website form', plans: r.plans || '', message: r.message || '' }
  }));
  const res = triage.runAll(reqs);
  const team = kept.map(r => { const v = String(r.team_action || '').trim().toLowerCase(); return SYNONYM[v] || (LANES.includes(v) || v === 'none' ? v : 'unknown'); });
  const count = a => a.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
  const pairs = {}; let agree = 0, compared = 0, harmful = 0;
  res.forEach((r, i) => {
    if (team[i] === 'none' || team[i] === 'unknown') return;
    compared++;
    if (r.lane === team[i]) agree++;
    else {
      const k = `${r.lane} -> ${team[i]}`; pairs[k] = (pairs[k] || 0) + 1;
      const sev = metrics.severity(team[i], r.lane); if (sev && sev.harmful) harmful++;
    }
  });
  const wallOrEt = v => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v || '') ? v : toEt(v)); // plain "YYYY-MM-DDTHH:MM" is read as ET
  const waits = kept.map(r => ({ a: wallOrEt(r.received), b: wallOrEt(r.team_action_at) }))
    .filter(x => x.a && x.b).map(x => (Date.parse(x.b + ':00Z') - Date.parse(x.a + ':00Z')) / 6e4).sort((x, y) => x - y);
  return {
    leads: kept.length, excluded: rows.length - kept.length,
    toolSuggests: count(res.map(r => r.lane)), teamDid: count(team),
    compared, agree, disagreements: pairs, harmfulIfApproved: harmful,
    draftsAskingFor: { budget: res.filter(r => r.ask.includes('budget')).length, timeline: res.filter(r => r.ask.includes('timeline')).length,
      phone: res.filter(r => r.ask.includes('phone')).length, location: res.filter(r => r.ask.includes('location')).length },
    flaggedUrgent: res.filter(r => r.urgent).length,
    placesNotRecognised: res.filter(r => !(r.q.place && r.q.place.known)).length,
    teamMinutesToFirstAction: waits.length ? { n: waits.length, median: waits[Math.floor((waits.length - 1) / 2)], max: waits[waits.length - 1] } : null,
    _secrets: kept.flatMap(r => [r.name, r.email, String(r.phone || '').replace(/\D/g, '').slice(-7), r.location, ...String(r.name || '').split(/\s+/).filter(w => w.length >= 3)]
      .concat(String(r.message || '').split(/\s+/).reduce((acc, _, j, w) => (j + 4 <= w.length ? acc.concat(w.slice(j, j + 4).join(' ')) : acc), [])))
      .filter(s => s && String(s).trim().length >= 3)
  };
}

function render(a) {
  const lines = [];
  lines.push(`Real leads run: ${a.leads} (excluded ${a.excluded} test or excluded row${a.excluded === 1 ? '' : 's'})`);
  lines.push(`Tool would suggest: ${Object.entries(a.toolSuggests).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push(`Team actually did: ${Object.entries(a.teamDid).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push(`Agreement: ${a.agree} of ${a.compared} leads with a recorded team action`);
  if (Object.keys(a.disagreements).length) lines.push(`Disagreements (tool -> team): ${Object.entries(a.disagreements).map(([k, v]) => `${k} x${v}`).join(', ')}`);
  lines.push(`Disagreements that would have been harmful if approved as proposed: ${a.harmfulIfApproved}`);
  lines.push(`Drafts that would ask for: budget ${a.draftsAskingFor.budget}, timeline ${a.draftsAskingFor.timeline}, phone ${a.draftsAskingFor.phone}, location ${a.draftsAskingFor.location}`);
  lines.push(`Places the tool could not recognise: ${a.placesNotRecognised} · flagged urgent: ${a.flaggedUrgent}`);
  if (a.teamMinutesToFirstAction) lines.push(`Team minutes from arrival to first action: median ${Math.round(a.teamMinutesToFirstAction.median)}, longest ${Math.round(a.teamMinutesToFirstAction.max)} (n=${a.teamMinutesToFirstAction.n})`);
  if (a.leads < 30) lines.push(`Small sample (n=${a.leads}): read these as individual cases, not rates.`);
  return lines.join('\n');
}

function leaks(out, secrets) {
  const digits = out.replace(/\D/g, '');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return secrets.filter(s => (/^\d{7}$/.test(s) ? digits.includes(s) : new RegExp('(^|\\W)' + esc(String(s)) + '($|\\W)', 'i').test(out)));
}

function main(argv) {
  const file = argv.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: node scripts/private-run.js <file outside any git repo> [--json]'); return 2; }
  const repo = insideGitRepo(file);
  if (repo) { console.error(`Refusing: ${path.resolve(file)} is inside a git repository (${repo}). Move it to a private folder outside any repo, then run again.`); return 3; }
  if (!fs.existsSync(file)) { console.error('No such file.'); return 2; }
  const a = aggregate(load(file));
  const secrets = a._secrets; delete a._secrets;
  const out = argv.includes('--json') ? JSON.stringify(a, null, 1) : render(a);
  const bad = leaks(out, secrets);
  if (bad.length) { console.error(`Refusing to print: the output would contain ${bad.length} piece(s) of lead data. Nothing was printed.`); return 4; }
  console.log(out);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, parseCsv, toEt, fromEmails, fromMeta, aggregate, render, leaks, insideGitRepo, decode };
