#!/usr/bin/env node
/* Business KPIs for Quote Triage, on SYNTHETIC data only.
 *
 *   node eval/kpi.js           print the summary
 *   node eval/kpi.js --write   write eval/KPI.md and eval/kpi.json
 *
 * Three kinds of number, kept apart on purpose:
 *   MEASURED  triage compute time; routing rates against labels (with 95% Wilson intervals).
 *   MODELED   reviewer seconds per request, from the keystroke-level model (Card, Moran & Newell 1980)
 *             plus reading time. Every constant is listed in MODEL below. No human was timed.
 *   SIMULATED time from request to a person-approved next step, by replaying the requests' arrival
 *             times against a reviewer who checks the queue every C minutes inside 8am-8pm.
 *
 * THE MANUAL BASELINE. A person opens each request in arrival order, applies the same written rules
 * without error (the labels are exactly what a careful reader decides), and sends the right reply from
 * a saved template. A second, weaker baseline types each reply from scratch. Because the manual
 * reader is assumed perfect, the tool can only tie it on accuracy; its case has to rest on time, and
 * on not handing the reviewer a harmful suggestion.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const main = require('../data/requests.js');
const blind = require('../data/blind/requests.json');
const triage = require('../src/triage.js');
const drafts = require('../src/drafts.js');
const metrics = require('./metrics.js');
const baseline = require('./baseline-v1.js');
const stats = require('./stats.js');

// ---------- the model: every assumption in one place ----------
const MODEL = {
  K: 0.28,          // s per keystroke, average skilled typist ~40 wpm (KLM)
  P: 1.1,           // s to point with the mouse (KLM)
  B: 0.1,           // s to click (KLM)
  M: 1.35,          // s of mental preparation before an action (KLM)
  readWpm: 238,     // silent reading speed for non-fiction, adults (Brysbaert 2019 meta-analysis)
  composeWpm: 25,   // ASSUMED: typing a reply from scratch; composing is slower than copying
  lookupSec: 10,    // ASSUMED: manual reader looks up the county for a location given only as a ZIP
  fixTypedWords: 6, // ASSUMED: words a reviewer retypes to correct a draft's ask list
  charsPerWord: 6,
  windowStart: 8 * 60, windowEnd: 20 * 60, // QBC callback window, 8am-8pm (from the brief; not in QBC's written decisions)
  targetMin: 60
};
const words = s => (String(s || '').trim().match(/\S+/g) || []).length;
const readSec = n => (n / MODEL.readWpm) * 60;
const typeSec = w => w * MODEL.charsPerWord * MODEL.K;
const LEADS = metrics.LEADS;

function fieldWords(f) {
  return ['location', 'role', 'project', 'units', 'budget', 'timeline', 'phone', 'email', 'source']
    .reduce((n, k) => n + (String(f[k] || '').trim() ? 1 + words(f[k]) : 0), 0);
}
/** The reply a careful person would send for the labeled lane (same wording as the tool, so reply length is equal). */
function rightDraft(req, result) {
  const L = req.label;
  if (L.lane === 'spam' || L.lane === 'duplicate') return '';
  return drafts.write(Object.assign({}, result, { lane: L.lane, ask: L.ask })) || '';
}

/** Reviewer seconds with the tool: read the card, decide, press A. If the suggestion is wrong, fix it first. */
function toolSeconds(req, r) {
  const L = req.label;
  let s = readSec(words(req.form.message) + fieldWords(req.form) + words(r.reasons.join(' ')) + words(r.draft || '')) + MODEL.M + MODEL.K;
  const laneWrong = r.lane !== L.lane;
  const askWrong = !laneWrong && (L.lane === 'info' || L.ask.length) && (r.ask.length !== L.ask.length || r.ask.some(a => !L.ask.includes(a)));
  if (laneWrong) s += MODEL.M + MODEL.K + 2 * (MODEL.P + MODEL.B) + readSec(words(rightDraft(req, r)));
  if (laneWrong || askWrong) s += (L.lane === 'info' || L.ask.length ? MODEL.M + typeSec(MODEL.fixTypedWords) : 0) + MODEL.K;
  return s;
}
/** Reviewer seconds by hand, in arrival order, with saved templates (or typing from scratch). */
function manualSeconds(req, r, mode) {
  const L = req.label, f = req.form;
  let s = readSec(words(f.message) + fieldWords(f)) + 2 * MODEL.M;
  if (/^\s*\d{5}\s*$/.test(f.location || '')) s += MODEL.lookupSec;
  if (L.lane === 'spam') return s + MODEL.P + MODEL.B;
  if (L.lane === 'duplicate') return s + MODEL.M + 2 * (MODEL.P + MODEL.B) + 8 * MODEL.K; // find the first request, link it
  const reply = rightDraft(req, r);
  if (mode === 'scratch') s += words(reply) * (60 / MODEL.composeWpm);
  else {
    s += 2 * (MODEL.P + MODEL.B) + typeSec(1); // open the template, type the first name
    if (L.lane === 'info') s += typeSec(Math.max(2, 2 * L.ask.length)); // type what to ask for
    if (L.lane === 'order') s += typeSec(2); // type the town
  }
  return s + readSec(words(reply)) + MODEL.M + MODEL.P + MODEL.B; // proofread, decide, send
}

