/* Small, dependency-free statistics for the evaluation: Wilson score intervals and a seeded bootstrap. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QT = root.QT || {};
  root.QT.stats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** 95% Wilson score interval for x successes out of n. Well behaved at 0 and n, unlike the normal approximation. */
  function wilson(x, n, z = 1.959964) {
    if (!n) return { x, n, p: null, lo: null, hi: null };
    const p = x / n, z2 = z * z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    return { x, n, p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
  }
  const pct1 = v => (v == null ? '–' : (Math.round(v * 1000) / 10).toFixed(1) + '%');
  /** "3/60 = 5.0% (95% CI 1.7–13.7%)" */
  function fmt(w) {
    if (!w.n) return '–';
    return `${w.x}/${w.n} = ${pct1(w.p)} (95% CI ${pct1(w.lo).replace('%', '')}–${pct1(w.hi)})`;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /** Percentile bootstrap of a statistic over items. Returns { est, lo, hi }. */
  function bootstrap(items, stat, { reps = 2000, seed = 7 } = {}) {
    const r = rng(seed);
    const est = stat(items);
    const vals = [];
    for (let i = 0; i < reps; i++) {
      const s = new Array(items.length);
      for (let j = 0; j < items.length; j++) s[j] = items[Math.floor(r() * items.length)];
      vals.push(stat(s));
    }
    vals.sort((a, b) => a - b);
    return { est, lo: vals[Math.floor(0.025 * reps)], hi: vals[Math.ceil(0.975 * reps) - 1] };
  }
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  return { wilson, fmt, pct1, bootstrap, quantile, rng };
});
