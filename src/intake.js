/* Lead Sorter, step 1: intake. Turns a raw web-form submission into a typed QuoteRequest.
 *
 * Every value it reads is recorded with where it came from ("ZIP 32789", "the message: '2 rental
 * houses'"), so the reviewer can see why the rules saw what they saw. In Foundry terms this is the
 * transform that writes the QuoteRequest object type from the raw submissions dataset.
 * It reads; it never decides a lane.
 */
(function (root, factory) {
  const places = typeof module === 'object' && module.exports ? require('./places.js') : root.QT.places;
  const api = factory(places);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QT = root.QT || {};
  root.QT.intake = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (places) {
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12 };
  const TIMELINE_DAYS = { 'ASAP': 7, 'Within 30 days': 30, '1–3 months': 90, '3–6 months': 180, 'Just planning': 365 };
  const SCOPE = { 'Kitchen': 'kitchen', 'Bathroom': 'bath', 'Laundry / mudroom': 'laundry', 'Multiple rooms': 'multi', 'Other': 'other' };
  const SCOPE_WORDS = { kitchen: 'kitchen', bath: 'bathroom', laundry: 'laundry room', multi: 'project', other: 'project' };

  // Dwelling-unit nouns. "2 baths" or "14 feet of cabinets" are not units; "3 condos" and "a 286-unit job" are.
  const UNIT_NOUN = '(?:units?|condos?|homes?|houses?|apartments?|townhomes?|townhouses?|rentals?|propert(?:y|ies)|doors?|buildings?)';
  const NUM_TOKEN = '(\\d{1,4}|' + Object.keys(NUM).join('|') + ')';
  const UNIT_RE = new RegExp('\\b' + NUM_TOKEN + '(?:[\\s-]+[a-z-]+){0,2}?[\\s-]+' + UNIT_NOUN + '\\b', 'gi');
  const PLEX = { duplex: 2, triplex: 3, fourplex: 4, quadplex: 4 };

  // Rental-business language: the customer is an investor even if the form says "Homeowner".
  const INVESTOR_RE = /\b(rentals?|rental (?:units?|homes?|houses?|property|properties|condos?)|tenants?|flip(?:s|ping)?|landlord|airbnb|investment propert(?:y|ies))\b/i;

  // Spam: terms taken from the vendor pitches seen in the dev split, each worth 2 points.
  // Spam at 3 or more, so one stray word in a real lead ("my neighbor does SEO") is never enough.
  const SPAM_TERMS = [
    [/\bseo\b/i, 'SEO pitch'], [/first page of google|rank(?:s|ing|ings)?\b[^.]*\bgoogle|\bgoogle\b[^.]*\brank/i, 'search-ranking pitch'],
    [/\bbacklinks?\b/i, 'backlinks'], [/\bweb(?:site)? ?(?:re)?design\b|\bwebsite looks outdated\b/i, 'web-design pitch'],
    [/\bdigital marketing\b|\bmarketing agency\b|\bour agency\b/i, 'agency pitch'], [/\bper lead\b|\b(?:exclusive|sell) [a-z ]*leads\b/i, 'selling leads'],
    [/\bcrypto\b|\bbitcoin\b/i, 'crypto'], [/\binvestment opportunity\b|\bearn \d+% /i, 'investment pitch'],
    [/\bworking capital\b|\bbusiness loan\b|\bqualif(?:y|ies) for up to\b/i, 'financing pitch'], [/\bno credit check\b/i, 'no credit check'],
    [/\bvirtual assistant\b/i, 'virtual-assistant pitch'], [/\boutsourc/i, 'outsourcing pitch'], [/\bdear (?:business owner|sir|madam|sir\/madam)\b/i, 'form-letter greeting'],
    [/\blimited spots\b|\bact now\b/i, 'pressure line'], [/\breply (?:yes|stop)\b/i, 'reply-YES line']
  ];
  const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/i;
  const MASH_RE = /\b(?:asdf|qwer|zxcv|hjkl)\w*/i;

  // Not a fit: QBC supplies cabinets and does not install. Install-only and countertop-only requests have nothing to quote.
  const INSTALL_RE = /\binstall(?:er|ers|ation|ing)?\b/i;
  const INSTALL_ONLY_RE = /\balready (?:have|bought|got|purchased)\b|\bbought (?:the |my |our )?cabinets\b|\bhave the cabinets\b|\b(?:installation|install) only\b|\bjust need (?:someone|an installer)\b|\blooking for (?:an )?installer\b/i;
  const COUNTER_RE = /\b(?:counter ?tops?|quartz|granite)\b/i;
  const COUNTER_ONLY_RE = /\bkeeping (?:my|the|our) cabinets\b|\b(?:counter ?tops?|tops) only\b|\bjust (?:need|want) (?:new )?(?:quartz |granite )?(?:counter ?tops?|tops)\b/i;

  // Urgency: a hard date or active damage named in the message. "ASAP" alone is a timeline, not an emergency.
  const URGENT_TERMS = [
    [/\bleak(?:s|ed|ing)?\b/i, 'a leak'], [/\bwater damage\b/i, 'water damage'], [/\bflood(?:ed|ing)?\b/i, 'a flood'], [/\bmou?ld\b/i, 'mold'],
    [/\binsurance\b|\badjuster\b/i, 'an insurance claim'], [/\bclos(?:e|es|ing) on\b/i, 'a closing date'],
    [/\bmoves? in\b|\bmove-in\b|\bmoving in\b/i, 'a move-in date']
  ];
  const INJECTION_RE = /\bignore (?:all |your |the |previous |prior |usual )*(?:instructions|rules)\b|(?:^|\s)system:/i;

  function digitsOf(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    return d;
  }

  function unitsFromText(text) {
    let best = null;
    const t = String(text || '');
    for (const m of t.matchAll(UNIT_RE)) {
      const tok = m[1].toLowerCase();
      const n = /^\d+$/.test(tok) ? parseInt(tok, 10) : NUM[tok];
      if (n && (!best || n > best.n)) best = { n, quote: m[0].trim() };
    }
    for (const [word, n] of Object.entries(PLEX)) {
      if (new RegExp('\\b' + word + '\\b', 'i').test(t) && (!best || n > best.n)) best = { n, quote: word };
    }
    return best;
  }

  function normalize(req) {
    const f = req.form;
    const read = [];
    const note = (field, value, from) => read.push({ field, value, from });
    const message = String(f.message || '').trim();

    // Contact
    const digits = digitsOf(f.phone);
    const phone = digits.length === 10 ? digits : null;
    const phoneShown = phone ? `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}` : null;
    if (phone) note('Phone', phoneShown, f.phone === phoneShown ? 'form' : `form, typed "${f.phone}"`);
    else if (String(f.phone || '').trim()) note('Phone', 'missing', `"${f.phone}" is not a full number`);
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(f.email || '').trim()) ? f.email.trim().toLowerCase() : null;

    // Place: the location box first, then the message if the box is blank or unreadable.
    let place = places.resolve(f.location);
    if (!place || !place.known) {
      const inMsg = places.findInText(message);
      if (inMsg && !(place && /not specific/.test(place.how))) place = inMsg;
    }
    if (place && place.known) note('City', place.county ? `${place.city} (${place.county} County)` : place.city, place.how);
    else note('City', 'unknown', place ? place.how : 'location box left blank');

    // Scope
    let scope = SCOPE[f.project] || null;
    let scopeFrom = 'form';
    if (!scope || scope === 'other') {
      const m = /\bkitchen/i.test(message) ? 'kitchen' : /\bbath|\bvanit/i.test(message) ? 'bath' : /\blaundry|\bmudroom/i.test(message) ? 'laundry' : null;
      if (m) { scope = m; scopeFrom = 'the message'; }
    }
    if (scope) note('Scope', SCOPE_WORDS[scope] === 'project' ? (f.project || 'other') : SCOPE_WORDS[scope], scopeFrom);

    // Units: the larger of the units box and any count in the message.
    const boxRaw = String(f.units || '').trim().toLowerCase();
    const boxN = /^\d+$/.test(boxRaw) ? parseInt(boxRaw, 10) : NUM[boxRaw] || unitsFromText(boxRaw + ' units')?.n || null;
    const msgUnits = unitsFromText(message);
    let units = 1, unitsFrom = 'default (one job)';
    if (boxN) { units = boxN; unitsFrom = 'form'; }
    if (msgUnits && msgUnits.n > units) { units = msgUnits.n; unitsFrom = `the message: "${msgUnits.quote}"`; }
    if (units > 1 || unitsFrom === 'form') note('Units', String(units), unitsFrom);

    // Customer type: the form's choice, upgraded to investor when the message talks about rentals.
    const role = String(f.role || '');
    let type = /investor|landlord/i.test(role) ? 'Investor' : /contractor|remodel/i.test(role) ? 'Remodeler'
      : /builder|developer/i.test(role) ? 'Builder' : /property manager/i.test(role) ? 'Property manager' : 'Homeowner';
    let typeFrom = role ? 'form' : 'default';
    const inv = message.match(INVESTOR_RE);
    if (type === 'Homeowner' && inv) { type = 'Investor'; typeFrom = `the message: "${inv[0]}"`; }
    note('Customer', type, typeFrom);

    const budget = String(f.budget || '').trim() || null;
    const timelineText = String(f.timeline || '').trim() || null;
    const timelineDays = timelineText && Object.prototype.hasOwnProperty.call(TIMELINE_DAYS, timelineText) ? TIMELINE_DAYS[timelineText] : null;

    // Signals
    const spam = [];
    SPAM_TERMS.forEach(([re, why]) => { if (re.test(message) || re.test(f.name || '')) spam.push([why, 2]); });
    if (/\bguarantee[sd]?\b/i.test(message)) spam.push(['guarantee claim', 1]);
    if (URL_RE.test(message)) spam.push(['a link', 1]);
    if (/^8(00|33|44|55|66|77|88)/.test(digits)) spam.push(['toll-free number', 1]);
    if (MASH_RE.test(message) || MASH_RE.test(f.name || '')) spam.push(['keyboard mash', 3]);
    const hasScope = scope && scope !== 'other';
    if (!hasScope && !(place && place.known) && !phone) spam.push(['no project, place or phone', 2]);
    const spamScore = spam.reduce((a, [, w]) => a + w, 0);
    const spamReasons = spam.map(([why]) => why);

    let notAFit = null;
    if (INSTALL_RE.test(message) && INSTALL_ONLY_RE.test(message)) notAFit = 'install only';
    else if (COUNTER_RE.test(message) && COUNTER_ONLY_RE.test(message) && !/\bnew cabinets\b/i.test(message)) notAFit = 'countertops only';

    const urgentWhy = URGENT_TERMS.filter(([re]) => re.test(message)).map(([, why]) => why);

    return {
      id: req.id, received: req.received, name: f.name, source: f.source || 'Website form', message, form: f,
      phone, phoneShown, email, place, scope, units, unitsFrom, type, typeFrom, budget, timelineText, timelineDays,
      plans: f.plans === 'Yes', read,
      signals: {
        spam: { score: spamScore, reasons: spamReasons, isSpam: spamScore >= 3 },
        notAFit,
        urgent: urgentWhy.length ? urgentWhy : null,
        injection: INJECTION_RE.test(message),
        mentionsInstall: INSTALL_RE.test(message)
      }
    };
  }

  return { normalize, unitsFromText, digitsOf, TIMELINE_DAYS, SCOPE_WORDS };
});
