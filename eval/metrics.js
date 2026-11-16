/* Scores a triage run against the SYNTHETIC labels. Shared by the CLI report (eval/run.js),
 * the tests and the Evaluation tab in index.html, so all three always show the same numbers. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QT = root.QT || {};
  root.QT.metrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LANES = ['book', 'info', 'trade', 'order', 'duplicate', 'spam', 'decline'];
  const LEADS = ['book', 'info', 'trade', 'order'];
  const LANE_LABEL = { book: 'Book measure', info: 'Needs info', trade: 'Trade desk', order: 'Order-taking', duplicate: 'Duplicate', spam: 'Spam', decline: 'Not a fit' };

  /* A miss is HARMFUL when approving it as proposed would drop a real lead or make the wrong promise.
   * Everything else is recoverable: one extra question, or junk a person spots at a glance. */
  function severity(truth, pred) {
    if (truth === pred) return null;
    if (LEADS.includes(truth) && ['spam', 'decline', 'duplicate'].includes(pred)) return { harmful: true, why: 'a real lead would be screened out' };
    if (truth !== 'duplicate' && pred === 'duplicate') return { harmful: true, why: 'a new request would be merged away' };
    if ((truth === 'book' || truth === 'info') && pred === 'order') return { harmful: true, why: 'an in-area customer would be told to measure their own kitchen' };
    if (truth === 'order' && pred === 'book') return { harmful: true, why: 'a measure would be offered outside the measure area' };
    return { harmful: false, why: pred === 'info' ? 'costs one extra question' : 'a person would catch it on review' };
  }

  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);

  function score(requests, predictions) {
    const byId = new Map(predictions.map(p => [p.id, p]));
    const confusion = Object.fromEntries(LANES.map(t => [t, Object.fromEntries(LANES.map(p => [p, 0]))]));
    const cats = {};
    const splits = {};
    const misses = [];
    let laneOk = 0;
    let fullOk = 0;
    let askN = 0, askOk = 0;
    let urgTP = 0, urgFP = 0, urgFN = 0;
    let dupN = 0, dupOk = 0;
    let harmful = 0;
    for (const req of requests) {
      const p = byId.get(req.id);
      if (!p) throw new Error('no prediction for ' + req.id);
      const L = req.label;
      const okLane = p.lane === L.lane;
      confusion[L.lane][p.lane] += 1;
      const c = (cats[req.category] = cats[req.category] || { n: 0, ok: 0 });
      const s = (splits[req.split] = splits[req.split] || { n: 0, ok: 0 });
      c.n++; s.n++;
      if (okLane) { laneOk++; c.ok++; s.ok++; }
      // The draft must ask for exactly what is missing, in Needs info and when a trade job has no plans.
      let okAsk = true;
      if (L.lane === 'info' || (L.lane === 'trade' && L.ask.length)) {
        askN++;
        okAsk = okLane && sameSet(p.ask || [], L.ask);
        if (okAsk) askOk++;
      }
      if (L.urgent && p.urgent) urgTP++;
      else if (!L.urgent && p.urgent) urgFP++;
      else if (L.urgent && !p.urgent) urgFN++;
      let okDup = true;
      if (L.lane === 'duplicate') { dupN++; okDup = okLane && p.duplicateOf === L.duplicateOf; if (okDup) dupOk++; }
      const okUrg = Boolean(L.urgent) === Boolean(p.urgent);
      if (okLane && okAsk && okDup && okUrg) fullOk++;
      if (!okLane || !okAsk || !okDup || !okUrg) {
        const sev = severity(L.lane, p.lane);
        if (sev && sev.harmful) harmful++;
        misses.push({ id: req.id, category: req.category, split: req.split, truth: L.lane, pred: p.lane,
          what: !okLane ? `${LANE_LABEL[L.lane]} → ${LANE_LABEL[p.lane]}` : !okAsk ? `asked for [${(p.ask || []).join(', ')}], should ask [${L.ask.join(', ')}]`
            : !okDup ? `merged into ${p.duplicateOf || 'nothing'}, should be ${L.duplicateOf}` : L.urgent ? 'urgent, not flagged' : 'flagged urgent, is not',
          harmful: Boolean(sev && sev.harmful), why: sev ? sev.why : 'right lane, wrong detail' });
      }
    }
    const n = requests.length;
    const leadReqs = requests.filter(r => LEADS.includes(r.label.lane));
    const leadOk = leadReqs.filter(r => byId.get(r.id).lane === r.label.lane).length;
    return {
      n, laneOk, lanePct: pct(laneOk, n), fullOk, fullPct: pct(fullOk, n),
      leadsN: leadReqs.length, leadOk, leadPct: pct(leadOk, leadReqs.length),
      ask: { n: askN, ok: askOk, pct: pct(askOk, askN) },
      urgent: { tp: urgTP, fp: urgFP, fn: urgFN, precision: pct(urgTP, urgTP + urgFP), recall: pct(urgTP, urgTP + urgFN) },
      dup: { n: dupN, ok: dupOk, pct: pct(dupOk, dupN) },
      harmful, confusion,
      categories: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, Object.assign(v, { pct: pct(v.ok, v.n) })])),
      splits: Object.fromEntries(Object.entries(splits).map(([k, v]) => [k, Object.assign(v, { pct: pct(v.ok, v.n) })])),
      misses
    };
  }

  return { LANES, LEADS, LANE_LABEL, severity, score, pct };
});
