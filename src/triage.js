/* Quote Triage, step 2: the rules. Score, lane, what to ask for, urgency, duplicates.
 *
 * Rules decide; the model only writes. A lane has money attached (a measure trip, a salesman's call,
 * a customer measuring their own kitchen), so it comes from rules that can be tested line by line.
 * The AI slot (src/drafts.js) only writes the reply, and a person approves every action.
 *
 * Lanes, checked in this order (rules 4-7 settled with Alex Nov 11, 2026; 1-3 added Nov 16):
 *   1. Spam        vendor pitches and junk                       -> Archive as spam
 *   2. Duplicate   same phone or email, same job, within 14 days -> Merge into the first request
 *   3. Not a fit   install-only or countertop-only               -> Decline politely
 *   4. Trade desk  10+ units, or an investor with 2-9 units      -> the QBC team calls first
 *   5. Order-taking outside Orange, Seminole, Osceola and Lake   -> customer's own measurements
 *   6. Needs info  place unknown, or missing phone, timeline or budget
 *   7. Book measure everything else                              -> free in-home measure
 */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const intake = node ? require('./intake.js') : root.QT.intake;
  const drafts = node ? require('./drafts.js') : root.QT.drafts;
  const api = factory(intake, drafts);
  if (node) module.exports = api;
  root.QT = root.QT || {};
  root.QT.triage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (intake, drafts) {
  const DUP_WINDOW_DAYS = 14;
  const LANES = {
    book: { label: 'Book measure', action: 'Book a free in-home measure', group: 'lead' },
    info: { label: 'Needs info', action: 'Ask for the missing details', group: 'lead' },
    trade: { label: 'Trade desk', action: 'Route to the trade desk', group: 'lead' },
    order: { label: 'Order-taking', action: 'Offer order-taking (their measurements)', group: 'lead' },
    duplicate: { label: 'Duplicate', action: 'Merge into the first request', group: 'screen' },
    spam: { label: 'Spam', action: 'Archive as spam (no reply)', group: 'screen' },
    decline: { label: 'Not a fit', action: 'Decline politely', group: 'screen' }
  };
  const ASK_ORDER = ['location', 'phone', 'timeline', 'budget'];
  const ms = s => Date.parse(s + ':00-05:00');

  function score(q) {
    const parts = [];
    parts.push(['Service area', q.place && q.place.known && q.place.inArea ? 30 : 10, 30]);
    const missing = missingFields(q);
    parts.push(['Completeness', Math.max(0, 20 - missing.length * 7), 20]);
    const t = q.timelineDays == null ? 0 : q.timelineDays <= 30 ? 15 : q.timelineDays <= 90 ? 10 : 5;
    parts.push(['Timeline', t, 15]);
    const v = q.units >= 10 ? 25 : q.units > 1 ? 18 : q.scope === 'kitchen' || q.scope === 'multi' ? 14 : 8;
    parts.push(['Job size', v, 25]);
    parts.push(['Source', /Referral|Outbound|Prequal/.test(q.source) ? 10 : 6, 10]);
    return { total: parts.reduce((a, p) => a + p[1], 0), parts };
  }

  function missingFields(q) {
    const m = [];
    if (!q.place || !q.place.known) m.push('location');
    if (!q.phone) m.push('phone');
    if (q.timelineText == null) m.push('timeline');
    if (q.budget == null) m.push('budget');
    return m;
  }

  /** Find the first request this one repeats: same phone or email, same job, within the window. */
  function findDuplicate(q, history) {
    for (const p of history) {
      if (p.lane === 'spam' || p.lane === 'duplicate') continue;
      const gap = (ms(q.received) - ms(p.q.received)) / 864e5;
      if (gap < 0 || gap > DUP_WINDOW_DAYS) continue;
      const samePhone = q.phone && q.phone === p.q.phone;
      const sameEmail = q.email && q.email === p.q.email;
      if (!samePhone && !sameEmail) continue;
      const qCity = q.place && q.place.known ? q.place.city : null;
      const pCity = p.q.place && p.q.place.known ? p.q.place.city : null;
      if (qCity && pCity && qCity !== pCity) continue; // same contractor, a different job site
      if (q.scope && p.q.scope && q.scope !== p.q.scope) continue;
      const fills = missingFields(p.q).filter(f => !missingFields(q).includes(f));
      return { of: p.q.id, by: samePhone ? 'phone' : 'email', days: gap, fills };
    }
    return null;
  }

  function decide(q, history) {
    const s = q.signals;
    const missing = missingFields(q);
    const investor = q.type === 'Investor' && q.units >= 2 && q.units <= 9;
    const dup = s.spam.isSpam ? null : findDuplicate(q, history);
    let lane;
    if (s.spam.isSpam) lane = 'spam';
    else if (dup) lane = 'duplicate';
    else if (s.notAFit) lane = 'decline';
    else if (q.units >= 10 || investor) lane = 'trade';
    else if (q.place && q.place.known && !q.place.inArea) lane = 'order';
    else if (missing.length) lane = 'info';
    else lane = 'book';
    const ask = lane === 'info' ? missing.slice().sort((a, b) => ASK_ORDER.indexOf(a) - ASK_ORDER.indexOf(b))
      : lane === 'trade' && q.units >= 10 && !q.plans ? ['plans'] : [];
    const urgent = LANES[lane].group === 'lead' && Boolean(s.urgent);
    return { lane, ask, missing, urgent, dup, investor };
  }

  /** The reasons a reviewer reads, one short line each, most important first. */
  function reasons(q, d) {
    const out = [];
    const s = q.signals;
    if (d.lane === 'spam') { out.push(`Spam signals: ${s.spam.reasons.join(', ')}.`); return out; }
    if (d.lane === 'duplicate') {
      out.push(`Same ${d.dup.by} as ${d.dup.of}, ${d.dup.days < 1 ? 'the same day' : Math.round(d.dup.days) + (Math.round(d.dup.days) === 1 ? ' day' : ' days') + ' earlier'}.`);
      out.push(d.dup.fills.length ? `Merging adds the ${d.dup.fills.join(' and ')} that ${d.dup.of} was missing.` : 'Nothing new to add; no reply needed.');
      return out;
    }
    if (d.lane === 'decline') { out.push(`Asks for ${s.notAFit}. QBC supplies cabinets and does not install, so there is nothing to quote.`); return out; }
    if (d.urgent) out.push(`Urgent: the message mentions ${s.urgent.join(' and ')}.`);
    if (q.units >= 10) out.push(`${q.units} units makes it a trade job${q.place && q.place.known && !q.place.inArea ? ', even outside the measure area' : ''}.`);
    else if (d.investor) out.push(`Investor with ${q.units} units${/message/.test(q.typeFrom) || /message/.test(q.unitsFrom) ? ' (read from the message)' : ''}: the QBC team calls first.`);
    if (q.place && q.place.known) {
      out.push(q.place.inArea ? `${q.place.city} (${q.place.county} County) is in the measure area${q.place.how === 'as typed' ? '' : `, ${q.place.how}`}.`
        : `${q.place.city} is outside the measure area${q.place.how === 'as typed' ? '' : ` (${q.place.how})`}, so the customer measures.`);
    } else {
      out.push(`Can't place it: ${q.place ? q.place.how : 'no location given'}. Ask rather than guess.`);
    }
    const other = d.missing.filter(m => m !== 'location');
    if (d.lane === 'info' || (other.length && d.lane !== 'order')) out.push(other.length ? `Missing ${other.join(', ')}.` : 'Everything else is here.');
    else if (!other.length) out.push('Complete: phone, timeline and budget are here.');
    if (d.ask.includes('plans')) out.push('No plans yet: ask for them and the bid date.');
    if (s.injection) out.push('The message tries to give the system instructions. Ignored: the rules never read it and the reply never quotes a price.');
    return out;
  }

  /** Triage a whole stream in time order (duplicates need history). Returns one decision per request. */
  function runAll(requests) {
    const sorted = requests.slice().sort((a, b) => a.received.localeCompare(b.received) || a.id.localeCompare(b.id));
    const history = [];
    const out = new Map();
    for (const req of sorted) {
      const q = intake.normalize(req);
      const d = decide(q, history);
      const sc = score(q);
      const result = { id: q.id, lane: d.lane, ask: d.ask, urgent: d.urgent, duplicateOf: d.dup ? d.dup.of : null,
        score: sc.total, parts: sc.parts, missing: d.missing, dup: d.dup, q, reasons: null, draft: null };
      result.reasons = reasons(q, d);
      result.draft = drafts.write(result);
      history.push(result);
      out.set(q.id, result);
    }
    return requests.map(r => out.get(r.id));
  }

  /** Queue order: urgent leads, then leads by score, then the screen-outs. */
  function priority(a, b) {
    const g = r => (LANES[r.lane].group === 'screen' ? 2 : r.urgent ? 0 : 1);
    return g(a) - g(b) || b.score - a.score || a.q.received.localeCompare(b.q.received);
  }

  return { LANES, runAll, score, missingFields, findDuplicate, decide, priority, DUP_WINDOW_DAYS };
});
