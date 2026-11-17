/* Lead Sorter: where a request is, and whether QBC measures there.
 * The measure area (confirmed Nov 11): Orange, Seminole, Osceola and Lake counties. Polk is out.
 * Everywhere else is order-taking on the customer's own measurements.
 *
 * These tables are a small hand-built sample that covers the SYNTHETIC set. The cities and ZIP codes
 * are real places, used only to exercise the rule. A real deployment would load a full ZIP-to-county
 * crosswalk as its own dataset instead of this list.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QT = root.QT || {};
  root.QT.places = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MEASURE_COUNTIES = ['Orange', 'Seminole', 'Osceola', 'Lake'];

  // City or neighborhood -> county. Florida unless a state is given.
  const COUNTY = {
    // Orange
    'Orlando': 'Orange', 'Winter Park': 'Orange', 'Apopka': 'Orange', 'Winter Garden': 'Orange', 'Ocoee': 'Orange',
    'Windermere': 'Orange', 'Maitland': 'Orange', 'Lake Nona': 'Orange', 'Dr. Phillips': 'Orange', 'Horizon West': 'Orange',
    'Hunters Creek': 'Orange', 'Baldwin Park': 'Orange', 'College Park': 'Orange', 'Avalon Park': 'Orange',
    // Seminole
    'Sanford': 'Seminole', 'Lake Mary': 'Seminole', 'Oviedo': 'Seminole', 'Altamonte Springs': 'Seminole',
    'Casselberry': 'Seminole', 'Longwood': 'Seminole', 'Winter Springs': 'Seminole', 'Heathrow': 'Seminole',
    // Osceola
    'Kissimmee': 'Osceola', 'St. Cloud': 'Osceola', 'Celebration': 'Osceola',
    // Lake
    'Clermont': 'Lake', 'Leesburg': 'Lake', 'Mount Dora': 'Lake', 'Groveland': 'Lake', 'Eustis': 'Lake',
    'Tavares': 'Lake', 'Minneola': 'Lake',
    // Outside the measure area (order-taking)
    'Tampa': 'Hillsborough', 'Davenport': 'Polk', 'Lakeland': 'Polk', 'Haines City': 'Polk', 'Winter Haven': 'Polk',
    'Daytona Beach': 'Volusia', 'Deltona': 'Volusia', 'DeLand': 'Volusia', 'Ocala': 'Marion', 'Melbourne': 'Brevard',
    'Titusville': 'Brevard', 'Cocoa Beach': 'Brevard', 'Jacksonville': 'Duval', 'Gainesville': 'Alachua',
    'Sarasota': 'Sarasota', 'Fort Myers': 'Lee', 'Miami': 'Miami-Dade', 'St. Petersburg': 'Pinellas',
    'Palm Coast': 'Flagler', 'Sebring': 'Highlands'
  };

  // ZIP -> city. Only ZIPs that sit inside one county are listed.
  const ZIP = {
    '32801': 'Orlando', '32803': 'Orlando', '32806': 'Orlando', '32819': 'Dr. Phillips', '32827': 'Lake Nona',
    '32789': 'Winter Park', '32792': 'Winter Park', '32703': 'Apopka', '34787': 'Winter Garden', '34761': 'Ocoee',
    '34786': 'Windermere', '32751': 'Maitland',
    '32771': 'Sanford', '32746': 'Lake Mary', '32765': 'Oviedo', '32701': 'Altamonte Springs', '32714': 'Altamonte Springs',
    '32707': 'Casselberry', '32708': 'Winter Springs', '32750': 'Longwood',
    '34741': 'Kissimmee', '34744': 'Kissimmee', '34769': 'St. Cloud', '34771': 'St. Cloud',
    '34711': 'Clermont', '34748': 'Leesburg', '32757': 'Mount Dora', '34736': 'Groveland', '32726': 'Eustis',
    '32778': 'Tavares', '34715': 'Minneola',
    '33602': 'Tampa', '33837': 'Davenport', '33801': 'Lakeland', '33844': 'Haines City', '32114': 'Daytona Beach',
    '32725': 'Deltona', '32720': 'DeLand', '34470': 'Ocala', '32901': 'Melbourne', '32780': 'Titusville',
    '32202': 'Jacksonville', '32601': 'Gainesville'
  };

  // True aliases only. Typos, missing spaces, "Saint"/"St", "Mount"/"Mt" and cut-off names
  // ("Altamonte") are handled by the generic rules in match(), not by listing spellings.
  const ALIASES = { 'stpete': 'St. Petersburg' };

  const STATES = { AL: 'Alabama', GA: 'Georgia', NC: 'North Carolina', SC: 'South Carolina', TN: 'Tennessee', TX: 'Texas', NY: 'New York', NJ: 'New Jersey', OH: 'Ohio', PA: 'Pennsylvania' };
  const STATE_NAMES = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v.toLowerCase(), k]));

  // Fold a name to a comparison key: lowercase, common abbreviations unified, letters and digits only.
  const fold = s => String(s || '').toLowerCase()
    .replace(/\bsaint\b/g, 'st').replace(/\bmount\b/g, 'mt').replace(/\bdoctor\b/g, 'dr').replace(/\bfort\b/g, 'ft')
    .replace(/[^a-z0-9]/g, '');
  const BY_FOLD = {};
  Object.keys(COUNTY).forEach(c => { BY_FOLD[fold(c)] = c; });
  Object.entries(ALIASES).forEach(([k, c]) => { BY_FOLD[k] = c; });
  const KEYS = Object.keys(BY_FOLD);

  // Damerau-Levenshtein distance (adjacent swaps count as one edit), for typos like "Kissimee".
  function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(Array(b.length).fill(0)));
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  /** Match one typed name to a known place: exact, then a unique cut-off ("Altamonte"), then a unique near-miss. */
  function match(text) {
    const key = fold(text);
    if (!key) return null;
    if (BY_FOLD[key]) return { city: BY_FOLD[key], how: 'exact' };
    if (key.length >= 6) {
      const pre = KEYS.filter(k => k.startsWith(key));
      if (pre.length === 1) return { city: BY_FOLD[pre[0]], how: 'shortened' };
    }
    if (key.length >= 5) {
      const limit = key.length >= 9 ? 2 : 1;
      let best = null, bestD = Infinity, tie = false;
      for (const k of KEYS) {
        if (Math.abs(k.length - key.length) > limit) continue;
        const dd = distance(key, k);
        if (dd < bestD) { best = k; bestD = dd; tie = false; } else if (dd === bestD) tie = true;
      }
      if (best && bestD <= limit && !tie) return { city: BY_FOLD[best], how: 'spelling' };
    }
    return null;
  }

  const inMeasureArea = county => MEASURE_COUNTIES.includes(county);

  /** Resolve a typed location ("winter park, fl", "32789", "Atlanta, GA") to a place.
   *  Returns { city, county, state, inArea, known, how } or null when there is nothing to resolve. */
  function resolve(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    // A ZIP anywhere in the text wins: it is the most specific thing a person types.
    const zipMatch = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (zipMatch && ZIP[zipMatch[1]]) {
      const city = ZIP[zipMatch[1]];
      return place(city, `ZIP ${zipMatch[1]}`);
    }
    // An out-of-state address ends in a state code or name other than Florida.
    const st = raw.match(/,?\s*\b([A-Z]{2})\b\.?\s*(\d{5})?\s*$/);
    if (st && st[1] !== 'FL' && STATES[st[1]]) return outOfState(raw, st[1]);
    const lower = raw.toLowerCase();
    for (const [name, code] of Object.entries(STATE_NAMES)) if (lower.endsWith(name)) return outOfState(raw, code);
    // A hedge ("near Orlando", "Orlando area") could be the next county over, so it is not a place yet.
    if (/\b(near|around|outside|close to|by)\b|\barea\b/i.test(raw)) {
      return { city: null, county: null, state: null, inArea: false, known: false, how: `"${raw}" is not specific` };
    }
    // Strip a trailing ", FL", "Florida" or a ZIP we don't know, then look the city up.
    const cleaned = raw.replace(/\b\d{5}(-\d{4})?\b/g, '').replace(/,?\s*\b(fl|fla|florida)\b\.?\s*$/i, '').replace(/[,.\s]+$/, '').trim();
    const m = match(cleaned);
    if (m) return place(m.city, m.how === 'exact' && cleaned === m.city ? 'as typed' : `read "${raw}" as ${m.city}`);
    if (zipMatch) return { city: null, county: null, state: 'FL', inArea: false, known: false, how: `ZIP ${zipMatch[1]} is not in the place table` };
    return { city: raw, county: null, state: null, inArea: false, known: false, how: `"${raw}" is not in the place table` };
  }

  function place(city, how) {
    const county = COUNTY[city];
    return { city, county, state: 'FL', inArea: inMeasureArea(county), known: true, how };
  }
  function outOfState(raw, code) {
    const city = raw.replace(/,?\s*\b[A-Z]{2}\b\.?\s*(\d{5})?\s*$/, '').replace(new RegExp(',?\\s*' + STATES[code] + '$', 'i'), '').trim();
    return { city: `${city}, ${code}`, county: null, state: code, inArea: false, known: true, how: `out of state (${code})` };
  }

  /** Find a place named inside a free-text message ("we're in Oviedo", "zip is 34741"). */
  function findInText(message) {
    const text = String(message || '');
    const zip = text.match(/\b(3[234]\d{3})\b/);
    if (zip && ZIP[zip[1]]) return place(ZIP[zip[1]], `ZIP ${zip[1]} in the message`);
    // Longest names first so "Winter Park" is not read as "Park".
    const names = Object.keys(COUNTY).sort((a, b) => b.length - a.length);
    for (const name of names) {
      const re = new RegExp('\\b' + name.replace(/[.]/g, '\\.?').replace(/ /g, '\\s+') + '\\b', 'i');
      if (re.test(text)) return place(name, `"${name}" in the message`);
    }
    return null;
  }

  return { MEASURE_COUNTIES, COUNTY, ZIP, ALIASES, resolve, findInText, inMeasureArea, match, distance, fold };
});
