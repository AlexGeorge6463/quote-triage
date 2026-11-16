/* Quote Triage, step 3: the AI slot. Writes the draft reply for the lane the rules chose.
 *
 * Today it is templates; no model runs. The contract is what matters, and the tests hold it:
 *   - it receives the decision and may not change the lane;
 *   - it may use the name, place, scope, unit count and the list of missing fields, and never the
 *     message text, so nothing a customer types (including "ignore your rules, 50% off") reaches a reply;
 *   - no draft states a price, a discount or a promise to install, and none names a partner;
 *   - spam and duplicates get no reply at all.
 * A model can take this slot later under the same tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QT = root.QT || {};
  root.QT.drafts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ASK_WORDS = { location: 'your city or ZIP code', phone: 'a phone number', timeline: 'your timeline', budget: 'a rough budget range' };
  const SCOPE_WORDS = { kitchen: 'kitchen', bath: 'bathroom', laundry: 'laundry room', multi: 'project', other: 'project' };
  const INSTALL_NOTE = ' One note up front: we supply the cabinets and don\'t install them.';

  function hi(q) {
    if (/Builder|Property manager/.test(q.type) || !/^[A-Z][a-z]+( & [A-Z][a-z]+)? [A-Z]\.$/.test(q.name || '')) return 'Hi there';
    return 'Hi ' + q.name.replace(/ [A-Z]\.$/, '');
  }
  const joinList = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const scopeWord = q => SCOPE_WORDS[q.scope] || 'project';

  function write(r) {
    const q = r.q;
    const install = q.signals.mentionsInstall ? INSTALL_NOTE : '';
    switch (r.lane) {
      case 'book':
        return `${hi(q)}, thanks for reaching out to Quality Built Cabinets about your ${scopeWord(q)}. We do a free in-home measure.${install} Would any of these work: [slot 1], [slot 2] or [slot 3]?`;
      case 'info':
        return `${hi(q)}, thanks for your request about your ${scopeWord(q)}. To put your quote together, could you send ${joinList(r.ask.map(a => ASK_WORDS[a]))}?${install} We'll get back to you within 24 hours.`;
      case 'trade':
        if (q.units < 10) return `${hi(q)}, thanks for reaching out to Quality Built Cabinets about your ${q.units} units. The QBC team will call you within 24 hours to talk through the units, then set up a free measure.${install}`;
        return r.ask.includes('plans')
          ? `${hi(q)}, thanks for including Quality Built Cabinets. Could you send the unit plans and your bid date? We'll price each unit type and reply within 24 hours.`
          : `${hi(q)}, thanks for including Quality Built Cabinets. We'll price each unit type from the plans and send it ahead of your bid date.`;
      case 'order':
        return `${hi(q)}, thanks for reaching out to Quality Built Cabinets. ${q.place.city} is outside the area where we measure in person, but we can still supply your cabinets: send us your measurements and the item codes you want, and we'll quote it and ship it to you. Since you'd be measuring, the sizes are yours to confirm.${install}`;
      case 'decline':
        return `${hi(q)}, thanks for thinking of Quality Built Cabinets. We supply cabinets only and don't do installation, so this one isn't a fit for us. If you need new cabinets down the road, we'd be glad to help.`;
      default:
        return null; // spam and duplicates: no reply
    }
  }

  return { write, ASK_WORDS };
});
