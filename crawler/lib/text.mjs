// Small text helpers shared by the readers.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', frac12: '½', frac14: '¼',
  frac34: '¾', deg: '°', eacute: 'é', egrave: 'è', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä',
  times: '×', reg: '®', trade: '™', copy: '©',
};

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

export function stripTags(s) {
  return String(s ?? '').replace(/<[^>]*>/g, ' ');
}

export function clean(s) {
  return decodeEntities(stripTags(decodeEntities(s))).replace(/\s+/g, ' ').trim();
}

// ISO 8601 durations (PT1H30M, P0DT1H0M0S) or plain text ("1 hour 30 minutes")
// to whole minutes. Null when there's nothing usable.
export function toMinutes(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const iso = s.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (iso && /\d/.test(s)) {
    const [, d, h, m, sec] = iso.map((x) => Number(x || 0));
    const total = Math.round(d * 1440 + h * 60 + m + sec / 60);
    return total > 0 ? total : null;
  }
  let total = 0;
  let found = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\b/gi)) {
    found = true;
    const n = Number(m[1]);
    const unit = m[2][0].toLowerCase();
    total += unit === 'd' ? n * 1440 : unit === 'h' ? n * 60 : n;
  }
  if (!found && /^\d+$/.test(s)) return Number(s) || null;
  return found && total > 0 ? Math.round(total) : null;
}
