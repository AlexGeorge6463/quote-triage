/* The v1 rules, copied unchanged from index.html as published on Nov 13, 2026 (commit a8105ae),
 * so the "before" number can be reproduced at any time.
 *
 * v1 never had an intake step: it expected clean fields. To run it on raw form submissions,
 * toV1() does the smallest honest mapping a form handler would do and nothing more:
 * the location is used as typed, units is parseInt() of the units box, a blank box is a missing
 * value, and the message is kept only as a note. That is exactly the gap the evaluation measures.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QT = root.QT || {};
  root.QT.baseline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // ---- verbatim from v1 ----
  const COUNTY = {
    'Orlando':'Orange','Winter Park':'Orange','Apopka':'Orange','Winter Garden':'Orange','Ocoee':'Orange','Windermere':'Orange',
    'Sanford':'Seminole','Lake Mary':'Seminole','Oviedo':'Seminole','Altamonte Springs':'Seminole',
    'Kissimmee':'Osceola','St. Cloud':'Osceola',
    'Clermont':'Lake','Leesburg':'Lake','Mount Dora':'Lake','Groveland':'Lake'
  };
  const inArea = c => Boolean(COUNTY[c]);
  function triage(r) {
    const parts = [];
    const missing = [];
    const area = inArea(r.city) ? 'in' : 'out';
    parts.push(['Service area', area === 'in' ? 30 : 10, 30]);
    if (!r.contact) missing.push('a phone number');
    if (r.timeline == null) missing.push('your timeline');
    if (r.budget === '—') missing.push('a budget range');
    const complete = 20 - missing.length * 7;
    parts.push(['Completeness', Math.max(0, complete), 20]);
    const t = r.timeline == null ? 0 : r.timeline <= 30 ? 15 : r.timeline <= 90 ? 10 : 5;
    parts.push(['Timeline', t, 15]);
    const v = r.units >= 10 ? 25 : r.units > 1 ? 18 : /Full kitchen|Kitchen/.test(r.scope) ? 14 : 8;
    parts.push(['Job size', v, 25]);
    const s = /Referral|Outbound|Prequal/.test(r.source) ? 10 : 6;
    parts.push(['Source', s, 10]);
    const score = parts.reduce((a, p) => a + p[1], 0);
    const investor = /Investor/i.test(r.type) && r.units >= 2 && r.units <= 9;
    let lane;
    if (r.units >= 10 || investor) lane = 'trade';
    else if (area === 'out') lane = 'order';
    else if (missing.length) lane = 'info';
    else lane = 'book';
    if (lane === 'trade' && r.units >= 10 && !r.plans) missing.push('unit plans');
    return { score, lane, parts, missing };
  }
  // ---- end verbatim ----

  const TIMELINE_DAYS = { 'ASAP': 7, 'Within 30 days': 30, '1–3 months': 90, '3–6 months': 180, 'Just planning': 365 };
  function toV1(req) {
    const f = req.form;
    return {
      id: req.id, at: req.received, name: f.name, type: f.role || 'Homeowner', city: String(f.location || '').trim(),
      scope: f.project || 'Other', units: parseInt(f.units, 10) || 1, budget: f.budget || '—',
      timeline: Object.prototype.hasOwnProperty.call(TIMELINE_DAYS, f.timeline) ? TIMELINE_DAYS[f.timeline] : null,
      source: f.source, contact: Boolean(String(f.phone || '').trim()), plans: f.plans === 'Yes', note: f.message
    };
  }
  const ASK = { 'a phone number': 'phone', 'your timeline': 'timeline', 'a budget range': 'budget', 'unit plans': 'plans' };
  function runAll(requests) {
    return requests.map(req => {
      const t = triage(toV1(req));
      // What the v1 draft actually asks for: the missing fields in Needs info, the unit plans in a 10+ unit trade job.
      const ask = t.lane === 'info' ? t.missing.filter(m => m !== 'unit plans').map(m => ASK[m])
        : t.lane === 'trade' && t.missing.includes('unit plans') ? ['plans'] : [];
      return { id: req.id, lane: t.lane, ask, urgent: false, duplicateOf: null, score: t.score };
    });
  }
  return { name: 'v1 (Nov 13)', triage, toV1, runAll, COUNTY };
});