// ---------- the day simulation ----------
const wall = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16)) / 6e4; // ET wall-clock minutes
const dayOf = m => Math.floor(m / 1440), tod = m => m - dayOf(m) * 1440;
function clockStart(m) { // the 1-hour clock starts at arrival, or at 8am if it arrived outside the window
  const t = tod(m);
  if (t < MODEL.windowStart) return dayOf(m) * 1440 + MODEL.windowStart;
  if (t >= MODEL.windowEnd) return (dayOf(m) + 1) * 1440 + MODEL.windowStart;
  return m;
}
function nextCheck(m, C) { // first check at or after m: 8:00, 8:00+C, ... before 20:00
  const d = dayOf(m), t = tod(m);
  if (t <= MODEL.windowStart) return d * 1440 + MODEL.windowStart;
  const k = Math.ceil((t - MODEL.windowStart) / C);
  const c = MODEL.windowStart + k * C;
  return c < MODEL.windowEnd ? d * 1440 + c : (d + 1) * 1440 + MODEL.windowStart;
}
/** items: { arrive, lead, urgent, rank, sec }. order: 'priority' (tool) or 'fifo' (manual). Returns minutes to done per item. */
function simulate(items, C, order) {
  const todo = items.map((it, i) => Object.assign({ i }, it)).sort((a, b) => a.arrive - b.arrive);
  const done = new Array(items.length);
  let now = todo.length ? nextCheck(todo[0].arrive, C) : 0;
  let left = todo.length;
  const pick = () => {
    const ready = todo.filter(x => !x.done && x.arrive <= now);
    if (!ready.length) return null;
    if (order === 'fifo') return ready[0];
    return ready.sort((a, b) => (b.urgent - a.urgent) || (a.rank - b.rank) || (a.arrive - b.arrive))[0];
  };
  while (left) {
    const x = pick();
    if (!x) { // nothing waiting: go to the next check after the next arrival or after now
      const nextArr = todo.find(t => !t.done).arrive;
      now = nextCheck(Math.max(now + 1e-9, nextArr), C);
      continue;
    }
    now += x.sec / 60; x.done = true; left--; done[x.i] = now;
    if (tod(now) >= MODEL.windowEnd || dayOf(now) !== dayOf(now - x.sec / 60)) now = nextCheck(now, C); // stop at 8pm
  }
  return done;
}

// ---------- runs ----------
function prepare(reqs) {
  const res = triage.runAll(reqs);
  return reqs.map((req, i) => {
    const r = res[i];
    return { req, r, tool: toolSeconds(req, r), template: manualSeconds(req, r, 'template'), scratch: manualSeconds(req, r, 'scratch') };
  });
}
function compress(rows, days) { // same requests, same time of day, packed into fewer days
  const first = dayOf(Math.min(...rows.map(x => wall(x.req.received))));
  return rows.map(x => { const m = wall(x.req.received); return Object.assign({}, x, { arrive: (first + ((dayOf(m) - first) % days)) * 1440 + tod(m) }); });
}
function scenario(rows, C) {
  const items = mode => rows.map(x => ({
    arrive: x.arrive != null ? x.arrive : wall(x.req.received),
    lead: LEADS.includes(x.req.label.lane), urgentTruth: Boolean(x.req.label.urgent),
    urgent: mode === 'tool' ? Number(x.r.urgent) : 0,
    rank: mode === 'tool' ? (triage.LANES[x.r.lane].group === 'screen' ? 1000 : 100 - x.r.score) : 0,
    sec: x[mode]
  }));
  const out = {};
  for (const mode of ['tool', 'template', 'scratch']) {
    const its = items(mode);
    const done = simulate(its, C, mode === 'tool' ? 'priority' : 'fifo');
    const waits = its.map((it, i) => ({ lead: it.lead, urgent: it.urgentTruth, w: done[i] - clockStart(it.arrive), raw: done[i] - it.arrive, t: tod(it.arrive) })).filter(x => x.lead);
    const lastCheck = MODEL.windowStart + Math.floor((MODEL.windowEnd - 1 - MODEL.windowStart) / C) * C;
    const late = waits.filter(x => x.w > MODEL.targetMin);
    const within = waits.filter(x => x.w <= MODEL.targetMin).length;
    const urg = waits.filter(x => x.urgent);
    const sorted = waits.map(x => x.w).sort((a, b) => a - b);
    out[mode] = {
      leads: waits.length, within1h: stats.wilson(within, waits.length),
      within24h: waits.filter(x => x.raw <= 1440).length / waits.length,
      urgentWithin1h: urg.length ? stats.wilson(urg.filter(x => x.w <= MODEL.targetMin).length, urg.length) : null,
      medianMin: stats.quantile(sorted, 0.5), p90Min: stats.quantile(sorted, 0.9),
      reviewerHours: its.reduce((a, it) => a + it.sec, 0) / 3600,
      missed: late.length, missedAfterLastCheck: late.filter(x => x.t > lastCheck && x.t < MODEL.windowEnd).length
    };
  }
  return out;
}
function pace(rows, mode) {
  const mean = a => a.reduce((s, x) => s + x[mode], 0) / a.length;
  const b = stats.bootstrap(rows, mean, { reps: 2000, seed: 11 });
  return { secPerRequest: b.est, perMin: 60 / b.est, perMinLo: 60 / b.hi, perMinHi: 60 / b.lo, minutesPer100: (b.est * 100) / 60 };
}
function rates(reqs, preds) {
  const m = metrics.score(reqs, preds);
  const byId = new Map(preds.map(p => [p.id, p]));
  const leads = reqs.filter(r => LEADS.includes(r.label.lane));
  return {
    lane: stats.wilson(m.laneOk, m.n), harmful: stats.wilson(m.harmful, m.n),
    falseScreen: stats.wilson(leads.filter(r => ['spam', 'decline', 'duplicate'].includes(byId.get(r.id).lane)).length, leads.length)
  };
}
function computeLatency() {
  const all = main.requests.concat(blind.requests);
  triage.runAll(main.requests); // warm up
  const reps = 20, t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i++) { triage.runAll(main.requests); triage.runAll(blind.requests); }
  return Number(process.hrtime.bigint() - t0) / 1e6 / (reps * all.length); // ms per request
}

