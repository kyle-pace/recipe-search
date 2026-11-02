// A small robots.txt reader: user-agent groups, Allow/Disallow with
// longest-match wins (as Google and RFC 9309 do), * and $ in paths,
// and Crawl-delay.

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && value === '') continue; // "Disallow:" allows everything
      current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n)) current.crawlDelay = n;
    }
  }
  return groups;
}

// The group for our crawler: one naming our token, else "*".
function groupFor(groups, token) {
  const t = token.toLowerCase();
  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && t.includes(a)));
  if (named.length) return merge(named);
  const star = groups.filter((g) => g.agents.includes('*'));
  return star.length ? merge(star) : { rules: [], crawlDelay: null };
}

function merge(groups) {
  return {
    rules: groups.flatMap((g) => g.rules),
    crawlDelay: groups.map((g) => g.crawlDelay).find((d) => d != null) ?? null,
  };
}

function patternToRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export function robotsFor(text, token) {
  const group = groupFor(parseRobots(text), token);
  const rules = group.rules.map((r) => ({ ...r, re: patternToRegex(r.path), len: r.path.length }));
  return {
    crawlDelay: group.crawlDelay,
    allowed(urlOrPath) {
      let path;
      try {
        const u = new URL(urlOrPath, 'https://x');
        path = u.pathname + u.search;
      } catch {
        path = urlOrPath;
      }
      let best = null;
      for (const r of rules) {
        if (!r.re.test(path)) continue;
        if (!best || r.len > best.len || (r.len === best.len && r.allow)) best = r;
      }
      return best ? best.allow : true;
    },
  };
}