function run({ timing = true } = {}) {
  const M = prepare(main.requests), Bl = prepare(blind.requests);
  const scen = {
    'Current pace': { rows: M, note: `the 161 synthetic requests at their own times, Sep 28 to Nov 9 (about ${(161 / 43).toFixed(1)} a day)` },
    'Ad campaign week': { rows: Bl, note: 'the 60 blind requests, Nov 10 to 13 (15 a day), with the tool\'s blind-set mistakes' },
    'Burst': { rows: compress(M, 5), note: 'the 161 synthetic requests packed into 5 days at the same times of day (about 32 a day)' },
    'Stress': { rows: compress(M, 1), note: 'all 161 packed into one day at the same times of day, far above QBC\'s volume' }
  };
  const sims = {};
  for (const [name, s] of Object.entries(scen)) {
    sims[name] = { note: s.note, byCadence: {} };
    for (const C of [30, 60, 120]) sims[name].byCadence[C] = scenario(s.rows, C);
  }
  return {
    synthetic: true, model: MODEL,
    computeMsPerRequest: timing ? computeLatency() : null,
    pace: { synthetic: { tool: pace(M, 'tool'), template: pace(M, 'template'), scratch: pace(M, 'scratch') },
            blind: { tool: pace(Bl, 'tool'), template: pace(Bl, 'template'), scratch: pace(Bl, 'scratch') } },
    rates: {
      synthetic: { v2: rates(main.requests, triage.runAll(main.requests)), v1: rates(main.requests, baseline.runAll(main.requests)) },
      blind: { v2: rates(blind.requests, triage.runAll(blind.requests)), v1: rates(blind.requests, baseline.runAll(blind.requests)) },
      combined: { v2: rates(main.requests.concat(blind.requests).map(r => r), [].concat(triage.runAll(main.requests), triage.runAll(blind.requests))) }
    },
    sims
  };
}
module.exports = { run, MODEL, toolSeconds, manualSeconds, simulate, clockStart, nextCheck, wall };

if (require.main === module) {
  const k = run();
  const f = stats.fmt, p = stats.pct1, r1 = v => Math.round(v * 10) / 10;
  console.log(`compute: ${k.computeMsPerRequest.toFixed(3)} ms per request`);
  for (const set of ['synthetic', 'blind']) {
    const P = k.pace[set];
    console.log(`${set} pace (MODELED): tool ${r1(P.tool.perMin)}/min, template ${r1(P.template.perMin)}/min, scratch ${r1(P.scratch.perMin)}/min`);
  }
  for (const [name, s] of Object.entries(k.sims)) {
    const c = s.byCadence[60];
    console.log(`${name} @60min: within 1h tool ${f(c.tool.within1h)} | template ${f(c.template.within1h)} | scratch ${f(c.scratch.within1h)}`);
  }
  for (const set of ['synthetic', 'blind', 'combined']) console.log(`${set} harmful ${f(k.rates[set].v2.harmful)} · false screen-out ${f(k.rates[set].v2.falseScreen)}`);
  if (process.argv.includes('--write')) {
    const stable = run({ timing: false });
    stable.computeMsPerRequest = Math.round(k.computeMsPerRequest * 1000) / 1000;
    fs.writeFileSync(path.join(__dirname, 'kpi.json'), JSON.stringify(stable, null, 1) + '\n');
    fs.writeFileSync(path.join(__dirname, 'KPI.md'), require('./kpi-report.js')(stable));
    console.log('wrote eval/KPI.md and eval/kpi.json');
  }
}
